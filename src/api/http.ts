// 业务后端 HTTP 层（axios）：统一实例、鉴权注入、{code,msg,data} 解析、access token 自动续期。
//
// 后续接入文件服务等其它后端时，用 createHttpClient 单独建实例；
// 需要上传进度 / 取消 / 流式下载时直接用实例或 request 的 AxiosRequestConfig 参数。

import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import {
  BusinessApiError,
  CODE_ACCESS_EXPIRED,
  CODE_UNAUTHENTICATED,
  applyAuthSession,
  clearSession,
  getDeviceId,
  isBusinessApiError,
  loadSession,
  saveSession,
  type AuthPayload,
  type BusinessSession,
} from './client';

const API_BASE = (
  import.meta.env.VITE_BUSINESS_API_URL || '/biz-api/v1'
).replace(/\/+$/, '');

export interface HttpClientOptions {
  baseURL: string;
  timeout?: number;
}

// 通用 axios 实例工厂（每个后端服务一个实例）
export function createHttpClient(options: HttpClientOptions): AxiosInstance {
  return axios.create({
    baseURL: options.baseURL.replace(/\/+$/, ''),
    timeout: options.timeout ?? 15000,
    headers: { 'X-Client-Platform': 'web', 'X-Device-Id': getDeviceId() },
  });
}

// 业务后端实例（账号 / IM 等）
export const http = createHttpClient({ baseURL: API_BASE });

export interface RequestOptions {
  // 是否附带 Authorization（默认是）
  auth?: boolean;
  // 1002/2004 时是否刷新后重试一次（默认是）
  retryOnUnauthorized?: boolean;
  // 跳过 {code,msg,data} 解析，直接返回响应体（下载 / 上传回执等）
  raw?: boolean;
}

interface Envelope {
  code?: unknown;
  msg?: unknown;
  data?: unknown;
}

// 解析 {code,msg,data} 响应；供需要自行处理 304 的接口复用
export function unwrapEnvelope<T>(payload: unknown): T {
  const envelope = payload as Envelope | null;
  if (!envelope || typeof envelope !== 'object' || typeof envelope.code !== 'number') {
    throw new BusinessApiError(-1, '接口响应格式异常');
  }
  if (envelope.code !== 0) {
    const message =
      typeof envelope.msg === 'string' && envelope.msg ? envelope.msg : '请求失败';
    throw new BusinessApiError(envelope.code, message);
  }
  return envelope.data as T;
}

// 把 axios 异常 / 网络异常统一成 BusinessApiError
export function normalizeError(err: unknown): unknown {
  if (isBusinessApiError(err)) return err;
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Envelope | undefined;
    if (data && typeof data === 'object' && typeof data.code === 'number') {
      return new BusinessApiError(
        data.code,
        typeof data.msg === 'string' && data.msg ? data.msg : '请求失败',
      );
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return new BusinessApiError(-1, '请求超时，请稍后重试');
    }
    return new BusinessApiError(-1, '网络请求失败，请稍后重试');
  }
  return err;
}

async function send<T>(
  path: string,
  config: AxiosRequestConfig,
  options: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.auth !== false) {
    const session = loadSession();
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
  }

  const response = await http.request({
    ...config,
    url: path,
    headers: {
      ...headers,
      ...(config.headers as Record<string, string> | undefined),
    },
  });

  return options.raw ? (response.data as T) : unwrapEnvelope<T>(response.data);
}

// 业务请求入口：path 相对于实例 baseURL
export async function request<T>(
  path: string,
  config: AxiosRequestConfig = {},
  options: RequestOptions = {},
): Promise<T> {
  try {
    return await send<T>(path, config, options);
  } catch (err) {
    const normalized = normalizeError(err);
    if (
      isBusinessApiError(normalized) &&
      options.retryOnUnauthorized !== false &&
      (normalized.code === CODE_UNAUTHENTICATED || normalized.code === CODE_ACCESS_EXPIRED)
    ) {
      try {
        await renewSession();
        return await send<T>(path, config, { ...options, retryOnUnauthorized: false });
      } catch (retryErr) {
        throw normalizeError(retryErr);
      }
    }
    throw normalized;
  }
}

// ———— access token 刷新（单飞，避免并发重复刷新） ————

let renewInFlight: Promise<BusinessSession> | undefined;

async function renewSession(): Promise<BusinessSession> {
  if (!renewInFlight) {
    renewInFlight = doRenew().finally(() => {
      renewInFlight = undefined;
    });
  }
  return renewInFlight;
}

// 依赖账号域的 POST /account/refresh（请求/响应结构见 account/account.ts 的 AuthResponse）
async function doRenew(): Promise<BusinessSession> {
  const current = loadSession();
  if (!current?.refreshToken) {
    clearSession();
    throw new BusinessApiError(CODE_UNAUTHENTICATED, '登录态已失效，请重新登录');
  }

  let auth: AuthPayload;
  try {
    auth = await request<AuthPayload>(
      '/account/refresh',
      { method: 'POST', data: { refreshToken: current.refreshToken } },
      { auth: false, retryOnUnauthorized: false },
    );
  } catch (err) {
    clearSession();
    throw err;
  }

  const session = applyAuthSession(auth, current);
  saveSession(session);
  return session;
}
