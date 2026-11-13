<script setup lang="ts">
import { useGoim } from '../composables/useGoim';

const { connBadge, syncBadge, userBadge } = useGoim();
</script>

<template>
  <header>
    <h1>goim web chat · M0 链路验证</h1>
    <div class="badges">
      <span :class="['badge', connBadge.tone]">{{ connBadge.text }}</span>
      <span :class="['badge', syncBadge.tone]">{{ syncBadge.text }}</span>
      <span :class="['badge', userBadge.tone]">{{ userBadge.text }}</span>
    </div>
  </header>
</template>
