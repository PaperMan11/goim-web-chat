<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { SyncState, TransportStatus } from '@goim/web-sdk';

import Avatar from '@/components/common/Avatar.vue';
import { logoutAccount, retryIM } from '@/services/auth/loginFlow';
import { saveMyProfile, uploadAvatar } from '@/services/auth/profile';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { errorMessage } from '@/utils/error';
import { AVATAR_ACCEPT } from '@/utils/file';

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

// ———— 资料编辑 ————
const nickname = ref('');
const bio = ref('');
const profileSaving = ref(false);
const profileMsg = ref('');
const profileError = ref('');

// auth.me 异步加载完成（登录后 afterReady）时回填表单
watch(
  () => auth.me,
  (me) => {
    if (!me) return;
    nickname.value = me.nickname;
    bio.value = me.bio;
  },
  { immediate: true },
);

async function onSaveProfile(): Promise<void> {
  if (profileSaving.value) return;
  profileMsg.value = '';
  profileError.value = '';
  profileSaving.value = true;
  try {
    await saveMyProfile({
      nickname: nickname.value.trim(),
      bio: bio.value.trim(),
    });
    profileMsg.value = '资料已保存';
  } catch (err) {
    profileError.value = errorMessage(err);
  } finally {
    profileSaving.value = false;
  }
}

// ———— 头像上传 ————
const avatarInput = ref<HTMLInputElement>();
const avatarUploading = ref(false);
const avatarPercent = ref(0);

function pickAvatar(): void {
  if (avatarUploading.value) return;
  avatarInput.value?.click();
}

async function onAvatarChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  profileMsg.value = '';
  profileError.value = '';
  avatarUploading.value = true;
  avatarPercent.value = 0;
  try {
    await uploadAvatar(file, ({ bytes, total }) => {
      avatarPercent.value = total > 0 ? Math.round((bytes / total) * 100) : 0;
    });
    profileMsg.value = '头像已更新';
  } catch (err) {
    profileError.value = errorMessage(err);
  } finally {
    avatarUploading.value = false;
  }
}

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
        <h2 class="mb-3 text-xs font-medium text-slate-500">资料</h2>
        <div class="flex items-start gap-3">
          <button
            type="button"
            class="group relative shrink-0 rounded-full"
            :disabled="avatarUploading"
            title="点击更换头像"
            @click="pickAvatar"
          >
            <Avatar size="lg" :src="auth.avatarUrl" :name="auth.displayName" />
            <span
              class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[11px] text-white opacity-0 transition group-hover:opacity-100"
            >
              {{ avatarUploading ? `${avatarPercent}%` : '更换' }}
            </span>
          </button>
          <div class="min-w-0 flex-1 space-y-2">
            <label class="block">
              <span class="mb-1 block text-[11px] text-slate-500">昵称</span>
              <input
                v-model="nickname"
                maxlength="32"
                class="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
              />
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] text-slate-500">签名</span>
              <textarea
                v-model="bio"
                rows="2"
                maxlength="100"
                class="w-full resize-none rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
              />
            </label>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
                :disabled="profileSaving"
                @click="onSaveProfile"
              >
                {{ profileSaving ? '保存中…' : '保存资料' }}
              </button>
              <span v-if="profileMsg" class="text-xs text-green-600">{{ profileMsg }}</span>
              <span v-if="profileError" class="text-xs text-red-500">{{ profileError }}</span>
            </div>
          </div>
        </div>
        <input
          ref="avatarInput"
          type="file"
          class="hidden"
          :accept="AVATAR_ACCEPT"
          @change="onAvatarChange"
        />
      </section>

      <section class="mb-4 rounded-lg bg-white p-4 ring-1 ring-slate-200">
        <h2 class="mb-3 text-xs font-medium text-slate-500">账号</h2>
        <dl class="space-y-2 text-xs">
          <div class="flex justify-between">
            <dt class="text-slate-500">登录名</dt>
            <dd class="text-slate-800">{{ auth.loginName }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-slate-500">用户 ID</dt>
            <dd class="text-slate-800">{{ auth.userId }}</dd>
          </div>
        </dl>
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
