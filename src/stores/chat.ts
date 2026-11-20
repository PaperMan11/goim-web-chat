// 会话与消息状态：会话列表、当前会话、消息缓存、未读、草稿。

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { MsgStatus, type Conversation, type MsgData, type SendMsgResp } from '@goim/web-sdk';

import {
  fetchConversations,
  getUnreadCount,
  isIMLoggedIn,
  listLocalConversations,
  loadConversationMessages,
  markReadUpTo,
} from '@/services/chat/conversation';
import { mergeMessages } from '@/utils/message';

const DRAFT_KEY = 'goim_chat_drafts';

function loadDrafts(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref<Conversation[]>([]);
  const activeConversationID = ref('');
  const messagesByConversation = ref<Record<string, MsgData[]>>({});
  const unread = ref<Record<string, number>>({});
  const drafts = ref<Record<string, string>>(loadDrafts());
  const loading = ref(false);

  const activeConversation = computed(() =>
    conversations.value.find((c) => c.conversationID === activeConversationID.value),
  );
  const activeMessages = computed(
    () => messagesByConversation.value[activeConversationID.value] ?? [],
  );
  const totalUnread = computed(() =>
    Object.values(unread.value).reduce((sum, n) => sum + (n || 0), 0),
  );

  function sortConversations(): void {
    conversations.value.sort(
      (a, b) => (b.latestMsgSendTime ?? 0) - (a.latestMsgSendTime ?? 0),
    );
  }

  function upsertConversations(list: Conversation[]): void {
    for (const conv of list) {
      if (!conv?.conversationID) continue;
      const index = conversations.value.findIndex(
        (item) => item.conversationID === conv.conversationID,
      );
      if (index >= 0) {
        conversations.value[index] = { ...conversations.value[index], ...conv };
      } else {
        conversations.value.push({ ...conv });
      }
    }
    sortConversations();
  }

  function removeConversation(conversationID: string): void {
    conversations.value = conversations.value.filter(
      (conv) => conv.conversationID !== conversationID,
    );
    delete messagesByConversation.value[conversationID];
  }

  // 乐观消息没有 conversationID 时无法归属会话，直接忽略，避免串会话
  function upsertMessages(list: MsgData[]): void {
    const groups: Record<string, MsgData[]> = {};
    for (const msg of list) {
      const id = msg.conversationID;
      if (!id) continue;
      (groups[id] ??= []).push(msg);
    }
    for (const [id, msgs] of Object.entries(groups)) {
      messagesByConversation.value[id] = mergeMessages(
        messagesByConversation.value[id] ?? [],
        msgs,
      );
    }
  }

  // 发送回包：补 serverMsgID / sendTime 并把状态改为成功
  function markSent(resp: SendMsgResp): void {
    for (const list of Object.values(messagesByConversation.value)) {
      const index = list.findIndex((msg) => msg.clientMsgID === resp.clientMsgID);
      if (index < 0) continue;
      list[index] = {
        ...list[index],
        serverMsgID: resp.serverMsgID,
        sendTime: resp.sendTime,
        status: MsgStatus.SendSuccess,
      };
      return;
    }
  }

  function markFailed(clientMsgID: string): void {
    for (const list of Object.values(messagesByConversation.value)) {
      const index = list.findIndex((msg) => msg.clientMsgID === clientMsgID);
      if (index < 0) continue;
      list[index] = { ...list[index], status: MsgStatus.SendFailed };
      return;
    }
  }

  // 撤回通知：SDK 已更新本地缓存，这里同步内存中对应消息的状态
  function markRevoked(conversationID: string, seq: number): void {
    const list = messagesByConversation.value[conversationID];
    if (!list) return;
    const index = list.findIndex((msg) => msg.seq === seq);
    if (index >= 0) list[index] = { ...list[index], status: MsgStatus.HasDeleted };
  }

  // 登录后立即用本地缓存渲染，不等同步完成
  async function loadCachedConversations(): Promise<void> {
    const list = await listLocalConversations();
    if (list.length) upsertConversations(list);
    await refreshUnread();
  }

  // 同步完成 / 会话变更后刷新本地；本地为空（首次登录）时回退服务端全量
  async function reloadConversations(): Promise<void> {
    await loadCachedConversations();
    if (!conversations.value.length) await loadConversations();
  }

  // 服务端全量会话（手动刷新或本地为空兜底）
  async function loadConversations(): Promise<void> {
    if (!isIMLoggedIn()) return;
    loading.value = true;
    try {
      const list = await fetchConversations();
      if (list.length || !conversations.value.length) {
        upsertConversations(list);
      }
      await refreshUnread();
    } finally {
      loading.value = false;
    }
  }

  // SDK 本地未读：不发网络请求，缓存不完整时结果为下界
  async function refreshUnreadFor(conversationID: string): Promise<void> {
    const count = await getUnreadCount(conversationID);
    if (count !== undefined) unread.value[conversationID] = count;
  }

  async function refreshUnread(): Promise<void> {
    if (!isIMLoggedIn()) return;
    for (const conv of conversations.value) {
      if (conv.conversationID) await refreshUnreadFor(conv.conversationID);
    }
  }

  async function openConversation(conversationID: string): Promise<void> {
    activeConversationID.value = conversationID;
    if (messagesByConversation.value[conversationID]) return;

    const list = await loadConversationMessages(conversationID, 20);
    upsertMessages(list.map((msg) => ({ ...msg, conversationID })));
  }

  async function markActiveRead(): Promise<void> {
    const conversationID = activeConversationID.value;
    if (!conversationID) return;
    const lastSeq = activeMessages.value.reduce(
      (max, msg) => Math.max(max, msg.seq ?? 0),
      0,
    );
    if (lastSeq <= 0) return;
    try {
      await markReadUpTo(conversationID, lastSeq);
      unread.value[conversationID] = 0;
    } catch {
      // 已读上报失败不阻塞 UI
    }
  }

  function setDraft(text: string): void {
    const conversationID = activeConversationID.value;
    if (!conversationID) return;
    drafts.value[conversationID] = text;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts.value));
    } catch {
      // ignore
    }
  }

  function reset(): void {
    conversations.value = [];
    activeConversationID.value = '';
    messagesByConversation.value = {};
    unread.value = {};
    drafts.value = {};
  }

  return {
    conversations,
    activeConversationID,
    messagesByConversation,
    unread,
    drafts,
    loading,
    activeConversation,
    activeMessages,
    totalUnread,
    upsertConversations,
    removeConversation,
    upsertMessages,
    markSent,
    markFailed,
    markRevoked,
    loadCachedConversations,
    reloadConversations,
    loadConversations,
    refreshUnread,
    refreshUnreadFor,
    openConversation,
    markActiveRead,
    setDraft,
    reset,
  };
});
