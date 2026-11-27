<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';

import EmptyState from '@/components/common/EmptyState.vue';
import {
  kickSession,
  loadSessions,
  type SessionView,
} from '@/services/account/sessions';
import { errorMessage } from '@/utils/error';
import { platformLabel } from '@/utils/platform';
import { formatDateTime } from '@/utils/time';

const sessions = ref<SessionView[]>([]);
const loading = ref(false);
const error = ref('');
const revokingID = ref('');

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    sessions.value = await loadSessions();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function onRevoke(session: SessionView): Promise<void> {
  if (session.current || revokingID.value) return;
  if (!window.confirm('踢出后该设备需要重新登录，确认继续？')) return;
  error.value = '';
  revokingID.value = session.sessionId;
  try {
    await kickSession(session.sessionId);
    sessions.value = sessions.value.filter((item) => item.sessionId !== session.sessionId);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    revokingID.value = '';
  }
}

onMounted(() => {
  void refresh();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
    <header class="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
      <div class="flex items-center gap-2">
        <RouterLink to="/settings" class="text-xs text-slate-400 hover:text-slate-600">
          返回设置
        </RouterLink>
        <h2 class="text-sm font-semibold text-slate-800">登录会话</h2>
      </div>
      <button
        type="button"
        class="text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        :disabled="loading"
        @click="refresh"
      >
        刷新
      </button>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <p class="mb-2 text-xs text-slate-400">踢出会话后，该设备上的登录态立即失效，需重新登录。</p>
      <EmptyState v-if="loading && !sessions.length" title="加载中…" />
      <EmptyState v-else-if="!sessions.length && !error" title="暂无登录会话" />
      <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-200">
        <li
          v-for="session in sessions"
          :key="session.sessionId"
          class="flex items-start justify-between gap-3 px-3 py-2.5"
        >
          <div class="min-w-0 text-xs">
            <p class="flex items-center gap-2 text-sm text-slate-800">
              {{ platformLabel(session.platform) }}
              <span
                v-if="session.current"
                class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600"
              >
                当前会话
              </span>
            </p>
            <p class="mt-1 truncate text-slate-500">设备：{{ session.deviceId }}</p>
            <p class="truncate text-slate-400">IP：{{ session.ip || '-' }}</p>
            <p class="truncate text-slate-400">登录于 {{ formatDateTime(session.createdAt) }}</p>
            <p class="truncate text-slate-400">有效期至 {{ formatDateTime(session.expiresAt) }}</p>
          </div>
          <button
            v-if="!session.current"
            type="button"
            class="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            :disabled="revokingID === session.sessionId"
            @click="onRevoke(session)"
          >
            {{ revokingID === session.sessionId ? '踢出中…' : '踢出' }}
          </button>
        </li>
      </ul>
      <p v-if="error" class="mt-3 text-xs text-red-500">{{ error }}</p>
    </main>
  </div>
</template>
