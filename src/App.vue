<script setup lang="ts">
import { onMounted } from 'vue';

import { bootstrapAuth } from '@/services/auth/loginFlow';

// 刷新页面后恢复业务会话并接入 IM；失败时停留在登录页由路由守卫兜底
onMounted(() => {
  void bootstrapAuth().catch(() => undefined);
});
</script>

<template>
  <RouterView />
</template>
