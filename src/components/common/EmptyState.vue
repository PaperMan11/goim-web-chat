<script setup lang="ts">
defineProps<{ title: string; desc?: string }>();
</script>

<template>
  <div class="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
    <p class="text-sm font-medium text-slate-500">{{ title }}</p>
    <p v-if="desc" class="text-xs">{{ desc }}</p>
  </div>
</template>
