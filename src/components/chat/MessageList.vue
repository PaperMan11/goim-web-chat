<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
const isPrependingHistory = ref(false);
const anchorScrollTop = ref(0);
const anchorScrollHeight = ref(0);
// 首次滚到底完成前，handleScroll 不触发——初始 scrollTop=0 会被误判为"滑到顶"
const initialScrollDone = ref(false);

function restoreAnchor(): void {
  void nextTick(() => {
    const el = container.value;
    if (!el) return;
    const delta = el.scrollHeight - anchorScrollHeight.value;
    el.scrollTop = anchorScrollTop.value + delta;
  });
}

// ———— 核心：强制滚到底部（rAF 循环覆盖所有异步干扰）————
// 刷新时可能有 N 种异步因素让容器尺寸在"看似稳定"之后继续变化：
//   - Composer 用新布局（表情面板占位、上传进度条预留空间）高度变化
//   - IM 连接状态 banner 出现/消失，整个 ChatLayout 重新分配空间
//   - 图片气泡从 h-32 占位 → 真实尺寸（异步：getFileURL → 换签 → <img> 加载完）
//   - 浏览器 scroll restoration（刷新后恢复上次 scrollTop）
//   - 字体 / CSS transition 异步生效
//
// 单次 scrollTop = scrollHeight 只能搞定当下时刻，之后任何变化都会把位置顶上去。
// 解决方案：requestAnimationFrame 循环，每帧强制 scrollTop = scrollHeight，
// 持续 DURATION_MS 毫秒，覆盖所有上述异步场景。
let bottomForceRafId: number | null = null;

function forceBottom(durationMs = 1500): void {
  if (bottomForceRafId !== null) {
    cancelAnimationFrame(bottomForceRafId);
    bottomForceRafId = null;
  }
  const start = performance.now();
  const frame = (now: number) => {
    const el = container.value;
    if (el && !isPrependingHistory.value) {
      el.scrollTop = el.scrollHeight;
    }
    if (now - start < durationMs) {
      bottomForceRafId = requestAnimationFrame(frame);
    } else {
      bottomForceRafId = null;
      initialScrollDone.value = true;
    }
  };
  bottomForceRafId = requestAnimationFrame(frame);
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
  if (!initialScrollDone.value) return;
  if (el.scrollTop > 40) return;
  if (chat.historyLoading[chat.activeConversationID]) return;
  if (chat.noMoreHistory[chat.activeConversationID]) return;

  anchorScrollTop.value = el.scrollTop;
  anchorScrollHeight.value = el.scrollHeight;

  isPrependingHistory.value = true;
  chat.loadMoreHistory().finally(() => {
    setTimeout(() => {
      isPrependingHistory.value = false;
    }, 50);
  });
}

watch(
  [
    () => chat.activeConversationID,
    () => chat.activeMessages.length,
    () => chat.scrollToLatestTick,
  ],
  ([id, len, tick], [prevId, prevLen, prevTick]) => {
    if (id !== prevId) {
      error.value = '';
      initialScrollDone.value = false;
      isPrependingHistory.value = false;
      forceBottom();
      return;
    }
    if (tick !== prevTick) {
      forceBottom();
      return;
    }
    if (len === prevLen) return;

    if (isPrependingHistory.value) {
      restoreAnchor();
    } else {
      forceBottom();
    }
  },
  { flush: 'post', immediate: true },
);

onMounted(() => {
  // 禁用浏览器 scroll restoration，避免刷新时恢复页面级/容器级 scrollTop
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
});

onBeforeUnmount(() => {
  isPrependingHistory.value = false;
  if (bottomForceRafId !== null) {
    cancelAnimationFrame(bottomForceRafId);
    bottomForceRafId = null;
  }
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
