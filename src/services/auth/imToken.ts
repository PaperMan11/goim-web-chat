// IM token 生命周期：到期前预取新 token 注入 SDK（wasm 预取模式），
// 避免连接因 token 过期中断。core 在请求认证失败或 token 过期时消费注入值。

import { imToken } from '@/api/account/im';
import {
  CODE_ACCESS_EXPIRED,
  CODE_UNAUTHENTICATED,
  isBusinessApiError,
} from '@/api/client';
import { updateIMToken } from '@/im/client';

// 提前刷新量：最多 5 分钟；短 TTL 场景按剩余时间 20% 提前
const MAX_GUARD_MS = 5 * 60 * 1000;
// 定时器最小间隔，避免过期瞬间连发
const MIN_SCHEDULE_MS = 5 * 1000;
// 可重试错误（网络/IM 未就绪）的退避参数
const RETRY_BASE_MS = 30 * 1000;
const RETRY_MAX_MS = 5 * 60 * 1000;

interface RenewalState {
  expiresAt: number;
}

export interface IMTokenRenewalOptions {
  expireTimeSeconds: number;
  // 凭证失效（业务会话与 IM token 均无法续期）：宿主应清理登录态并回登录页
  onInvalid: (err: unknown) => void;
}

let state: RenewalState | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<boolean> | undefined;
let inFlightGeneration = -1;
// 登出/重启时递增：丢弃旧一轮刷新迟到的结果
let generation = 0;
let retryAttempt = 0;
let onInvalidHandler: ((err: unknown) => void) | undefined;
let listenersBound = false;

function clearTimer(): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
}

// 到期前的提前量：短 TTL 不会被固定 5 分钟吃掉
function guardOf(remaining: number): number {
  return Math.min(MAX_GUARD_MS, Math.max(remaining, 0) / 5);
}

function schedule(): void {
  clearTimer();
  if (!state) return;
  const remaining = state.expiresAt - Date.now();
  const delay =
    remaining <= 0
      ? 0
      : Math.max(remaining - guardOf(remaining), MIN_SCHEDULE_MS);
  timer = setTimeout(() => {
    void refreshIMToken();
  }, delay);
}

// 登录成功后启动：记录到期时间并排定刷新
export function startIMTokenRenewal(options: IMTokenRenewalOptions): void {
  stopIMTokenRenewal();
  onInvalidHandler = options.onInvalid;
  state = {
    expiresAt: Date.now() + Math.max(options.expireTimeSeconds, 0) * 1000,
  };
  bindGlobalListeners();
  schedule();
}

// 登出 / 被动下线：停止定时器并作废在途刷新
export function stopIMTokenRenewal(): void {
  generation += 1;
  state = undefined;
  onInvalidHandler = undefined;
  retryAttempt = 0;
  clearTimer();
}

// 主动刷新：单飞，避免定时器与事件同时触发重复兑换
// 登出后重新登录（generation 变化）时不受上一轮在途请求影响
export function refreshIMToken(): Promise<boolean> {
  if (inFlight && inFlightGeneration === generation) return inFlight;
  if (!state) return Promise.resolve(false);
  const gen = generation;
  let task: Promise<boolean>;
  task = doRefresh(gen).finally(() => {
    if (inFlight === task) inFlight = undefined;
  });
  inFlight = task;
  inFlightGeneration = gen;
  return task;
}

// 页面恢复可见 / 网络恢复 / 重连前补检：快过期立即刷新，否则重排定时器
export function ensureIMTokenValid(): void {
  if (!state) return;
  const remaining = state.expiresAt - Date.now();
  if (remaining <= guardOf(remaining)) {
    void refreshIMToken();
    return;
  }
  schedule();
}

async function doRefresh(gen: number): Promise<boolean> {
  try {
    const result = await imToken();
    if (gen !== generation) return false;

    const seconds = Math.max(result.expireTimeSeconds, 0);
    updateIMToken(result.token, seconds);
    state = { expiresAt: Date.now() + seconds * 1000 };
    retryAttempt = 0;

    // 服务端给出已过期 token 时不进入立即刷新循环，按可重试错误退避
    if (seconds <= 0) {
      clearTimer();
      timer = setTimeout(() => {
        void refreshIMToken();
      }, RETRY_BASE_MS);
      return true;
    }
    schedule();
    return true;
  } catch (err) {
    if (gen !== generation) return false;
    if (isCredentialInvalid(err)) {
      const handler = onInvalidHandler;
      stopIMTokenRenewal();
      handler?.(err);
      return false;
    }
    retryAttempt += 1;
    const delay = Math.min(RETRY_BASE_MS * 2 ** (retryAttempt - 1), RETRY_MAX_MS);
    clearTimer();
    timer = setTimeout(() => {
      void refreshIMToken();
    }, delay);
    return false;
  }
}

// 业务 access token 续期后仍 401/1002/2004 → 登录态已不可恢复
function isCredentialInvalid(err: unknown): boolean {
  return (
    isBusinessApiError(err) &&
    (err.code === CODE_UNAUTHENTICATED || err.code === CODE_ACCESS_EXPIRED)
  );
}

function bindGlobalListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  // 后台标签页定时器会被节流到分钟级，恢复可见时补检
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureIMTokenValid();
  });
  window.addEventListener('online', () => ensureIMTokenValid());
}
