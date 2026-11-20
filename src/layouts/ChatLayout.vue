<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { SyncState, TransportStatus } from '@goim/web-sdk';

import Avatar from '@/components/common/Avatar.vue';
import { logoutAccount, retryIM } from '@/services/auth/loginFlow';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';

// 登录后的统一外壳：顶栏 + 左侧主导航 + RouterView 内容区
const auth = useAuthStore();
const chat = useChatStore();
const router = useRouter();

const navItems = [
  { to: '/chat', label: '会话' },
  { to: '/contacts', label: '联系人' },
  { to: '/settings', label: '设置' },
];

const showIMBanner = computed(
  () => Boolean(auth.imError) || auth.stage === AuthStage.BizAuthenticated,
);

const statusText = computed(() => {
  switch (auth.transportStatus) {
    case TransportStatus.Connected:
      return '已连接';
    case TransportStatus.Connecting:
      return '连接中';
    default:
      return '未连接';
  }
});

const statusTone = computed(() => {
  switch (auth.transportStatus) {
    case TransportStatus.Connected:
      return 'bg-emerald-500';
    case TransportStatus.Connecting:
      return 'bg-amber-500';
    default:
      return 'bg-slate-300';
  }
});

const syncText = computed(() => {
  switch (auth.syncState) {
    case SyncState.Syncing:
      return '同步中';
    case SyncState.Synced:
      return '已同步';
    case SyncState.Failed:
      return '同步失败';
    default:
      return '未同步';
  }
});

async function onRetryIM(): Promise<void> {
  await retryIM();
}

async function onLogout(): Promise<void> {
  await logoutAccount();
  await router.push('/login');
}
</script>

<template>
  <div class="flex h-full flex-col bg-slate-100">
    <header class="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
      <div class="flex items-center gap-3">
        <span class="text-sm font-semibold text-slate-800">goim chat</span>
        <span class="flex items-center gap-1 text-xs text-slate-500">
          <i class="h-2 w-2 rounded-full" :class="statusTone" />
          {{ statusText }} · {{ syncText }}
        </span>
        <span v-if="chat.totalUnread" class="text-xs text-red-500">
          {{ chat.totalUnread }} 条未读
        </span>
      </div>

      <div class="flex items-center gap-2">
        <Avatar size="sm" :src="auth.avatarUrl" :name="auth.displayName" />
        <span class="max-w-[120px] truncate text-xs text-slate-600">{{
          auth.displayName
        }}</span>
        <button class="text-xs text-slate-400 hover:text-red-500" @click="onLogout">
          退出
        </button>
      </div>
    </header>

    <div
      v-if="showIMBanner"
      class="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700"
    >
      <span>{{ auth.imError || 'IM 尚未就绪，请重试连接' }}</span>
      <button
        class="rounded border border-amber-300 px-2 py-1 hover:bg-amber-100"
        @click="onRetryIM"
      >
        重试连接
      </button>
    </div>

    <div class="flex min-h-0 flex-1 gap-3 p-3">
      <nav
        class="flex w-16 shrink-0 flex-col gap-1 rounded-lg bg-white p-1.5 ring-1 ring-slate-200"
      >
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="rounded-md px-1 py-2 text-center text-xs text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          active-class="bg-blue-50 text-blue-600 hover:bg-blue-50 hover:text-blue-600"
        >
          {{ item.label }}
        </RouterLink>
      </nav>

      <div class="min-h-0 min-w-0 flex-1">
        <RouterView />
      </div>
    </div>
  </div>
</template>
