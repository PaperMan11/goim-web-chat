// 会话管理：登录设备会话列表与踢出指定会话。

import { listSessions, revokeSession, type SessionView } from '@/api/account/account';

export type { SessionView };

// 服务端按创建时间倒序返回；current 标记当前请求所在会话
export function loadSessions(): Promise<SessionView[]> {
  return listSessions();
}

// 踢出指定会话；当前会话由 UI 拦截（撤销后本地立即失效）
export function kickSession(sessionId: string): Promise<void> {
  return revokeSession(sessionId);
}
