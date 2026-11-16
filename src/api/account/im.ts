// IM 凭证与开通接口，与 goim-business internal/handler/account/im.go 一一对应。

import { request } from '../http';

// types.IMTokenResp
export interface IMTokenResponse {
  userId: string;
  token: string;
  expireTimeSeconds: number;
  apiBaseUrl: string;
  wsUrl: string;
  platformId: number;
}

// types.IMStatusResp
export interface IMStatusResponse {
  userId: string;
  status: number;
  syncedAt: string | null;
}

// POST /im/token（无请求体，平台取自 access token claims）
export async function imToken(): Promise<IMTokenResponse> {
  return request<IMTokenResponse>('/im/token', { method: 'POST' });
}

// GET /im/status
export async function imStatus(): Promise<IMStatusResponse> {
  return request<IMStatusResponse>('/im/status', { method: 'GET' });
}

// POST /im/retry：重新开通后返回与 status 相同的结构
export async function imRetry(): Promise<IMStatusResponse> {
  return request<IMStatusResponse>('/im/retry', { method: 'POST' });
}
