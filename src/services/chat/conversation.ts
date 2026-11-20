// 会话与消息读取编排：会话列表、本地/远端历史、未读、已读上报。
// stores 不直接接触 im 层，所有 SDK 调用集中在这里。

import type { Conversation, MsgData } from '@goim/web-sdk';

import { getIM } from '@/im/client';
import { loadLocalMessages, markConversationRead, pullHistory } from '@/im/message';

// IM 是否已登录（以当前用户为准）
export function isIMLoggedIn(): boolean {
  return Boolean(getIM()?.currentUserID);
}

// 本地 IndexedDB 会话缓存：同步未完成时可能不完整，但可先渲染
export async function listLocalConversations(): Promise<Conversation[]> {
  const instance = getIM();
  if (!instance?.currentUserID) return [];
  try {
    return await instance.conversations.listLocal();
  } catch {
    return [];
  }
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

// 本地未读数（不发网络请求；缓存不完整时为下界）
export async function getUnreadCount(conversationID: string): Promise<number | undefined> {
  const instance = getIM();
  if (!instance?.currentUserID || !conversationID) return undefined;
  try {
    return await instance.conversations.unreadCount(conversationID);
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
