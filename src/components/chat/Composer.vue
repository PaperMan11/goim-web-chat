<script setup lang="ts">
import { computed, ref } from 'vue';

import { sendTextMessage } from '@/services/chat/send';
import { useChatStore } from '@/stores/chat';
import { errorMessage } from '@/utils/error';

const chat = useChatStore();
const sending = ref(false);
const error = ref('');

const draft = computed({
  get: () => chat.drafts[chat.activeConversationID] ?? '',
  set: (value: string) => chat.setDraft(value),
});

const canSend = computed(
  () => Boolean(chat.activeConversation) && draft.value.trim().length > 0 && !sending.value,
);

async function submit(): Promise<void> {
  const conv = chat.activeConversation;
  const content = draft.value.trim();
  if (!conv || !content || sending.value) return;

  sending.value = true;
  error.value = '';
  chat.setDraft('');
  try {
    await sendTextMessage(conv, content);
  } catch (err) {
    error.value = errorMessage(err);
    chat.setDraft(content);
  } finally {
    sending.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
}
</script>

<template>
  <div class="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
    <p v-if="error" class="mb-1 text-xs text-red-500">{{ error }}</p>
    <div class="flex items-end gap-2">
      <textarea
        v-model="draft"
        rows="2"
        placeholder="输入消息，Enter 发送，Shift+Enter 换行"
        class="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
        @keydown="onKeydown"
      />
      <button
        class="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        :disabled="!canSend"
        @click="submit"
      >
        发送
      </button>
    </div>
  </div>
</template>
