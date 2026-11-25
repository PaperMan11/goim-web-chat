// 文件上传契约，与 goim-business internal/handler/file 一一对应。
// 本层只封装 biz 的签名与校验接口；PUT 对象存储、并发与断点由 services/upload 负责。
//
// Purpose 说明（与 domain/file/file.go 对齐）：
//   avatar     头像：单文件 ≤5MB，公开资源，profile 直接返回稳定公开 URL。
//   chat_image 聊天图片：单文件 ≤8MB，仅会话成员可见，不支持分片。
//   chat_file  聊天文件（语音/视频/文档等）：≤8MB 单文件、>8MB 分片（最大 200MB），仅会话成员可见。
//   attachment 私有附件：仅本人可见，不在 IM 流程使用。

import { request } from '../http';

export type FilePurpose = 'avatar' | 'chat_image' | 'chat_file' | 'attachment';

// avatar 允许的 MIME（后端 PurposeAvatar）
export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// chat_image 允许的 MIME（后端 PurposeChatImage 严格白名单）
export const CHAT_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

// chat_file 允许的 MIME（后端 PurposeChatFile，全量附件白名单）
export const CHAT_FILE_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/mpeg',
  'audio/wav',
  'audio/amr',
  'audio/mp4',
  'audio/aac',
  'application/pdf',
  'application/zip',
  'text/plain',
  'video/mp4',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const;

// attachment 允许的 MIME（purpose 保留给非 IM 场景）
export const ATTACHMENT_MIMES = [...CHAT_FILE_MIMES] as const;

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;
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
  // chat_image / chat_file 必填；avatar / attachment 必须为空字符串
  conversationId?: string;
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
// chat_* 用途的 url 字段为空（由客户端现签），avatar 的 url 是稳定公开地址
export interface FileView {
  fileId: string;
  purpose: string;
  objectKey: string;
  mime: string;
  size: number;
  sha256: string;
  status: 0 | 1 | 2;
  createdAt: string;
  url?: string;
}

// types.FileURLResponse；chat_image/chat_file 为 15 分钟预签名地址（仅会话成员可换）
export interface FileURLResponse {
  url: string;
  expiresAt: number; // Unix 秒
}

// types.MultipartPresignRequest（仅 chat_file 与 attachment，8MB < size ≤ 200MB）
// chat_file 必须传 conversationId
export interface MultipartPresignInput {
  purpose: 'chat_file' | 'attachment';
  fileName?: string;
  mime: string;
  size: number;
  sha256?: string;
  conversationId?: string;
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

// POST /files/presign：申请单文件直传
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

// GET /files/{fileId}/url：换取短时访问地址
// chat_image/chat_file 仅会话成员可换；attachment 仅本人；avatar 可直接用 profile 返回的稳定公开 URL
export async function getFileURL(fileId: string): Promise<FileURLResponse> {
  return request<FileURLResponse>(`/files/${encodeURIComponent(fileId)}/url`, {
    method: 'GET',
  });
}

// DELETE /files/{fileId}
export async function deleteFile(fileId: string): Promise<void> {
  await request<unknown>(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
}

// POST /files/multipart/presign：申请分片上传（仅 chat_file / attachment，8MB < size ≤ 200MB）
export async function presignMultipart(
  input: MultipartPresignInput,
): Promise<MultipartPresignResponse> {
  return request<MultipartPresignResponse>('/files/multipart/presign', {
    method: 'POST',
    data: input,
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
