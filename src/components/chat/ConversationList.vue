<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  SessionType,
  buildC2CConversationID,
  type Conversation,
} from '@goim/web-sdk';

import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useContactsStore } from '@/stores/contacts';
import Avatar from '@/components/common/Avatar.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { messagePreview } from '@/utils/message';

const chat = useChatStore();
const contacts = useContactsStore();
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const activeID = computed(() => String(route.params.conversationID ?? ''));

interface ConversationItem {
  conv: Conversation;
  conversationID: string;
  title: string;
  avatarUrl: string;
  preview: string;
  draft: string;
  unread: number;
  isPinned: boolean;
}

const items = computed<ConversationItem[]>(() =>
  chat.conversations
    .filter((conv) => conv.conversationID)
    .map((conv) => {
      const isGroup = conv.conversationType === SessionType.Group;
      const peerID = isGroup ? undefined : conv.userID;
      const title = isGroup
        ? conv.msgInfo?.groupName || conv.groupID || conv.conversationID || '(未知群)'
        : contacts.nicknameOf(peerID, conv.msgInfo?.senderName) || '(未知会话)';
      return {
        conv,
        conversationID: conv.conversationID as string,
        title,
        avatarUrl: isGroup
          ? conv.msgInfo?.groupFaceURL || ''
          : contacts.avatarOf(peerID),
        preview: previewOf(conv),
        draft: chat.drafts[conv.conversationID as string]?.trim() ?? '',
        unread: chat.unread[conv.conversationID as string] ?? 0,
        isPinned: Boolean(conv.isPinned),
      };
    }),
);

function previewOf(conv: Conversation): string {
  // 撤回摘要的 content 为空但 contentType=111，统一交给 messagePreview 判定
  return conv.msgInfo ? messagePreview(conv.msgInfo) : '';
}

function select(item: ConversationItem): void {
  // 已在该会话时路由不会变化，主动通知消息区滚到最新
  chat.requestScrollToLatest();
  void router.push({
    name: 'chat-conversation',
    params: { conversationID: item.conversationID },
  });
}

// 调试入口：输入对方 userID，构造单聊 conversationID 并跳转
function startChatWith(): void {
  const peer = window.prompt('输入对方 userID：');
  if (!peer?.trim()) return;
  const conversationID = buildC2CConversationID(auth.userId, peer.trim());
  void router.push({ name: 'chat-conversation', params: { conversationID } });
}

async function loadProfiles(): Promise<void> {
  const ids = chat.conversations
    .filter((conv) => conv.conversationType !== SessionType.Group)
    .map((conv) => conv.userID)
    .filter((id): id is string => Boolean(id) && id !== auth.userId);
  if (ids.length) await contacts.ensureProfiles(ids);
}

onMounted(() => {
  void loadProfiles();
});

watch(
  () => chat.conversations.map((conv) => conv.userID).join(','),
  () => void loadProfiles(),
);
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex items-center justify-between border-b border-slate-200 px-3 py-2">
      <span class="text-sm font-semibold text-slate-700">会话</span>
      <div class="flex items-center gap-2">
        <span class="text-xs text-slate-400">{{ chat.conversations.length }}</span>
        <button
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          title="按 userID 发起单聊（调试）"
          @click="startChatWith"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="h-4 w-4"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>
    </div>

    <EmptyState
      v-if="!chat.conversations.length"
      class="flex-1"
      title="暂无会话"
      desc="收到消息后会出现在这里"
    />

    <ul v-else class="flex-1 overflow-y-auto">
      <li
        v-for="item in items"
        :key="item.conversationID"
        class="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2.5 hover:bg-slate-50"
        :class="item.conversationID === activeID ? 'bg-blue-50' : ''"
        @click="select(item)"
      >
        <Avatar :src="item.avatarUrl" :name="item.title" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1">
              <svg
                v-if="item.isPinned"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="h-3.5 w-3.5 shrink-0 text-amber-500"
              >
                <path d="M12 17v5" />
                <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
              </svg>
              <span class="truncate text-sm font-medium text-slate-800">{{ item.title }}</span>
            </div>
            <span class="shrink-0 text-[11px] text-slate-400">{{
              item.conv.latestMsgSendTime
                ? new Date(item.conv.latestMsgSendTime).toLocaleTimeString()
                : ''
            }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-1 text-xs">
              <template v-if="item.draft && item.conversationID !== activeID">
                <span class="shrink-0 font-medium text-red-500">[草稿]</span>
                <span class="truncate text-slate-400">{{ item.draft }}</span>
              </template>
              <span v-else class="truncate text-slate-400">{{ item.preview }}</span>
            </div>
            <span
              v-if="item.unread > 0"
              class="shrink-0 rounded-full bg-red-500 px-1.5 text-[11px] text-white"
            >
              {{ item.unread > 99 ? '99+' : item.unread }}
            </span>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
