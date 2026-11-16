// 业务后端的公共基础：错误模型、会话持久化、设备标识。
// HTTP 请求实现见 http.ts；具体接口按业务域放在对应目录（如 account/account.ts）。

const SESSION_KEY = 'goim_biz_session';
const DEVICE_KEY = 'goim_biz_device_id';

// 与 goim-business/internal/pkg/errcode 保持一致
export const CODE_UNAUTHENTICATED = 1002;
export const CODE_ACCESS_EXPIRED = 2004;
export const CODE_DEPENDENCY = 9002;

// 注册/登录/刷新响应的公共字段；完整账号响应结构见 account/account.ts 的 AuthResponse
export interface AuthPayload {
  user?: { userId?: string; loginName?: string };
  token: { accessToken: string; expiresIn: number };
  refreshToken?: string;
  refreshExpiresIn: number;
}

// 持久化到 localStorage 的业务会话；expiresAt / refreshExpiresAt 为毫秒时间戳
export interface BusinessSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  userId: string;
  loginName: string;
}

export class BusinessApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessApiError';
  }
}

export function isBusinessApiError(err: unknown): err is BusinessApiError {
  return err instanceof BusinessApiError;
}

// ———— 会话持久化 ————

export function loadSession(): BusinessSession | undefined {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<BusinessSession>;
    if (!parsed.accessToken || !parsed.refreshToken) return undefined;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt) || 0,
      refreshExpiresAt: Number(parsed.refreshExpiresAt) || 0,
      userId: parsed.userId ?? '',
      loginName: parsed.loginName ?? '',
    };
  } catch {
    return undefined;
  }
}

export function saveSession(session: BusinessSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // localStorage 不可用时仅保留内存态，不影响本次登录
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

// ———— 设备标识 ————

let memoryDeviceID = '';

function newDeviceID(): string {
  const suffix =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `web-${suffix}`;
}

export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = newDeviceID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    if (!memoryDeviceID) memoryDeviceID = newDeviceID();
    return memoryDeviceID;
  }
}

// 把 AuthResponse 落成可持久化会话（account/account.ts 的 register/login 复用）
export function applyAuthSession(
  auth: AuthPayload,
  previous?: BusinessSession,
): BusinessSession {
  const now = Date.now();
  return {
    accessToken: auth.token.accessToken,
    refreshToken: auth.refreshToken || previous?.refreshToken || '',
    expiresAt: now + (Number(auth.token.expiresIn) || 0) * 1000,
    refreshExpiresAt: now + (Number(auth.refreshExpiresIn) || 0) * 1000,
    userId: auth.user?.userId ?? '',
    loginName: auth.user?.loginName ?? previous?.loginName ?? '',
  };
}
