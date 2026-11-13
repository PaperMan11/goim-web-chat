<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useGoim } from '../composables/useGoim';

const { state, clearLogs } = useGoim();

const logEl = ref<HTMLElement | null>(null);

watch(
  () => state.logs.length,
  async () => {
    await nextTick();
    const el = logEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <section class="event-panel">
    <div class="panel-title">
      <span>事件日志</span>
      <button class="secondary small" @click="clearLogs">清空</button>
    </div>
    <pre id="log" ref="logEl">{{ state.logs.join('\n') }}</pre>
  </section>
</template>
