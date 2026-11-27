<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';

import EmptyState from '@/components/common/EmptyState.vue';
import {
  isCurrentDevice,
  loadDevices,
  removeDeviceByID,
  type DeviceView,
} from '@/services/account/devices';
import { errorMessage } from '@/utils/error';
import { platformLabel } from '@/utils/platform';
import { formatDateTime } from '@/utils/time';

const devices = ref<DeviceView[]>([]);
const loading = ref(false);
const error = ref('');
const removingID = ref('');

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    devices.value = await loadDevices();
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function onRemove(device: DeviceView): Promise<void> {
  if (isCurrentDevice(device.deviceId) || removingID.value) return;
  if (!window.confirm('移除设备会同时撤销该设备上的全部登录会话，确认继续？')) return;
  error.value = '';
  removingID.value = device.deviceId;
  try {
    await removeDeviceByID(device.deviceId);
    devices.value = devices.value.filter((item) => item.deviceId !== device.deviceId);
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    removingID.value = '';
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
        <h2 class="text-sm font-semibold text-slate-800">我的设备</h2>
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
      <p class="mb-2 text-xs text-slate-400">
        设备随注册/登录自动登记，按最近活跃时间倒序；当前设备不可移除。
      </p>
      <EmptyState v-if="loading && !devices.length" title="加载中…" />
      <EmptyState v-else-if="!devices.length && !error" title="暂无设备" />
      <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-200">
        <li
          v-for="device in devices"
          :key="device.deviceId"
          class="flex items-start justify-between gap-3 px-3 py-2.5"
        >
          <div class="min-w-0 text-xs">
            <p class="flex items-center gap-2 text-sm text-slate-800">
              {{ platformLabel(device.platform) }}
              <span
                v-if="isCurrentDevice(device.deviceId)"
                class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600"
              >
                本机
              </span>
            </p>
            <p class="mt-1 truncate text-slate-500">设备：{{ device.deviceId }}</p>
            <p class="truncate text-slate-400">版本：{{ device.appVersion || '-' }}</p>
            <p class="truncate text-slate-400">
              最近活跃 {{ formatDateTime(device.lastActiveAt) }}
            </p>
          </div>
          <button
            v-if="!isCurrentDevice(device.deviceId)"
            type="button"
            class="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            :disabled="removingID === device.deviceId"
            @click="onRemove(device)"
          >
            {{ removingID === device.deviceId ? '移除中…' : '移除' }}
          </button>
        </li>
      </ul>
      <p v-if="error" class="mt-3 text-xs text-red-500">{{ error }}</p>
    </main>
  </div>
</template>
