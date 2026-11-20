<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';

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
    if (!id) return;
    void openConversation(id);
  },
  { immediate: true },
);

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
