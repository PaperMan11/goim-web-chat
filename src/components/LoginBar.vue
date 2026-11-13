<script setup lang="ts">
import { useGoim } from '../composables/useGoim';

const { state, login, logout } = useGoim();
</script>

<template>
  <section class="login-panel">
    <input
      v-model="state.loginUserID"
      placeholder="登录 userID"
      autocomplete="off"
      @keydown.enter="() => login()"
    />
    <button :disabled="state.loggingIn" @click="() => login()">登录</button>
    <button class="secondary" @click="() => logout()">登出</button>
    <span class="error">{{ state.loginError }}</span>
  </section>
</template>
