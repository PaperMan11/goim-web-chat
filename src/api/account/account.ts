// 账号域接口，与 goim-business internal/handler/account/account.go 一一对应。
// 目录与文件命名均对齐 handler，后续新增业务域按 internal/handler/<domain>/ 建对应目录。

import {
  applyAuthSession,
  clearSession,
  getDeviceId,
  saveSession,
  type AuthPayload,
  type BusinessSession,
} from '../client';
import { request } from '../http';

export interface UserView {
  userId: string;
  loginName: string;
  nickname: string;
}

// 注册/登录/刷新的响应（types.AuthResp）
export interface AuthResponse extends AuthPayload {
  user: UserView;
  sessionId: string;
  platform: number;
}

// POST /account/register
export async function register(input: {
  loginName: string;
  password: string;
  nickname?: string;
}): Promise<BusinessSession> {
  const auth = await request<AuthResponse>(
    '/account/register',
    {
      method: 'POST',
      data: {
        loginName: input.loginName,
        password: input.password,
        nickname: input.nickname || input.loginName,
        deviceId: getDeviceId(),
      },
    },
    { auth: false, retryOnUnauthorized: false },
  );
  const session = applyAuthSession(auth);
  saveSession(session);
  return session;
}

// POST /account/login
export async function login(input: {
  loginName: string;
  password: string;
}): Promise<BusinessSession> {
  const auth = await request<AuthResponse>(
    '/account/login',
    {
      method: 'POST',
      data: {
        loginName: input.loginName,
        password: input.password,
        deviceId: getDeviceId(),
      },
    },
    { auth: false, retryOnUnauthorized: false },
  );
  const session = applyAuthSession(auth);
  saveSession(session);
  return session;
}

// POST /account/logout；无论服务端结果如何都清空本地会话
export async function logout(): Promise<void> {
  try {
    await request<unknown>(
      '/account/logout',
      { method: 'POST' },
      { retryOnUnauthorized: false },
    );
  } finally {
    clearSession();
  }
}

// 与 goim-business types.SessionView 一致（不含任何令牌）
export interface SessionView {
  sessionId: string;
  platform: number;
  deviceId: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string | null;
  expiresAt: string;
  current: boolean;
}

// GET /account/sessions
export async function listSessions(): Promise<SessionView[]> {
  return request<SessionView[]>('/account/sessions', { method: 'GET' });
}

// POST /account/sessions/revoke；sessionId 为十进制数字字符串
export async function revokeSession(sessionId: string): Promise<void> {
  await request<unknown>('/account/sessions/revoke', {
    method: 'POST',
    data: { sessionId },
  });
}

// PUT /account/password；成功后服务端会撤销除当前会话外的全部会话
export async function changePassword(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  await request<unknown>('/account/password', {
    method: 'PUT',
    data: {
      oldPassword: input.oldPassword,
      newPassword: input.newPassword,
    },
  });
}
