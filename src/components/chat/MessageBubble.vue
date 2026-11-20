<script setup lang="ts">
import { computed } from 'vue';
import { MsgStatus, type MsgData } from '@goim/web-sdk';

import { messageText } from '@/utils/message';

const props = withDefaults(
  defineProps<{
    msg: MsgData;
    mine: boolean;
    nickname?: string;
  }>(),
  { nickname: '' },
);

const emit = defineEmits<{ retry: [msg: MsgData] }>();

const statusText = computed(() => {
  switch (props.msg.status) {
    case MsgStatus.Sending:
      return '发送中…';
    case MsgStatus.SendFailed:
      return '发送失败，点击重试';
    case MsgStatus.HasDeleted:
      return '已撤回';
    default:
      return '';
  }
});

const text = computed(() => messageText(props.msg));

function onBodyClick(): void {
  if (props.msg.status === MsgStatus.SendFailed) emit('retry', props.msg);
}
</script>

<template>
  <div class="flex flex-col" :class="mine ? 'items-end' : 'items-start'">
    <span v-if="!mine && nickname" class="mb-0.5 px-1 text-[11px] text-slate-400">
      {{ nickname }}
    </span>
    <div
      class="max-w-[70%] rounded-xl px-3 py-2 text-sm break-words whitespace-pre-wrap"
      :class="
        mine ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200'
      "
      @click="onBodyClick"
    >
      {{ text }}
    </div>
    <span v-if="statusText" class="mt-0.5 px-1 text-[11px] text-slate-400">
      {{ statusText }}
    </span>
  </div>
</template>
