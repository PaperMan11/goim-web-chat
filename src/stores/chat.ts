// 会话与消息状态：会话列表、当前会话、消息缓存、未读、草稿。

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  MsgStatus,
  SessionType,
  parseConversationID,
  type Conversation,
  type MsgData,
  type SendMsgResp,
} from '@goim/web-sdk';

import { useAuthStore } from '@/stores/auth';

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
  // 会话列表：来自 SDK local.listConversations（本地优先）或服务端全量刷新，
  // 会话变更/新消息推送后由 reloadConversations 或 upsertConversations 增量合并。
  const conversations = ref<Conversation[]>([]);
  // 当前选中的会话 ID，与路由 /chat/:conversationID 双向同步。
  const activeConversationID = ref('');
  // 消息缓存：按 conversationID 分组，loadConversationMessages / upsertMessages 写入，
  // 新消息推送与发送回包都走 upsertMessages → mergeMessages 去重合并。
  const messagesByConversation = ref<Record<string, MsgData[]>>({});
  // 各会话未读数：异步调用 SDK local.unreadCount 填入，是下界（本地不完整时偏小）。
  const unread = ref<Record<string, number>>({});
  // 草稿：localStorage 持久化，按 conversationID 隔离，Composer 失焦自动保存。
  const drafts = ref<Record<string, string>>(loadDrafts());
  // 已读上报水位：每个会话上次成功 markReadUpTo 上报到服务端的 seq，
  // 只有新 seq > 这个水位才再次上报，避免心跳式重复请求。
  const lastMarkedReadSeq = ref<Record<string, number>>({});
  // 页面可见性：浏览器 tab 不可见时暂停自动已读（新消息仍计未读），
  // 恢复可见且仍停留在会话上时补一次 markActiveRead。
  const isPageVisible = ref(document.visibilityState === 'visible');
  // loadConversations 服务端全量会话拉取时的 loading 标记。
  const loading = ref(false);

  // 仅从 conversationID 推导最小 Conversation（用于会话还没进本地列表的首聊/调试场景）
  function deriveConversationFromID(conversationID: string): Conversation | undefined {
    const parsed = parseConversationID(conversationID);
    if (parsed.kind === 'unknown') return undefined;

    if (parsed.kind === 'c2c' && parsed.userIDs) {
      const me = useAuthStore().userId;
      const peer = parsed.userIDs.find((id) => id !== me) ?? parsed.userIDs[0];
      return {
        conversationID,
        conversationType: SessionType.C2C,
        userID: peer,
      } as Conversation;
    }
    if (
      (parsed.kind === 'group' || parsed.kind === 'superGroup') &&
      parsed.groupID
    ) {
      return {
        conversationID,
        conversationType: SessionType.Group,
        groupID: parsed.groupID,
      } as Conversation;
    }
    return undefined;
  }

  // 重复点入同一会话时路由不变、消息数不变，用递增计数通知 MessageList 滚到最新
  const scrollToLatestTick = ref(0);

  function requestScrollToLatest(): void {
    scrollToLatestTick.value += 1;
  }

  const activeConversation = computed<Conversation | undefined>(() => {
    const id = activeConversationID.value;
    if (!id) return undefined;
    const found = conversations.value.find((c) => c.conversationID === id);
    if (found) return found;

    // 调试/首聊场景：会话还没进本地列表，按 conversationID 推导最小 Conversation
    return deriveConversationFromID(id);
  });
  const activeMessages = computed(
    () => messagesByConversation.value[activeConversationID.value] ?? [],
  );
  const totalUnread = computed(() =>
    Object.values(unread.value).reduce((sum, n) => sum + (n || 0), 0),
  );

  // 与 Local.ListConversations 一致：置顶优先 + 最后消息时间倒序
  function sortConversations(): void {
    conversations.value.sort(
      (a, b) =>
        Number(b.isPinned ?? false) - Number(a.isPinned ?? false) ||
        (b.latestMsgSendTime ?? 0) - (a.latestMsgSendTime ?? 0),
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
  // 并发刷新（连续消息触发多次）时只应用最新一次快照，避免旧摘要覆盖新摘要
  let cachedLoadSeq = 0;
  async function loadCachedConversations(): Promise<void> {
    const seq = ++cachedLoadSeq;
    const list = await listLocalConversations();
    if (seq !== cachedLoadSeq) return;
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

  // 本地未读：传入会话 ID 时只刷新这些（新消息到达避免全量扫描），不传刷新全部
  async function refreshUnread(conversationIDs?: string[]): Promise<void> {
    if (!isIMLoggedIn()) return;
    const ids = conversationIDs?.length
      ? conversationIDs
      : conversations.value
          .map((conv) => conv.conversationID)
          .filter((id): id is string => Boolean(id));
    for (const id of ids) await refreshUnreadFor(id);
  }

  async function openConversation(conversationID: string): Promise<void> {
    activeConversationID.value = conversationID;
    if (messagesByConversation.value[conversationID]) return;

    const list = await loadConversationMessages(conversationID, 20);
    upsertMessages(list.map((msg) => ({ ...msg, conversationID })));
  }

  // 登录就绪后补载当前会话：直接刷新 /chat/:id 时 ChatView 先于 IM 登录执行，
  // 首轮本地读取与远端拉取都会失败，需要登录后重试一次
  async function reloadActiveConversation(): Promise<void> {
    const conversationID = activeConversationID.value;
    if (!conversationID) return;
    if ((messagesByConversation.value[conversationID] ?? []).length) return;

    const list = await loadConversationMessages(conversationID, 20);
    if (!list.length) return;
    upsertMessages(list.map((msg) => ({ ...msg, conversationID })));
    await markActiveRead();
  }

  async function markActiveRead(): Promise<void> {
    const conversationID = activeConversationID.value;
    if (!conversationID || !isPageVisible.value) return;
    const lastSeq = activeMessages.value.reduce(
      (max, msg) => Math.max(max, msg.seq ?? 0),
      0,
    );
    if (lastSeq <= 0) return;

    const previous = lastMarkedReadSeq.value[conversationID] ?? 0;
    // 没有新消息 seq 超过已上报水位，跳过服务端请求
    if (lastSeq <= previous) {
      unread.value[conversationID] = 0;
      return;
    }

    // 本次新标记已读的 seq 一并上报：服务端对单聊只有收到 seqs 才会落
    // per-message 已读，否则重新拉取历史会回传 isRead=false，未读复现
    const seqs = activeMessages.value
      .filter((msg) => (msg.seq ?? 0) > previous && (msg.seq ?? 0) <= lastSeq)
      .map((msg) => msg.seq as number);

    try {
      await markReadUpTo(conversationID, lastSeq, seqs);
      lastMarkedReadSeq.value[conversationID] = lastSeq;
      unread.value[conversationID] = 0;
    } catch {
      // 已读上报失败不阻塞 UI，下次 markActiveRead 会重试（因为水位还没更新）
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
    lastMarkedReadSeq.value = {};
  }

  // 浏览器 tab 可见性监听：hidden 期间新消息正常计未读（loginFlow 判断），
  // visible 恢复且仍停留在会话上时补一次已读上报。
  document.addEventListener('visibilitychange', () => {
    isPageVisible.value = document.visibilityState === 'visible';
    if (isPageVisible.value && activeConversationID.value) void markActiveRead();
  });

  return {
    conversations,
    activeConversationID,
    messagesByConversation,
    unread,
    drafts,
    isPageVisible,
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
    reloadActiveConversation,
    scrollToLatestTick,
    requestScrollToLatest,
    markActiveRead,
    setDraft,
    reset,
  };
});
