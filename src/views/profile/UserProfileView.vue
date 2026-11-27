<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { buildC2CConversationID } from '@goim/web-sdk';

import Avatar from '@/components/common/Avatar.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { useAuthStore } from '@/stores/auth';
import { useContactsStore } from '@/stores/contacts';

// 用户资料详情：数据来自 contacts 缓存，未命中走 GET /profile/users/{userId}
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const contacts = useContactsStore();

const userId = computed(() => String(route.params.userId ?? ''));
const isSelf = computed(() => Boolean(userId.value) && userId.value === auth.userId);
const loading = ref(false);
const notFound = ref(false);

const nickname = computed(
  () =>
    contacts.profiles[userId.value]?.nickname ||
    (isSelf.value ? auth.displayName : '') ||
    userId.value,
);
const avatarUrl = computed(
  () =>
    contacts.profiles[userId.value]?.avatarUrl ||
    (isSelf.value ? auth.avatarUrl : ''),
);

watch(
  userId,
  async (id) => {
    notFound.value = false;
    if (!id) return;
    loading.value = true;
    try {
      const profile = await contacts.ensureProfile(id);
      notFound.value = !profile;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function openChat(): void {
  void router.push({
    name: 'chat-conversation',
    params: { conversationID: buildC2CConversationID(auth.userId, userId.value) },
  });
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
    <header class="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
      <button
        type="button"
        class="text-xs text-slate-400 hover:text-slate-600"
        @click="router.back()"
      >
        返回
      </button>
      <h2 class="text-sm font-semibold text-slate-800">用户资料</h2>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <EmptyState v-if="loading" title="加载中…" />
      <EmptyState v-else-if="notFound" title="用户不存在" desc="该用户可能已注销" />
      <section v-else class="flex flex-col items-center gap-3 py-6">
        <Avatar size="lg" :src="avatarUrl" :name="nickname" />
        <div class="text-center">
          <p class="text-base font-medium text-slate-800">{{ nickname }}</p>
          <p class="mt-1 text-xs text-slate-400">用户 ID：{{ userId }}</p>
        </div>
        <div v-if="!isSelf" class="flex items-center gap-2">
          <button
            type="button"
            class="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500"
            @click="openChat"
          >
            发消息
          </button>
        </div>
        <p v-else class="text-xs text-slate-400">这是你自己的公开资料，可在设置中修改</p>
      </section>
    </main>
  </div>
</template>
