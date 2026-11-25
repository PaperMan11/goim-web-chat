<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import { sendAttachment, sendTextMessage, type AttachmentProgress } from '@/services/chat/send';
import { useChatStore } from '@/stores/chat';
import { errorMessage } from '@/utils/error';
import { ATTACHMENT_MIMES, MAX_FILE_BYTES } from '@/api/file/file';
import { formatBytes } from '@/utils/file';

const chat = useChatStore();
const sending = ref(false);
const error = ref('');

const uploading = ref(false);
const uploadProgress = ref<AttachmentProgress>({ bytes: 0, total: 1 });
const uploadFileName = ref('');
const fileInput = ref<HTMLInputElement>();
let abortCtrl: AbortController | null = null;

const draft = computed({
  get: () => chat.drafts[chat.activeConversationID] ?? '',
  set: (value: string) => chat.setDraft(value),
});

const canSend = computed(
  () => Boolean(chat.activeConversation) && draft.value.trim().length > 0 && !sending.value && !uploading.value,
);

const progressPercent = computed(() => {
  if (uploadProgress.value.total <= 0) return 0;
  return Math.round((uploadProgress.value.bytes / uploadProgress.value.total) * 100);
});

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

function openFilePicker(): void {
  if (!chat.activeConversation || uploading.value) return;
  fileInput.value?.click();
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 允许重复选同一个文件
  if (!file || !chat.activeConversation) return;

  error.value = '';
  uploading.value = true;
  uploadProgress.value = { bytes: 0, total: file.size };
  uploadFileName.value = file.name;
  abortCtrl = new AbortController();

  try {
    await sendAttachment(chat.activeConversation, file, {
      onProgress: (p) => {
        uploadProgress.value = p;
      },
    });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      error.value = errorMessage(err);
    }
  } finally {
    uploading.value = false;
    uploadProgress.value = { bytes: 0, total: 1 };
    uploadFileName.value = '';
    abortCtrl = null;
  }
}

function cancelUpload(): void {
  abortCtrl?.abort();
}

onBeforeUnmount(() => {
  abortCtrl?.abort();
});
</script>

<template>
  <div class="shrink-0 border-t border-slate-200 bg-white px-3 py-2">
    <p v-if="error" class="mb-1 text-xs text-red-500">{{ error }}</p>

    <!-- 上传进度行 -->
    <div
      v-if="uploading"
      class="mb-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
    >
      <span class="truncate text-slate-600">{{ uploadFileName }}</span>
      <div class="flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          class="h-1.5 bg-blue-500 transition-all"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <span class="text-slate-500">{{ progressPercent }}%</span>
      <button class="text-slate-400 hover:text-red-500" @click="cancelUpload">取消</button>
    </div>

    <div class="flex items-end gap-2">
      <!-- 附件按钮 -->
      <button
        type="button"
        title="发送图片/文件"
        :disabled="!chat.activeConversation || uploading"
        class="shrink-0 rounded-lg border border-slate-200 px-2.5 py-2 text-slate-500 hover:bg-slate-50 disabled:opacity-40"
        @click="openFilePicker"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.82L8.74 18a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        :accept="ATTACHMENT_MIMES.join(',')"
        @change="onFileSelected"
      />

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
    <p class="mt-1 text-[11px] text-slate-400">
      附件最大 {{ formatBytes(MAX_FILE_BYTES) }}（图片/JPG/PNG/WebP/GIF/PDF/Office/zip 等）
    </p>
  </div>
</template>
