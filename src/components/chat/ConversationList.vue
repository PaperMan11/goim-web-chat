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
  unread: number;
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
        unread: chat.unread[conv.conversationID as string] ?? 0,
      };
    }),
);

function previewOf(conv: Conversation): string {
  const content = conv.msgInfo?.content ?? '';
  if (!content) return conv.draftText ? `[草稿] ${conv.draftText}` : '';
  return messagePreview(conv.msgInfo);
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
            <span class="truncate text-sm font-medium text-slate-800">{{ item.title }}</span>
            <span class="shrink-0 text-[11px] text-slate-400">{{
              item.conv.latestMsgSendTime
                ? new Date(item.conv.latestMsgSendTime).toLocaleTimeString()
                : ''
            }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-xs text-slate-400">{{ item.preview }}</span>
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
