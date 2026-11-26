// 会话与消息读取编排：会话列表、本地/远端历史、未读、已读上报。
// stores 不直接接触 im 层，所有 SDK 调用集中在这里。

import type { Conversation, MsgData } from '@goim/web-sdk';

import { getIM } from '@/im/client';
import {
  loadLocalMessages,
  markConversationRead,
  pullHistory,
} from '@/im/message';

// IM 是否已登录（以当前用户为准）
export function isIMLoggedIn(): boolean {
  return Boolean(getIM()?.currentUserID);
}

// 本地会话列表：Local.ListConversations 已按「置顶优先 + latestMsgSendTime 倒序」排序，
// 分页上限 200，这里循环取全量，保证会话列表和联系人页看到同一份完整数据
const CONV_PAGE_SIZE = 200;
const CONV_MAX_PAGES = 10;

export async function listLocalConversations(): Promise<Conversation[]> {
  const instance = getIM();
  if (!instance?.currentUserID) return [];
  const all: Conversation[] = [];
  try {
    for (let page = 0; page < CONV_MAX_PAGES; page++) {
      const result = await instance.local.listConversations(
        page * CONV_PAGE_SIZE,
        CONV_PAGE_SIZE,
      );
      all.push(...result.items);
      if (!result.hasMore || !result.items.length) break;
    }
  } catch {
    // 本地缓存不可用时返回已取到的部分
  }
  return all;
}

// 本地未读数（Local.UnreadCount 本地推导；缓存不完整时为下界）
export async function getUnreadCount(conversationID: string): Promise<number | undefined> {
  const instance = getIM();
  if (!instance?.currentUserID || !conversationID) return undefined;
  try {
    return await instance.local.unreadCount(conversationID);
  } catch {
    return undefined;
  }
}

// 打开会话时：只读本地缓存。SDK 同步完成后本地已含最新窗口（默认 100 条，
// 足够新会话展示），远端历史由上滑到顶时按需拉取（loadMoreConversationHistory）。
// 两路解耦避免打开时多一次不必要的网络请求。
export async function loadConversationMessages(
  conversationID: string,
  limit = 100,
): Promise<MsgData[]> {
  try {
    return await loadLocalMessages(conversationID, limit);
  } catch {
    return [];
  }
}

// 上滑到顶时调用：判定"真·到底"必须同时满足两个条件：
//   1) 本地 listMsgs 返回 hasMore=false（本地没有更早的了）
//   2) getConversationSeqs 显示 LocalMinSeq <= ServerMinSeq（本地最早已覆盖服务端最早）
// 否则无论本地 hasMore 是什么，都从服务端拉 —— 因为 localHasMore=false 只代表
// "本地没有了"，可能本地只存了后 N 条，服务端前面还有一堆历史。
// 远端结果 SDK 自动落库，下次翻同一段就走本地。
export async function loadMoreConversationHistory(
  conversationID: string,
  beforeSeq: number,
  pageSize = 30,
): Promise<{ items: MsgData[]; noMore: boolean }> {
  const instance = getIM();
  if (!instance?.currentUserID) return { items: [], noMore: true };

  // 0) 先拿会话的 seq 边界：本地 vs 服务端（sync 时已渐进落盘，准）
  let localMinSeq = 0;
  let serverMinSeq = 0;
  try {
    const seqs = await instance.local.getConversationSeqs(conversationID);
    localMinSeq = seqs.localMinSeq ?? 0;
    serverMinSeq = seqs.serverMinSeq ?? 0;
  } catch {
    // 拿不到就保守：假装本地不完整，去服务端拉
  }

  // 1) 先本地分页（快，且翻页后半段大概率命中）
  let localItems: MsgData[] = [];
  let localHasMore = false;
  try {
    const page = await instance.local.listMsgs(conversationID, beforeSeq, pageSize);
    localItems = page.items;
    localHasMore = page.hasMore;
  } catch {
    // 本地不可用继续远端
  }

  // 2) 真·到底判定：本地没有更早的 且 本地最早已覆盖服务端最早
  //    serverMinSeq==0 表示 sync 还没给这个会话标过下界 → 保守认为有更多
  const trulyNoMore =
    !localHasMore &&
    serverMinSeq > 0 &&
    localMinSeq > 0 &&
    localMinSeq <= serverMinSeq;

  if (trulyNoMore) {
    return { items: localItems, noMore: true };
  }

  // 3) 本地不足 / 服务端可能还有 → 远端拉。SDK 会把结果自动落库，下次翻同一段就走本地
  let remoteItems: MsgData[] = [];
  let remoteNoMore = false;
  try {
    remoteItems = await pullHistory(conversationID, { beforeSeq, pageSize });
    remoteNoMore = remoteItems.length === 0;
  } catch {
    // 远端失败只保留已有本地；这次不算"到底"，下次还会再试
  }

  // 合并：本地在前（更早的），远端在后。同一条可能两边都有，靠 mergeMessages 去重
  const merged = [...localItems, ...remoteItems];
  return { items: merged, noMore: remoteNoMore };
}

export function markReadUpTo(
  conversationID: string,
  hasReadSeq: number,
  seqs: number[] = [],
): Promise<void> {
  return markConversationRead(conversationID, hasReadSeq, seqs);
}
