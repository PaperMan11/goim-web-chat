<script setup lang="ts">
import { computed, watch } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';

import Composer from '@/components/chat/Composer.vue';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageList from '@/components/chat/MessageList.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { useChatStore } from '@/stores/chat';

// 聊天内容区：会话列表 + 消息面板，外壳由 ChatLayout 提供
const chat = useChatStore();
const route = useRoute();

const conversationID = computed(() => String(route.params.conversationID ?? ''));

watch(
  conversationID,
  (id) => {
    if (!id) {
      // /chat/:id → /chat（同组件不触发 unmount），也要清空当前会话
      chat.activeConversationID = '';
      return;
    }
    void openConversation(id);
  },
  { immediate: true },
);

// 离开会话路由（去通讯录/设置/会话列表）时清空当前会话，
// 避免后续新消息被误判为"正在查看"而自动已读。
// 注意用路由守卫而非 onUnmounted：组件因其他原因重建时，
// 旧实例 unmount 可能晚于新实例设置 activeConversationID，会误清。
onBeforeRouteLeave((to) => {
  if (to.name !== 'chat-conversation') {
    chat.activeConversationID = '';
  }
});

async function openConversation(id: string): Promise<void> {
  await chat.openConversation(id);
  await chat.markActiveRead();
}
</script>

<template>
  <div class="flex h-full min-h-0 gap-3">
    <aside class="w-72 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
      <ConversationList />
    </aside>

    <section
      class="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200"
    >
      <template v-if="chat.activeConversation">
        <MessageList class="flex-1" />
        <Composer />
      </template>
      <EmptyState
        v-else
        class="flex-1"
        title="选择一个会话"
        desc="从左侧列表打开会话开始聊天"
      />
    </section>
  </div>
</template>
