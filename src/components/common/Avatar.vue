<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    src?: string;
    name?: string;
    size?: 'sm' | 'md' | 'lg';
    square?: boolean;
  }>(),
  { src: '', name: '', size: 'md', square: false },
);

const sizeClass = computed(
  () =>
    ({
      sm: 'h-8 w-8 text-xs',
      md: 'h-10 w-10 text-sm',
      lg: 'h-16 w-16 text-xl',
    })[props.size],
);

const initial = computed(() => {
  const text = props.name.trim();
  return text ? text.slice(0, 1).toUpperCase() : '?';
});
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-center overflow-hidden bg-slate-200 font-medium text-slate-600"
    :class="[sizeClass, square ? 'rounded-lg' : 'rounded-full']"
  >
    <img v-if="src" :src="src" :alt="name" class="h-full w-full object-cover" />
    <span v-else>{{ initial }}</span>
  </div>
</template>
