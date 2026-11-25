<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import { sendAttachment, sendTextMessage, type AttachmentProgress } from '@/services/chat/send';
import { useChatStore } from '@/stores/chat';
import { errorMessage } from '@/utils/error';
import { ATTACHMENT_MIMES } from '@/api/file/file';

const chat = useChatStore();
const sending = ref(false);
const error = ref('');

const uploading = ref(false);
const uploadProgress = ref<AttachmentProgress>({ bytes: 0, total: 1 });
const uploadFileName = ref('');
const abortCtrl = ref<AbortController | null>(null);

// 微信风面板："+"更多面板展开/收起
const showPlus = ref(false);

// 隐藏的 file input：图片（image/*）和文件（全量 ATTACHMENT_MIMES）分两个
const imageInput = ref<HTMLInputElement>();
const fileInput = ref<HTMLInputElement>();

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
  showPlus.value = false;
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

function togglePlus(): void {
  showPlus.value = !showPlus.value;
}

function openImagePicker(): void {
  if (!chat.activeConversation || uploading.value) return;
  showPlus.value = false;
  imageInput.value?.click();
}

function openFilePicker(): void {
  if (!chat.activeConversation || uploading.value) return;
  showPlus.value = false;
  fileInput.value?.click();
}

async function handleFileSelected(file: File | undefined): Promise<void> {
  if (!file || !chat.activeConversation) return;

  error.value = '';
  uploading.value = true;
  uploadProgress.value = { bytes: 0, total: file.size };
  uploadFileName.value = file.name;
  abortCtrl.value = new AbortController();

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
    abortCtrl.value = null;
  }
}

function onImageChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  void handleFileSelected(file);
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  void handleFileSelected(file);
}

function cancelUpload(): void {
  abortCtrl.value?.abort();
}

onBeforeUnmount(() => {
  abortCtrl.value?.abort();
});
</script>

<template>
  <div class="shrink-0 border-t border-slate-200 bg-white">
    <!-- 上传进度行 -->
    <div
      v-if="uploading"
      class="mx-3 mt-2 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs"
    >
      <span class="truncate text-slate-600">{{ uploadFileName }}</span>
      <div class="flex-1 overflow-hidden rounded-full bg-slate-200">
        <div
          class="h-1.5 bg-green-500 transition-all"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
      <span class="text-slate-500">{{ progressPercent }}%</span>
      <button class="text-slate-400 hover:text-red-500" @click="cancelUpload">取消</button>
    </div>

    <p v-if="error" class="mx-3 mt-1 text-xs text-red-500">{{ error }}</p>

    <!-- 隐藏的 file inputs：图片和文件分开 -->
    <input
      ref="imageInput"
      type="file"
      class="hidden"
      accept="image/*"
      @change="onImageChange"
    />
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="ATTACHMENT_MIMES.join(',')"
      @change="onFileChange"
    />

    <!-- + 更多面板（微信风圆角网格，展开时插入在工具栏上方） -->
    <div
      v-if="showPlus"
      class="border-t border-slate-100 bg-slate-50 px-4 py-3"
    >
      <div class="grid grid-cols-4 gap-3">
        <!-- 图片 -->
        <button
          type="button"
          :disabled="!chat.activeConversation || uploading"
          class="flex flex-col items-center gap-1.5 rounded-lg py-2 text-slate-600 hover:bg-white disabled:opacity-40"
          @click="openImagePicker"
        >
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-green-600 ring-1 ring-slate-200">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
          </span>
          <span class="text-xs">图片</span>
        </button>

        <!-- 文件 -->
        <button
          type="button"
          :disabled="!chat.activeConversation || uploading"
          class="flex flex-col items-center gap-1.5 rounded-lg py-2 text-slate-600 hover:bg-white disabled:opacity-40"
          @click="openFilePicker"
        >
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-white text-amber-600 ring-1 ring-slate-200">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          </span>
          <span class="text-xs">文件</span>
        </button>

        <!-- 拍摄（后续实现） -->
        <button
          type="button"
          disabled
          class="flex flex-col items-center gap-1.5 rounded-lg py-2 text-slate-400 disabled:opacity-50"
        >
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>
          </span>
          <span class="text-xs">拍摄</span>
        </button>

        <!-- 位置（后续实现） -->
        <button
          type="button"
          disabled
          class="flex flex-col items-center gap-1.5 rounded-lg py-2 text-slate-400 disabled:opacity-50"
        >
          <span class="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-slate-200">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
          </span>
          <span class="text-xs">位置</span>
        </button>
      </div>
    </div>

    <!-- 输入区 + 工具栏 -->
    <div class="flex items-end gap-2 px-3 py-2">
      <!-- 工具栏按钮组（左）：表情 + 语音占位 + + -->
      <div class="flex items-center gap-1">
        <!-- 表情按钮（后续实现表情面板） -->
        <button
          type="button"
          title="表情"
          :disabled="!chat.activeConversation"
          class="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>

        <!-- 语音按钮（后续实现按住说话） -->
        <button
          type="button"
          title="语音"
          :disabled="!chat.activeConversation"
          class="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
        </button>

        <!-- + 更多 -->
        <button
          type="button"
          title="更多"
          :disabled="!chat.activeConversation || uploading"
          class="rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          :class="{ 'bg-slate-200': showPlus }"
          @click="togglePlus"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <!-- textarea：全宽，紧贴工具栏 -->
      <textarea
        v-model="draft"
        rows="1"
        placeholder="输入消息"
        class="min-h-[34px] max-h-28 flex-1 resize-none rounded-lg bg-slate-100 px-3 py-1.5 text-sm outline-none focus:bg-white focus:ring-1 focus:ring-green-400"
        @keydown="onKeydown"
      />

      <!-- 发送按钮：在工具栏最右 -->
      <button
        class="shrink-0 rounded-lg px-4 py-1.5 text-sm transition-colors"
        :class="canSend
          ? 'bg-green-500 text-white hover:bg-green-400'
          : 'bg-slate-200 text-slate-400 cursor-not-allowed'"
        :disabled="!canSend"
        @click="submit"
      >
        发送
      </button>
    </div>
  </div>
</template>