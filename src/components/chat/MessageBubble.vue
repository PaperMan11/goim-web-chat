<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ContentType, MsgStatus, type MsgData } from '@goim/web-sdk';

import { getFileURL } from '@/api/file/file';
import { parseFileContent, parseImageContent } from '@/im/message';
import { formatBytes } from '@/utils/file';
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

const contentType = computed(() => props.msg.contentType);
const isPicture = computed(() => contentType.value === ContentType.Picture);
const isFile = computed(() => contentType.value === ContentType.File);
const plainText = computed(() => messageText(props.msg));

// ———— 懒加载 URL（Picture / File 都需要）——
const mediaUrl = ref<string>();
const mediaLoading = ref(false);
const mediaError = ref(false);
let urlFetchedFor: string | null = null; // 防止重复调

async function fetchMediaUrl(): Promise<void> {
  mediaError.value = false;
  const content = parseImageContent(props.msg.content) ?? parseFileContent(props.msg.content);
  const fileId = content?.fileId;
  if (!fileId) {
    // 没有 fileId，看看协议 content 里是不是有 url 字段直接可以用
    const anyContent = content as Record<string, unknown> | undefined;
    const url = (anyContent?.origPictureElem as Record<string, unknown> | undefined)?.url as string | undefined
      ?? anyContent?.filePath as string | undefined;
    if (url) mediaUrl.value = url;
    return;
  }
  if (urlFetchedFor === fileId) return;
  urlFetchedFor = fileId;
  mediaLoading.value = true;
  try {
    const resp = await getFileURL(fileId);
    mediaUrl.value = resp.url;
  } catch {
    mediaError.value = true;
  } finally {
    mediaLoading.value = false;
  }
}

onMounted(() => {
  if (isPicture.value || isFile.value) void fetchMediaUrl();
});

// 切换到下一条消息时重置
watch(
  () => props.msg.clientMsgID,
  () => {
    mediaUrl.value = undefined;
    urlFetchedFor = null;
    if (isPicture.value || isFile.value) void fetchMediaUrl();
  },
);

// 图片展示
const imageContent = computed(() => parseImageContent(props.msg.content));

// 文件展示
const fileContent = computed(() => parseFileContent(props.msg.content));

function onBodyClick(): void {
  if (props.msg.status === MsgStatus.SendFailed) emit('retry', props.msg);
}

function onImageError(): void {
  // URL 可能过期，清理后下次 watcher 或用户刷新时会重新换
  mediaUrl.value = undefined;
  urlFetchedFor = null;
  mediaError.value = true;
}

// 下载按钮点击：先换最新 URL（避免 15 分钟过期），再 fetch → Blob → 强制下载
async function asyncDownload(): Promise<void> {
  const content = fileContent.value;
  if (!content?.fileId || !content.fileName) return;

  // 无论 mediaUrl 有没有，都重新换一次（点击时 URL 可能已过期）
  mediaLoading.value = true;
  mediaError.value = false;
  try {
    const resp = await getFileURL(content.fileId);
    const blob = await fetch(resp.url).then((r) => r.blob());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = content.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mediaUrl.value = resp.url;
  } catch {
    mediaError.value = true;
  } finally {
    mediaLoading.value = false;
  }
}

// 图片自然尺寸
const imageStyle = computed(() => {
  const c = imageContent.value;
  const w = c?.origPictureElem?.width;
  const h = c?.origPictureElem?.height;
  if (w && h) {
    // 缩放到最大 220px 边
    const max = 220;
    const scale = Math.min(max / w, max / h, 1);
    return `width: ${Math.round(w * scale)}px; height: ${Math.round(h * scale)}px;`;
  }
  return 'max-width: 220px; max-height: 220px;';
});
</script>

<template>
  <div class="flex flex-col" :class="mine ? 'items-end' : 'items-start'">
    <span v-if="!mine && nickname" class="mb-0.5 px-1 text-[11px] text-slate-400">
      {{ nickname }}
    </span>

    <!-- 图片消息 -->
    <div
      v-if="isPicture"
      class="overflow-hidden rounded-xl"
      :class="mine ? 'bg-blue-600 ring-1 ring-blue-500' : 'bg-slate-100 ring-1 ring-slate-200'"
      @click="onBodyClick"
    >
      <div v-if="mediaLoading" class="h-32 w-32 bg-slate-100" />
      <img
        v-else-if="mediaUrl"
        :src="mediaUrl"
        :style="imageStyle"
        class="block rounded-xl object-cover"
        @error="onImageError"
      />
      <div v-else class="h-32 w-32 rounded-xl bg-slate-100 flex items-center justify-center text-xs text-slate-400">
        图片加载失败
      </div>
    </div>

    <!-- 文件消息 -->
    <div
      v-else-if="isFile"
      class="max-w-[70%] rounded-xl px-3 py-2 text-sm"
      :class="mine ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200'"
      @click="onBodyClick"
    >
      <div class="flex items-center gap-2">
        <!-- 文件图标（按 mime 简化） -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-bold"
          :class="mine ? 'bg-blue-500' : 'bg-slate-100'"
        >
          {{ (fileContent?.fileName ?? '?').split('.').pop()?.slice(0, 3).toUpperCase() }}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate">{{ fileContent?.fileName ?? '[文件]' }}</div>
          <div class="text-[11px]" :class="mine ? 'text-blue-100' : 'text-slate-400'">
            {{ fileContent?.fileSize ? formatBytes(fileContent.fileSize) : '' }}
          </div>
        </div>
        <!-- 下载按钮：始终可见，三态（加载中 / 下载 / 重试），点击时现换 URL + fetch→Blob 强制下载 -->
        <button
          type="button"
          class="shrink-0 rounded px-2 py-0.5 text-xs disabled:opacity-50"
          :class="mine ? 'bg-blue-500 hover:bg-blue-400' : 'bg-slate-100 hover:bg-slate-200'"
          :disabled="mediaLoading"
          @click.stop="asyncDownload"
        >
          <span v-if="mediaLoading">加载中…</span>
          <span v-else-if="mediaError">重试</span>
          <span v-else>下载</span>
        </button>
      </div>
    </div>

    <!-- 文本 / 占位消息 -->
    <div
      v-else
      class="max-w-[70%] rounded-xl px-3 py-2 text-sm break-words whitespace-pre-wrap"
      :class="
        mine ? 'bg-blue-600 text-white' : 'bg-white text-slate-800 ring-1 ring-slate-200'
      "
      @click="onBodyClick"
    >
      {{ plainText }}
    </div>

    <span v-if="statusText" class="mt-0.5 px-1 text-[11px] text-slate-400">
      {{ statusText }}
    </span>
  </div>
</template>
