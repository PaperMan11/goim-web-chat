// 文件工具：mime 判断、大小格式化、文件名从路径提取、断点任务持久化。
// MIME 白名单与大小上限以 api/file/file.ts 为准（后者直接映射后端契约）。

import {
  AVATAR_MIMES,
  CHAT_FILE_MIMES,
  CHAT_IMAGE_MIMES,
  MAX_AVATAR_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_FILE_BYTES,
  MULTIPART_THRESHOLD_BYTES,
  PART_SIZE_BYTES,
  type FilePurpose,
} from '@/api/file/file';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function fileNameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

// 校验附件；purpose 决定允许的 MIME 与大小上限。
export function validateAttachment(
  purpose: FilePurpose,
  file: { mime: string; size: number; name?: string },
): string | null {
  const mime = file.mime || 'application/octet-stream';

  // MIME 白名单按 purpose 取
  let allowed: readonly string[];
  let maxBytes: number;
  switch (purpose) {
    case 'avatar':
      allowed = AVATAR_MIMES;
      maxBytes = MAX_AVATAR_BYTES;
      break;
    case 'chat_image':
      allowed = CHAT_IMAGE_MIMES;
      maxBytes = MAX_CHAT_IMAGE_BYTES;
      break;
    case 'chat_file':
      allowed = CHAT_FILE_MIMES;
      maxBytes = MAX_FILE_BYTES;
      break;
    default:
      allowed = CHAT_FILE_MIMES;
      maxBytes = MAX_FILE_BYTES;
  }

  if (!allowed.includes(mime as (typeof allowed)[number])) {
    return `不支持的文件类型：${mime}`;
  }
  if (file.size <= 0) return '文件为空';
  if (file.size > maxBytes) {
    return `文件超过 ${formatBytes(maxBytes)} 上限`;
  }
  return null;
}

// 是否走分片（chat_image 永远 false，后端不支持聊天图片分片）
export function shouldMultipart(purpose: FilePurpose, size: number): boolean {
  if (purpose === 'chat_image' || purpose === 'avatar') return false;
  return size > MULTIPART_THRESHOLD_BYTES;
}

export interface MultipartConfig {
  partSize: number;
  partCount: number;
}

export function multipartConfig(size: number): MultipartConfig {
  const partSize = PART_SIZE_BYTES;
  const partCount = Math.min(Math.ceil(size / partSize), 100);
  return { partSize, partCount };
}

// ———— 断点持久化（multipart 用）——
// key 格式：goim_upload_<uploadId>，存 fileId / objectKey / uploadId / partCount / completedParts[] / expiresAt

const UPLOAD_PREFIX = 'goim_upload_';

export interface UploadTask {
  fileId: string;
  objectKey: string;
  uploadId: string;
  purpose: FilePurpose;
  conversationId?: string;
  mime: string;
  fileName?: string;
  size: number;
  partSize: number;
  partCount: number;
  completedParts: number[]; // 已完成的 partNumber（1-based）
  expiresAt: number;
  updatedAt: number;
}

export function saveUploadTask(task: UploadTask): void {
  try {
    localStorage.setItem(UPLOAD_PREFIX + task.uploadId, JSON.stringify(task));
  } catch {
    // quota 或隐私模式，忽略
  }
}

export function loadUploadTask(uploadId: string): UploadTask | null {
  try {
    const raw = localStorage.getItem(UPLOAD_PREFIX + uploadId);
    if (!raw) return null;
    return JSON.parse(raw) as UploadTask;
  } catch {
    return null;
  }
}

export function removeUploadTask(uploadId: string): void {
  try {
    localStorage.removeItem(UPLOAD_PREFIX + uploadId);
  } catch {
    // ignore
  }
}

export function listUploadTasks(): UploadTask[] {
  const out: UploadTask[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(UPLOAD_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        out.push(JSON.parse(raw));
      } catch {
        // skip
      }
    }
  } catch {
    // ignore
  }
  return out;
}
