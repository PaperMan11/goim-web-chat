<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { MsgStatus } from '@goim/web-sdk';
import { useGoim } from '../composables/useGoim';

const { state, sendMessage, messageHead, messageMeta } = useGoim();

const listEl = ref<HTMLElement | null>(null);

// 消息列表变化时保持滚动到底部（与原实现一致）
watch(
  () => [state.messages.length, state.selected?.conversationID],
  async () => {
    await nextTick();
    const el = listEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <section class="message-panel">
    <div id="msg-list" ref="listEl" class="msg-list">
      <div
        v-for="(msg, index) in state.messages"
        :key="msg.clientMsgID ?? msg.serverMsgID ?? index"
        class="msg"
        :class="{ mine: msg.sendID === state.userID }"
      >
        <div class="msg-head">{{ messageHead(msg) }}</div>
        <div class="msg-body">
          {{ msg.status === MsgStatus.Revoked ? '[消息已撤回]' : msg.content ?? '' }}
        </div>
        <span class="msg-meta">{{ messageMeta(msg) }}</span>
      </div>
    </div>
    <div class="composer">
      <input
        v-model="state.draft"
        placeholder="输入文本，回车发送"
        autocomplete="off"
        @keydown.enter="() => sendMessage()"
      />
      <button @click="() => sendMessage()">发送</button>
    </div>
  </section>
</template>
