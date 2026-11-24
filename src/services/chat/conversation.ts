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

// 服务端全量会话（仅本地为空时兜底，或手动刷新）
export async function fetchConversations(): Promise<Conversation[]> {
  const instance = getIM();
  if (!instance?.currentUserID) return [];
  try {
    return await instance.conversations.getAll();
  } catch {
    return [];
  }
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

// 上滑到顶时调用：先查本地有没有更早的消息（Local.ListMsgs beforeSeq 分页），
// 本地返回数不足 pageSize 或 hasMore=true 说明更早的只在服务端 → 再拉远端。
// 远端结果 SDK 自动落库，后续翻页可全部走本地。
export async function loadMoreConversationHistory(
  conversationID: string,
  beforeSeq: number,
  pageSize = 30,
): Promise<{ items: MsgData[]; noMoreLocal: boolean }> {
  const instance = getIM();
  if (!instance?.currentUserID) return { items: [], noMoreLocal: true };

  // 1) 先本地分页
  let localItems: MsgData[] = [];
  let localHasMore = false;
  try {
    const page = await instance.local.listMsgs(conversationID, beforeSeq, pageSize);
    localItems = page.items;
    localHasMore = page.hasMore;
  } catch {
    // 本地不可用继续远端
  }

  // 2) 本地已完整覆盖更早的所有消息 → 直接返回
  if (!localHasMore) {
    return { items: localItems, noMoreLocal: true };
  }

  // 3) 本地不足，远端拉取。SDK 会把结果自动落库，下次翻同一段就走本地
  let remoteItems: MsgData[] = [];
  try {
    remoteItems = await pullHistory(conversationID, { beforeSeq, pageSize });
  } catch {
    // 远端失败只保留已有本地
  }

  // 合并：本地在前（更早），远端在后。同一条可能两边都有，靠 mergeMessages 去重
  const merged = [...localItems, ...remoteItems];
  return { items: merged, noMoreLocal: false };
}

export function markReadUpTo(
  conversationID: string,
  hasReadSeq: number,
  seqs: number[] = [],
): Promise<void> {
  return markConversationRead(conversationID, hasReadSeq, seqs);
}
