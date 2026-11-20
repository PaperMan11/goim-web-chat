// 文件上传契约，与 goim-business internal/handler/file 一一对应。
// 本层只封装 biz 的签名与校验接口；PUT 对象存储、并发与断点由 services/upload 负责。

import { request } from '../http';

// 头像与 ≤8MB 附件走单文件直传，>8MB 附件走分片
export type FilePurpose = 'avatar' | 'attachment';

// 与 openapi 白名单保持一致
export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export const ATTACHMENT_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/zip',
  'text/plain',
  'video/mp4',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const PART_SIZE_BYTES = 8 * 1024 * 1024;
export const MAX_PART_COUNT = 100;

// types.FilePresignRequest
export interface PresignFileInput {
  purpose: FilePurpose;
  fileName?: string;
  mime: string;
  size: number;
  sha256?: string;
}

// types.FilePresignResponse
export interface FilePresignResponse {
  fileId: string;
  objectKey: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: number; // Unix 秒
}

// types.FileView；status: 0 待上传、1 可用、2 已删除
export interface FileView {
  fileId: string;
  purpose: string;
  objectKey: string;
  mime: string;
  size: number;
  sha256: string;
  status: 0 | 1 | 2;
  createdAt: string;
}

// types.FileURLResponse；私有附件为 15 分钟预签名地址
export interface FileURLResponse {
  url: string;
  expiresAt: number; // Unix 秒
}

// types.MultipartPresignRequest（仅 attachment，8MB < size ≤ 200MB）
export interface MultipartPresignInput {
  fileName?: string;
  mime: string;
  size: number;
  sha256?: string;
}

// types.MultipartPartPresign
export interface MultipartPartPresign {
  partNumber: number;
  url: string;
  expiresAt: number;
}

// types.MultipartPresignResponse
export interface MultipartPresignResponse {
  fileId: string;
  objectKey: string;
  uploadId: string;
  partSize: number;
  partCount: number;
  parts: MultipartPartPresign[];
  expiresAt: number;
}

// types.MultipartCompletedPart；etag 为分片 PUT 响应头原值（通常带双引号）
export interface MultipartCompletedPart {
  partNumber: number;
  etag: string;
}

// POST /files/presign：申请单文件直传（头像、≤8MB 附件）
export async function presignFile(input: PresignFileInput): Promise<FilePresignResponse> {
  return request<FilePresignResponse>('/files/presign', {
    method: 'POST',
    data: input,
  });
}

// POST /files/{fileId}/complete：校验对象后置 ready（幂等）
export async function completeFile(fileId: string): Promise<FileView> {
  return request<FileView>(`/files/${encodeURIComponent(fileId)}/complete`, {
    method: 'POST',
  });
}

// GET /files/{fileId}/url：换取短时访问地址（仅本人且已 ready）
export async function getFileURL(fileId: string): Promise<FileURLResponse> {
  return request<FileURLResponse>(`/files/${encodeURIComponent(fileId)}/url`, {
    method: 'GET',
  });
}

// DELETE /files/{fileId}
export async function deleteFile(fileId: string): Promise<void> {
  await request<unknown>(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

// POST /files/multipart/presign：申请分片上传（仅 attachment）
export async function presignMultipart(
  input: MultipartPresignInput,
): Promise<MultipartPresignResponse> {
  return request<MultipartPresignResponse>('/files/multipart/presign', {
    method: 'POST',
    data: { purpose: 'attachment', ...input },
  });
}

// POST /files/{fileId}/multipart/parts：刷新分片签名（不传 partNumbers 表示全部）
// 403 签名过期时只用此接口续期，不要重新 presign
export async function refreshPartURLs(
  fileId: string,
  partNumbers?: number[],
): Promise<MultipartPresignResponse> {
  return request<MultipartPresignResponse>(
    `/files/${encodeURIComponent(fileId)}/multipart/parts`,
    {
      method: 'POST',
      data: partNumbers?.length ? { partNumbers } : {},
    },
  );
}

// POST /files/{fileId}/multipart/complete：partNumber 必须从 1 连续递增且与 partCount 一致
export async function completeMultipart(
  fileId: string,
  parts: MultipartCompletedPart[],
): Promise<FileView> {
  return request<FileView>(
    `/files/${encodeURIComponent(fileId)}/multipart/complete`,
    { method: 'POST', data: { parts } },
  );
}

// POST /files/{fileId}/multipart/abort：取消未完成的分片上传
export async function abortMultipart(fileId: string): Promise<void> {
  await request<unknown>(
    `/files/${encodeURIComponent(fileId)}/multipart/abort`,
    { method: 'POST' },
  );
}
