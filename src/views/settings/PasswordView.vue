<script setup lang="ts">
import { ref } from 'vue';
import { RouterLink } from 'vue-router';

import { changeAccountPassword } from '@/services/account/password';
import { errorMessage } from '@/utils/error';

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const saving = ref(false);
const message = ref('');
const error = ref('');

async function onSubmit(): Promise<void> {
  if (saving.value) return;
  message.value = '';
  error.value = '';
  if (newPassword.value !== confirmPassword.value) {
    error.value = '两次输入的新密码不一致';
    return;
  }
  saving.value = true;
  try {
    await changeAccountPassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value,
    });
    message.value = '密码已修改，其它设备已下线';
    oldPassword.value = '';
    newPassword.value = '';
    confirmPassword.value = '';
  } catch (err) {
    error.value = errorMessage(err);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
    <header class="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
      <RouterLink to="/settings" class="text-xs text-slate-400 hover:text-slate-600">
        返回设置
      </RouterLink>
      <h2 class="text-sm font-semibold text-slate-800">修改密码</h2>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <form class="max-w-sm space-y-3" @submit.prevent="onSubmit">
        <label class="block">
          <span class="mb-1 block text-[11px] text-slate-500">原密码</span>
          <input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            maxlength="64"
            required
            class="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
          />
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-slate-500">新密码</span>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="64"
            required
            class="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
          />
          <span class="mt-1 block text-[11px] text-slate-400">
            8-64 个字符，需同时包含字母与数字
          </span>
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] text-slate-500">确认新密码</span>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            minlength="8"
            maxlength="64"
            required
            class="w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-blue-400"
          />
        </label>

        <div class="flex items-center gap-2">
          <button
            type="submit"
            class="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
            :disabled="saving"
          >
            {{ saving ? '提交中…' : '修改密码' }}
          </button>
          <span v-if="message" class="text-xs text-green-600">{{ message }}</span>
          <span v-if="error" class="text-xs text-red-500">{{ error }}</span>
        </div>
        <p class="text-[11px] text-slate-400">修改成功后，除当前会话外的其它会话会被撤销。</p>
      </form>
    </main>
  </div>
</template>
