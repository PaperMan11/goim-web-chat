// 文件上传编排：单文件 PUT（≤8MB） + 分片并发（>8MB） + 403 续签 + 断点持久化。
// 业务签名接口走 api/file，对象存储 PUT 用 axios 直传（不走 {code,msg,data} envelope）。
//
// Purpose 分流规则（与后端 domain/file/file.go 一致）：
//   avatar      —— 单文件 ≤5MB，公开资源
//   chat_image  —— 单文件 ≤8MB，仅会话成员可见，后端不支持分片
//   chat_file   —— ≤8MB 单文件，>8MB 分片（最大 200MB），仅会话成员可见
//   attachment  —— 私有附件（非 IM 流程使用）

import axios from 'axios';

import {
  abortMultipart,
  completeFile,
  completeMultipart,
  presignFile,
  presignMultipart,
  refreshPartURLs,
  type FilePresignResponse,
  type FilePurpose,
  type FileView,
  type MultipartCompletedPart,
  type MultipartPartPresign,
  type MultipartPresignResponse,
} from '@/api/file/file';
import { removeUploadTask, saveUploadTask, shouldMultipart, type UploadTask } from '@/utils/file';

export interface UploadOptions {
  purpose: FilePurpose;
  // chat_image / chat_file 必填，与 IM conversationID 一致
  conversationId?: string;
  onProgress?: (bytesUploaded: number, totalBytes: number) => void;
  signal?: AbortSignal;
  // 断点续传：恢复任务（从 localStorage loadUploadTask 拿）
  resumeTask?: UploadTask;
}

export interface UploadResult {
  fileId: string;
  objectKey: string;
  mime: string;
  size: number;
  // 最终可用的 FileView（complete 成功后）
  file: FileView;
}

// 单个分片 PUT：返回 { partNumber, etag }
async function putPart(
  data: Blob,
  url: string,
  partNumber: number,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress?: (loaded: number) => void,
): Promise<MultipartCompletedPart> {
  const resp = await axios.put(url, data, {
    headers,
    signal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onUploadProgress: (e: any) => {
      if (onProgress && e?.total) onProgress(e.loaded);
    },
  });
  const etag = String(resp.headers.etag ?? '').replace(/^"|"$/g, '');
  return { partNumber, etag };
}

// ———— 单文件直传 ————
export async function uploadSingleFile(
  file: File,
  options: UploadOptions,
): Promise<UploadResult> {
  const { purpose, conversationId } = options;

  // 1) 申请签名（chat_* 必须传 conversationId，presign 会校验会话成员）
  const presign = await presignFile({
    purpose,
    fileName: file.name,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    conversationId: purpose === 'chat_image' || purpose === 'chat_file' ? conversationId : undefined,
  });

  // 2) PUT 对象存储（直传，无业务 envelope）
  const ab = new AbortController();
  let bytesUploaded = 0;
  const totalBytes = file.size;

  let stopFwd: (() => void) | undefined;
  if (options.signal) {
    if (options.signal.aborted) ab.abort();
    else {
      const onAbort = () => ab.abort();
      options.signal.addEventListener('abort', onAbort);
      stopFwd = () => options.signal?.removeEventListener('abort', onAbort);
    }
  }

  let cancelled = false;
  try {
    await axios.put(presign.uploadUrl, file, {
      headers: presign.headers,
      signal: ab.signal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onUploadProgress: (e: any) => {
        bytesUploaded = e.loaded;
        options.onProgress?.(bytesUploaded, totalBytes);
      },
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      cancelled = true;
    } else {
      throw err;
    }
  } finally {
    stopFwd?.();
  }

  if (cancelled) {
    const e: Error & { name?: string } = new Error('上传已取消');
    e.name = 'AbortError';
    throw e;
  }

  // 3) complete
  const view = await completeFile(presign.fileId);

  return {
    fileId: presign.fileId,
    objectKey: presign.objectKey,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    file: view,
  };
}

// ———— 分片上传（仅 chat_file / attachment，chat_image 后端不支持分片）————

interface UploadMultipartState {
  purpose: 'chat_file' | 'attachment';
  conversationId?: string;
  presign: MultipartPresignResponse;
  parts: Map<number, MultipartPartPresign>;
  completed: Map<number, MultipartCompletedPart>;
  bytesUploaded: number;
  totalBytes: number;
  chunkSize: number;
  ab: AbortController;
  aborted: boolean;
}

async function initMultipartState(
  file: File,
  options: UploadOptions,
): Promise<UploadMultipartState> {
  const purpose = options.purpose as 'chat_file' | 'attachment';
  const conversationId = options.conversationId;
  const resume = options.resumeTask;
  let presign: MultipartPresignResponse;

  if (resume) {
    try {
      presign = await presignMultipart({
        purpose,
        fileName: resume.fileName,
        mime: resume.mime,
        size: resume.size,
        conversationId: resume.conversationId,
      });
    } catch {
      // presign 失败 → 刷新已有分片签名（保留原 fileId/uploadId）
      const refreshed = await refreshPartURLs(resume.fileId);
      presign = { ...refreshed, uploadId: resume.uploadId };
    }
  } else {
    presign = await presignMultipart({
      purpose,
      fileName: file.name,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      conversationId,
    });
  }

  const parts = new Map<number, MultipartPartPresign>();
  for (const p of presign.parts) parts.set(p.partNumber, p);

  const completed = new Map<number, MultipartCompletedPart>();
  if (resume) {
    for (const partNumber of resume.completedParts) completed.set(partNumber, { partNumber, etag: '' });
  }

  const ab = new AbortController();
  if (options.signal) {
    if (options.signal.aborted) ab.abort();
    else options.signal.addEventListener('abort', () => ab.abort());
  }

  return {
    purpose,
    conversationId,
    presign,
    parts,
    completed,
    bytesUploaded: resume ? resume.completedParts.length * presign.partSize : 0,
    totalBytes: file.size,
    chunkSize: presign.partSize,
    ab,
    aborted: false,
  };
}

async function refreshParts(state: UploadMultipartState, partNumbers: number[]): Promise<void> {
  const refreshed = await refreshPartURLs(state.presign.fileId, partNumbers);
  for (const p of refreshed.parts) state.parts.set(p.partNumber, p);
}

async function putPartWithRetry(
  chunk: Blob,
  state: UploadMultipartState,
  partNumber: number,
  headers: Record<string, string>,
): Promise<MultipartCompletedPart> {
  const partPresign = state.parts.get(partNumber);
  if (!partPresign) throw new Error(`分片 ${partNumber} 缺失 presign`);

  try {
    return await putPart(chunk, partPresign.url, partNumber, headers, state.ab.signal);
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 403) {
      await refreshParts(state, [partNumber]);
      const refreshed = state.parts.get(partNumber)!;
      return putPart(chunk, refreshed.url, partNumber, headers, state.ab.signal);
    }
    throw err;
  }
}

export async function uploadMultipart(
  file: File,
  options: UploadOptions,
): Promise<UploadResult> {
  const state = await initMultipartState(file, options);
  const { presign, chunkSize, totalBytes } = state;

  // 初始保存断点
  saveUploadTask({
    fileId: presign.fileId,
    objectKey: presign.objectKey,
    uploadId: presign.uploadId,
    purpose: state.purpose,
    conversationId: state.conversationId,
    mime: file.type || 'application/octet-stream',
    fileName: file.name,
    size: totalBytes,
    partSize: chunkSize,
    partCount: presign.partCount,
    completedParts: Array.from(state.completed.keys()),
    expiresAt: presign.expiresAt,
    updatedAt: Date.now(),
  });

  const CONCURRENCY = 3;
  let nextPart = 1;
  let lastSavedAt = Date.now();

  async function worker(): Promise<void> {
    while (true) {
      if (state.aborted) return;
      const partNumber = nextPart++;
      if (partNumber > presign.partCount) return;
      if (state.completed.has(partNumber)) continue;

      const start = (partNumber - 1) * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const chunk = file.slice(start, end);

      const result = await putPartWithRetry(chunk, state, partNumber, {});
      state.completed.set(partNumber, result);
      state.bytesUploaded += chunk.size;
      options.onProgress?.(state.bytesUploaded, totalBytes);

      const now = Date.now();
      if (now - lastSavedAt > 2000) {
        lastSavedAt = now;
        saveUploadTask({
          fileId: presign.fileId,
          objectKey: presign.objectKey,
          uploadId: presign.uploadId,
          purpose: state.purpose,
          conversationId: state.conversationId,
          mime: file.type || 'application/octet-stream',
          fileName: file.name,
          size: totalBytes,
          partSize: chunkSize,
          partCount: presign.partCount,
          completedParts: Array.from(state.completed.keys()),
          expiresAt: presign.expiresAt,
          updatedAt: now,
        });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker());
  await Promise.all(workers);

  // completeMultipart
  const parts = Array.from(state.completed.values()).sort((a, b) => a.partNumber - b.partNumber);
  const view = await completeMultipart(presign.fileId, parts);
  removeUploadTask(presign.uploadId);

  return {
    fileId: presign.fileId,
    objectKey: presign.objectKey,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    file: view,
  };
}

// ———— 统一入口：按 purpose + size 分流 ————
export async function uploadAttachment(
  file: File,
  options: UploadOptions,
): Promise<UploadResult> {
  // purpose 必须显式传
  const { purpose } = options;

  // chat_image 强制单文件（后端 PurposeChatImage 不支持分片）
  if (purpose === 'chat_image' || purpose === 'avatar') {
    return uploadSingleFile(file, options);
  }

  if (shouldMultipart(purpose, file.size)) {
    return uploadMultipart(file, options);
  }
  return uploadSingleFile(file, options);
}

// 取消正在进行的分片上传（abort 远端对象 + 清本地断点）
export async function cancelMultipart(uploadId: string, fileId: string): Promise<void> {
  removeUploadTask(uploadId);
  try {
    await abortMultipart(fileId);
  } catch {
    // 远端可能已失效，忽略
  }
}
