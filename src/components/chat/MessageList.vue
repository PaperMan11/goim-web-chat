<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { SessionType, type MsgData } from '@goim/web-sdk';

import { retryMessage } from '@/services/chat/send';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useContactsStore } from '@/stores/contacts';
import { errorMessage } from '@/utils/error';
import EmptyState from '@/components/common/EmptyState.vue';
import MessageBubble from './MessageBubble.vue';

const chat = useChatStore();
const auth = useAuthStore();
const contacts = useContactsStore();

const container = ref<HTMLDivElement>();
const error = ref('');

// 上滑加载历史时维持锚点：prepend 历史消息后用户看到的那条不能跳
// 设为 true 时 watcher 不滚到底、而是恢复 scrollTop
const isPrependingHistory = ref(false);
// 触发 prepend 前保存：scrollTop + scrollHeight_old（要保持的绝对值）
const anchorBottom = ref(0);

function scrollToBottom(): void {
  void nextTick(() => {
    const el = container.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      if (container.value) container.value.scrollTop = container.value.scrollHeight;
    });
  });
}

function restoreAnchor(): void {
  void nextTick(() => {
    const el = container.value;
    if (!el) return;
    // 保持 prepend 前 scrollTop + 距底部的距离之和：用户正看的那条不动
    el.scrollTop = anchorBottom.value - (el.scrollHeight - el.scrollTop);
  });
}

function isMine(msg: MsgData): boolean {
  return msg.sendID === auth.userId;
}

function nicknameOf(msg: MsgData): string {
  if (isMine(msg)) return '';
  return contacts.nicknameOf(msg.sendID, msg.senderNickname);
}

async function onRetry(msg: MsgData): Promise<void> {
  error.value = '';
  try {
    await retryMessage(msg);
  } catch (err) {
    error.value = errorMessage(err);
  }
}

// 上滑到顶部附近触发历史加载；prepend 历史后维持滚动锚点
function handleScroll(): void {
  const el = container.value;
  if (!el) return;
  // 不是新会话/不是从底部自然加载的场景才触发（避免新会话打开时误判）
  if (el.scrollTop > 40) return;
  // 正在加载或到底了就跳过
  if (chat.historyLoading[chat.activeConversationID]) return;
  if (chat.noMoreHistory[chat.activeConversationID]) return;

  // 记录当前位置锚点：scrollTop + scrollHeight 保持这条线不变，
  // prepend 后 scrollTop_new = anchorBottom - (scrollHeight_new - scrollTop_new)
  anchorBottom.value = el.scrollTop + (el.scrollHeight - el.scrollTop);

  isPrependingHistory.value = true;
  chat.loadMoreHistory().finally(() => {
    // prepend 后的 watcher 会消费这个 flag
    setTimeout(() => {
      isPrependingHistory.value = false;
    }, 50);
  });
}

// 进入/切换会话、消息增减、滚动触发历史都走这里
// - 会话切换 / tick 变化 → 滚到底部
// - prepend 历史（isPrependingHistory=true）→ 恢复锚点（用户看的那条不动）
// - len 增加（自己发 / 别人推 / 首次加载）→ 无条件滚到底
//   注：不能用"底部附近才滚"判断，因为 flush:post 时 scrollHeight 已包含新消息，
//   用户的 scrollTop 却还是加消息前的值，差值大于阈值导致条件恒不成立。
watch(
  [
    () => chat.activeConversationID,
    () => chat.activeMessages.length,
    () => chat.scrollToLatestTick,
  ],
  ([id, len, tick], [prevId, prevLen, prevTick]) => {
    if (id !== prevId) {
      error.value = '';
      scrollToBottom();
      return;
    }
    if (tick !== prevTick) {
      scrollToBottom();
      return;
    }
    // 同一会话消息数没变：可能只是状态更新（SendSuccess / HasDeleted），不滚
    if (len === prevLen) return;

    if (isPrependingHistory.value) {
      restoreAnchor();
    } else {
      // len 增加（首次加载 / 发送 / 收到推送）→ 滚到底
      scrollToBottom();
    }
  },
  { flush: 'post', immediate: true },
);

onBeforeUnmount(() => {
  isPrependingHistory.value = false;
});

const conversationTitle = computed((): string => {
  const conv = chat.activeConversation;
  if (!conv) return '';
  if (conv.conversationType === SessionType.Group) {
    return conv.msgInfo?.groupName || conv.groupID || '(未知群)';
  }
  return contacts.nicknameOf(conv.userID, conv.msgInfo?.senderName) || '(未知会话)';
});

const showHistoryLoading = computed(
  () => chat.historyLoading[chat.activeConversationID] && chat.activeMessages.length > 0,
);
const showNoMore = computed(
  () => chat.noMoreHistory[chat.activeConversationID] && chat.activeMessages.length > 0,
);
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
      {{ conversationTitle }}
    </div>

    <div
      ref="container"
      @scroll.passive="handleScroll"
      class="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-3"
    >
      <div
        v-if="showHistoryLoading"
        class="flex justify-center text-xs text-slate-400 py-1"
      >
        加载更多…
      </div>
      <div
        v-else-if="showNoMore"
        class="flex justify-center text-xs text-slate-400 py-1"
      >
        — 没有更早的消息 —
      </div>

      <EmptyState
        v-if="!chat.activeMessages.length"
        title="暂无消息"
        desc="发送第一条消息开始聊天"
      />
      <MessageBubble
        v-for="(msg, index) in chat.activeMessages"
        :key="msg.serverMsgID || msg.clientMsgID || index"
        :msg="msg"
        :mine="isMine(msg)"
        :nickname="nicknameOf(msg)"
        @retry="onRetry"
      />
    </div>

    <p v-if="error" class="border-t border-slate-200 px-4 py-1 text-xs text-red-500">
      {{ error }}
    </p>
  </div>
</template>
