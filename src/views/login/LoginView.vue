<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { loginWithPassword, registerAndLogin } from '@/services/auth/loginFlow';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { errorMessage } from '@/utils/error';

const auth = useAuthStore();
const router = useRouter();

const mode = ref<'login' | 'register'>('login');
const loginName = ref('');
const password = ref('');
const error = ref('');

const submitting = computed(
  () => auth.loading || auth.stage === AuthStage.IMConnecting,
);

async function submit(): Promise<void> {
  const name = loginName.value.trim();
  const pass = password.value.trim();
  if (!name || !pass) {
    error.value = '请输入账号和密码';
    return;
  }
  error.value = '';
  try {
    if (mode.value === 'login') {
      await loginWithPassword(name, pass);
    } else {
      await registerAndLogin(name, pass);
    }
    // 业务登录成功即可进入聊天页；IM 未就绪时由聊天页展示重试
    if (auth.stage !== AuthStage.Anonymous) {
      await router.push('/chat');
    }
  } catch (err) {
    error.value = errorMessage(err);
  }
}
</script>

<template>
  <div class="flex min-h-full items-center justify-center bg-slate-50 p-6">
    <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <h1 class="mb-1 text-lg font-semibold text-slate-800">goim chat</h1>
      <p class="mb-5 text-xs text-slate-400">账号登录后自动接入 IM</p>

      <div class="mb-4 flex rounded-lg bg-slate-100 p-1 text-sm">
        <button
          class="flex-1 rounded-md py-1.5 transition"
          :class="mode === 'login' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'"
          @click="mode = 'login'"
        >
          登录
        </button>
        <button
          class="flex-1 rounded-md py-1.5 transition"
          :class="mode === 'register' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'"
          @click="mode = 'register'"
        >
          注册
        </button>
      </div>

      <label class="mb-3 block">
        <span class="mb-1 block text-xs text-slate-500">登录名</span>
        <input
          v-model="loginName"
          type="text"
          autocomplete="username"
          placeholder="例如 alice"
          class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
      </label>

      <label class="mb-4 block">
        <span class="mb-1 block text-xs text-slate-500">密码</span>
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="密码"
          class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
          @keyup.enter="submit"
        />
      </label>

      <p v-if="error" class="mb-3 text-xs text-red-500">{{ error }}</p>

      <button
        class="w-full rounded-lg bg-blue-600 py-2 text-sm text-white disabled:opacity-50"
        :disabled="submitting"
        @click="submit"
      >
        {{ submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录' }}
      </button>
    </div>
  </div>
</template>
