// 会话与消息读取编排：会话列表、本地/远端历史、未读、已读上报。
// stores 不直接接触 im 层，所有 SDK 调用集中在这里。

import type { Conversation, MsgData } from '@goim/web-sdk';

import { getIM } from '@/im/client';
import { loadLocalMessages, markConversationRead, pullHistory } from '@/im/message';

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

// 打开会话时的历史：本地缓存 + 服务端最新一页，两路失败互不影响
export async function loadConversationMessages(
  conversationID: string,
  pageSize = 20,
): Promise<MsgData[]> {
  let local: MsgData[] = [];
  try {
    local = await loadLocalMessages(conversationID);
  } catch {
    // 本地缓存不可用时继续拉服务端
  }

  let remote: MsgData[] = [];
  try {
    remote = await pullHistory(conversationID, { pageSize });
  } catch {
    // 历史拉取失败保留已有缓存
  }
  return [...local, ...remote];
}

export function markReadUpTo(conversationID: string, hasReadSeq: number): Promise<void> {
  return markConversationRead(conversationID, hasReadSeq);
}
