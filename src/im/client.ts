// IM 适配层：唯一接触 @goim/web-sdk 的位置。
// 负责 SDK 初始化、token 登录、状态快照与业务事件订阅；store 不直接 import SDK。

import {
  Goim,
  GoimError,
  SyncState,
  TransportStatus,
  type GoimLogConfig,
  type LogHandler,
  type SyncStateValue,
  type TransportStatusValue,
} from '@goim/web-sdk';

import { translateEvent, type IMBusinessEvent, type IMEventSnapshot } from './events';

// ———— 默认配置（可被 imToken 返回的地址覆盖） ————

function resolveHttpBase(raw: string): string {
  return /^https?:\/\//.test(raw) ? raw : new URL(raw, location.origin).href;
}

function resolveEndpoint(raw: string): string {
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function defaultPlatformID(): number {
  return Number(import.meta.env.VITE_GOIM_PLATFORM_ID || '5');
}

export interface IMInitOptions {
  apiBaseURL?: string;
  wsEndpoint?: string;
  platformID?: number;
  wasmBasePath?: string;
  // false 表示关闭全部 SDK 日志
  logging?: GoimLogConfig | false;
}

let goim: Goim | undefined;
let initInflight: Promise<Goim> | undefined;

// 幂等初始化：并发调用共享同一个 Promise
export function initIM(options: IMInitOptions = {}): Promise<Goim> {
  if (goim) return Promise.resolve(goim);
  if (!initInflight) {
    initInflight = doInit(options).catch((err) => {
      initInflight = undefined; // 失败后允许重试
      throw err;
    });
  }
  return initInflight;
}

async function doInit(options: IMInitOptions): Promise<Goim> {
  const apiBaseURL = resolveHttpBase(
    options.apiBaseURL || import.meta.env.VITE_GOIM_API_URL || '/api/v1',
  );
  const wsEndpoint = resolveEndpoint(
    options.wsEndpoint || import.meta.env.VITE_GOIM_WS_URL || '/ws',
  );
  const logging =
    options.logging === false
      ? { disable: true }
      : options.logging ?? { level: 'info', format: 'console' };

  goim = await Goim.init(
    {
      baseURL: apiBaseURL,
      endpoint: wsEndpoint,
      platformID: options.platformID ?? defaultPlatformID(),
      sessionDataPath: 'idb',
      logging,
    },
    // 显式指定 wasm 资源目录，避免依赖 SDK 包内相对路径
    { wasmBasePath: options.wasmBasePath ?? `${import.meta.env.BASE_URL}wasm/` },
  );
  return goim;
}

export function getIM(): Goim | undefined {
  return goim;
}

export function requireIM(): Goim {
  if (!goim) throw new GoimError(90010, 'IM 尚未初始化');
  return goim;
}

// ———— 登录 / 登出 ————

export interface IMLoginInput {
  userID: string;
  token: string;
  expireTimeSeconds: number;
  platformID?: number;
}

// 使用已初始化的实例登录。调用方可先 initIM() 并注册事件，
// 再调用本函数，避免漏掉 LoginSuccess / SyncStart 等登录期事件。
export async function loginIM(input: IMLoginInput): Promise<void> {
  await requireIM().loginWithToken(
    input.userID,
    input.token,
    input.expireTimeSeconds,
    input.platformID ?? defaultPlatformID(),
  );
}

// 一站式：初始化 + 登录（apiBaseURL / wsEndpoint 缺省时用环境配置）
export async function loginIMWithToken(
  input: IMLoginInput & { apiBaseURL?: string; wsEndpoint?: string },
): Promise<void> {
  await initIM({
    apiBaseURL: input.apiBaseURL,
    wsEndpoint: input.wsEndpoint,
    platformID: input.platformID,
  });
  await loginIM(input);
}

// clearData=true 时清空本地 IndexedDB（切换账号场景）
export async function logoutIM(clearData = false): Promise<void> {
  await requireIM().logout(clearData);
}

// 业务 token 续期后同步给 SDK，避免 IM 侧因过期被踢下线
export function updateIMToken(token: string, expireTimeSeconds: number): void {
  requireIM().updateToken(token, expireTimeSeconds);
}

// ———— 状态 ————

function readSyncState(instance: Goim): SyncStateValue {
  try {
    return instance.syncState();
  } catch {
    return SyncState.None;
  }
}

export interface IMStatusSnapshot {
  transport: TransportStatusValue;
  sync: SyncStateValue;
  userID?: string;
}

export function getIMSnapshot(): IMStatusSnapshot {
  const instance = requireIM();
  return {
    transport: instance.status(),
    sync: readSyncState(instance),
    userID: instance.currentUserID,
  };
}

// ———— 等待就绪 ————

function waitForEvent(name: string, timeoutMs: number, message: string): Promise<void> {
  const instance = requireIM();
  return new Promise<void>((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      reject(new GoimError(-2, message));
    }, timeoutMs);
    off = instance.onEvent(name, () => {
      clearTimeout(timer);
      off();
      resolve();
    });
  });
}

// 等待 WS 连接就绪（loginWithToken 返回后通常已连接）
export function waitForConnection(timeoutMs = 10_000): Promise<void> {
  const instance = requireIM();
  if (instance.status() === TransportStatus.Connected) return Promise.resolve();
  return waitForEvent('EventConnect', timeoutMs, '等待 IM 连接超时');
}

// 等待离线消息同步完成，可用于「已同步」角标
export function waitForSync(timeoutMs = 30_000): Promise<void> {
  const instance = requireIM();
  if (readSyncState(instance) === SyncState.Synced) return Promise.resolve();
  return waitForEvent('EventSyncFinish', timeoutMs, '等待消息同步超时');
}

// 手动重连（服务端恢复后或长时间断线时由 UI 触发）
export async function reconnectIM(): Promise<void> {
  const instance = requireIM();
  if (instance.status() === TransportStatus.Connected) return;
  await instance.connect();
}

// ———— 事件 ————

// 订阅业务事件；返回取消函数
export function subscribeIM(listener: (event: IMBusinessEvent) => void): () => void {
  const instance = requireIM();
  return instance.on((event) => {
    const snapshot: IMEventSnapshot = {
      transport: instance.status(),
      sync: readSyncState(instance),
    };
    const translated = translateEvent(event, snapshot);
    for (const item of translated) listener(item);
  });
}

export function onIMLog(handler: LogHandler): () => void {
  return requireIM().onLog(handler);
}
