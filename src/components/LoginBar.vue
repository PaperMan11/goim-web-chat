<script setup lang="ts">
import { useGoim } from '../composables/useGoim';

const { state, login, register, logout } = useGoim();
</script>

<template>
  <section class="login-panel">
    <input
      v-model="state.loginName"
      placeholder="登录名"
      autocomplete="username"
      @keydown.enter="login"
    />
    <input
      v-model="state.password"
      type="password"
      placeholder="密码"
      autocomplete="current-password"
      @keydown.enter="login"
    />
    <button :disabled="state.loggingIn || state.registering" @click="login">登录</button>
    <button :disabled="state.loggingIn || state.registering" @click="register">注册</button>
    <button class="secondary" @click="logout">登出</button>
    <span class="error">{{ state.loginError }}</span>
  </section>
</template>
