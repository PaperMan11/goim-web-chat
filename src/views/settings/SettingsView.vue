<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { SyncState, TransportStatus } from '@goim/web-sdk';

import Avatar from '@/components/common/Avatar.vue';
import { logoutAccount, retryIM } from '@/services/auth/loginFlow';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';

const auth = useAuthStore();
const chat = useChatStore();
const router = useRouter();

const showRetry = computed(
  () => Boolean(auth.imError) || auth.stage === AuthStage.BizAuthenticated,
);

const statusText = computed(() =>
  ({
    [TransportStatus.Connected]: '已连接',
    [TransportStatus.Connecting]: '连接中',
    [TransportStatus.Disconnected]: '未连接',
  })[auth.transportStatus] ?? '未知',
);

const syncText = computed(() =>
  ({
    [SyncState.None]: '未同步',
    [SyncState.Syncing]: '同步中',
    [SyncState.Synced]: '已同步',
    [SyncState.Failed]: '同步失败',
  })[auth.syncState] ?? '未知',
);

async function onRetry(): Promise<void> {
  await retryIM();
}

async function onLogout(): Promise<void> {
  await logoutAccount();
  await router.push('/login');
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <section class="mb-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h2 class="mb-3 text-xs font-medium text-slate-500">账号</h2>
        <div class="flex items-center gap-3">
          <Avatar size="lg" :src="auth.avatarUrl" :name="auth.displayName" />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-slate-800">{{ auth.displayName }}</p>
            <p class="truncate text-xs text-slate-400">
              {{ auth.loginName }} · {{ auth.userId }}
            </p>
          </div>
        </div>
      </section>

      <section class="mb-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h2 class="mb-3 text-xs font-medium text-slate-500">连接</h2>
        <dl class="space-y-2 text-xs">
          <div class="flex justify-between">
            <dt class="text-slate-500">传输层</dt>
            <dd class="text-slate-800">{{ statusText }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-slate-500">消息同步</dt>
            <dd class="text-slate-800">{{ syncText }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-slate-500">会话数</dt>
            <dd class="text-slate-800">{{ chat.conversations.length }}</dd>
          </div>
        </dl>
        <p v-if="auth.imError" class="mt-3 text-xs text-red-500">{{ auth.imError }}</p>
        <button
          v-if="showRetry"
          class="mt-3 rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          @click="onRetry"
        >
          重试 IM 连接
        </button>
      </section>

      <section class="rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <button class="text-sm text-red-500 hover:text-red-600" @click="onLogout">
          退出登录
        </button>
      </section>
    </main>
  </div>
</template>
