<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
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

function scrollToBottom(): void {
  void nextTick(() => {
    const el = container.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // 图片/多行文本布局可能在本帧后才稳定，下一帧再校准一次
    requestAnimationFrame(() => {
      if (container.value) container.value.scrollTop = container.value.scrollHeight;
    });
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

// 进入/切换会话、消息增减（发送、收到、历史加载）、重复点入同一会话
// 都滚到最新。用 flush: 'post' 保证在 DOM patch 之后执行。
watch(
  [
    () => chat.activeConversationID,
    () => chat.activeMessages.length,
    () => chat.scrollToLatestTick,
  ],
  ([id], [prevId]) => {
    if (id !== prevId) error.value = '';
    scrollToBottom();
  },
  { flush: 'post', immediate: true },
);

const conversationTitle = (): string => {
  const conv = chat.activeConversation;
  if (!conv) return '';
  if (conv.conversationType === SessionType.Group) {
    return conv.msgInfo?.groupName || conv.groupID || '(未知群)';
  }
  return contacts.nicknameOf(conv.userID, conv.msgInfo?.senderName) || '(未知会话)';
};
</script>

<template>
  <div class="flex min-h-0 flex-col">
    <div class="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
      {{ conversationTitle() }}
    </div>

    <div ref="container" class="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-4 py-3">
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
