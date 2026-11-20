// 登录流程编排：账号登录 → im/token → SDK 登录 → 同步完成。
// UI 只调用这里的函数，不直接组合 api / im。

import {
  SyncState,
  type ClearConversationTips,
  type MarkAsReadTips,
  type RevokeMsgTips,
  type SendMsgResp,
} from '@goim/web-sdk';

import * as account from '@/api/account/account';
import * as imApi from '@/api/account/im';
import { CODE_DEPENDENCY, isBusinessApiError, loadSession } from '@/api/client';
import { getMyProfile } from '@/api/profile/profile';
import {
  getIMSnapshot,
  loginIMWithToken,
  logoutIM,
  subscribeIM,
  waitForSync,
} from '@/im/client';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useContactsStore } from '@/stores/contacts';
import { errorMessage } from '@/utils/error';

let eventsBound = false;

function bindIMEvents(): void {
  if (eventsBound) return;
  eventsBound = true;

  subscribeIM((event) => {
    const auth = useAuthStore();
    const chat = useChatStore();

    switch (event.type) {
      case 'transport':
        auth.transportStatus = event.status;
        break;
      case 'sync':
        auth.syncState = event.state;
        if (event.state === SyncState.Synced && auth.stage === AuthStage.IMReady) {
          auth.stage = AuthStage.Synced;
        }
        break;
      case 'message':
        chat.upsertMessages(event.messages);
        void chat.refreshUnread();
        break;
      case 'message-sent':
        chat.markSent(event.resp as SendMsgResp);
        break;
      case 'message-revoked': {
        // 2101 通知 tips（RevokeMsgTips）
        const tip = event.payload as RevokeMsgTips | undefined;
        if (tip?.conversationID && tip.seq) chat.markRevoked(tip.conversationID, tip.seq);
        break;
      }
      case 'conversation':
        // 1300 会话变更（ConversationUpdateTips），SDK 已增量同步缓存，这里只刷新列表
        void chat.loadConversations();
        break;
      case 'conversation-deleted': {
        const tip = event.payload as ClearConversationTips | undefined;
        for (const conversationID of tip?.conversationIDs ?? []) {
          chat.removeConversation(conversationID);
        }
        break;
      }
      case 'read': {
        // 2200 已读回执（MarkAsReadTips），SDK 已更新本地缓存
        const tip = event.payload as MarkAsReadTips | undefined;
        void (tip?.conversationID
          ? chat.refreshUnreadFor(tip.conversationID)
          : chat.refreshUnread());
        break;
      }
      case 'session-expired':
        auth.reset();
        chat.reset();
        useContactsStore().reset();
        // 被动下线：整页回登录页，确保 wasm/runtime 状态一并重置
        window.location.replace('/login');
        break;
      default:
        break;
    }
  });
}

// 连接/同步事件可能早于订阅发生（loginWithToken 返回时通常已连上），
// 订阅后用快照回填一次，避免 UI 停留在初始的「未连接」
function syncIMStatus(): void {
  const auth = useAuthStore();
  const snapshot = getIMSnapshot();
  auth.transportStatus = snapshot.transport;
  auth.syncState = snapshot.sync;
  if (snapshot.sync === SyncState.Synced && auth.stage === AuthStage.IMReady) {
    auth.stage = AuthStage.Synced;
  }
}

// 页面刷新后恢复登录态
let bootstrapping: Promise<void> | undefined;

export function bootstrapAuth(): Promise<void> {
  if (!bootstrapping) {
    bootstrapping = doBootstrap().catch((err) => {
      bootstrapping = undefined;
      throw err;
    });
  }
  return bootstrapping;
}

async function doBootstrap(): Promise<void> {
  const auth = useAuthStore();
  const session = loadSession();
  if (!session) {
    auth.reset();
    return;
  }
  auth.setSession(session);
  await startIM();
}

export async function loginWithPassword(loginName: string, password: string): Promise<void> {
  const auth = useAuthStore();
  auth.loading = true;
  try {
    const session = await account.login({ loginName, password });
    auth.setSession(session);
    await startIM();
  } finally {
    auth.loading = false;
  }
}

export async function registerAndLogin(loginName: string, password: string): Promise<void> {
  const auth = useAuthStore();
  auth.loading = true;
  try {
    const session = await account.register({ loginName, password, nickname: loginName });
    auth.setSession(session);
    await startIM();
  } finally {
    auth.loading = false;
  }
}

// 用业务后端签发的 IM 凭证登录 SDK；失败时停留在 biz-authenticated，可重试
export async function startIM(): Promise<void> {
  const auth = useAuthStore();
  auth.stage = AuthStage.BizAuthenticated;
  auth.imError = '';

  let credentials: imApi.IMTokenResponse;
  try {
    credentials = await imApi.imToken();
  } catch (err) {
    auth.imError =
      isBusinessApiError(err) && err.code === CODE_DEPENDENCY
        ? 'IM 服务暂不可用，请稍后重试'
        : errorMessage(err);
    return;
  }

  auth.stage = AuthStage.IMConnecting;
  try {
    await loginIMWithToken({
      userID: credentials.userId,
      token: credentials.token,
      expireTimeSeconds: credentials.expireTimeSeconds,
      platformID: credentials.platformId,
      apiBaseURL: credentials.apiBaseUrl || undefined,
      wsEndpoint: credentials.wsUrl || undefined,
    });
    bindIMEvents();
    syncIMStatus();
    auth.stage = AuthStage.IMReady;
  } catch (err) {
    auth.imError = errorMessage(err);
    return;
  }

  void afterReady();
}

async function afterReady(): Promise<void> {
  const auth = useAuthStore();
  try {
    auth.me = await getMyProfile();
  } catch {
    // 资料失败不影响聊天
  }

  try {
    await waitForSync(30_000);
    auth.stage = AuthStage.Synced;
  } catch {
    // 同步超时仍可继续加载会话
  }

  await useChatStore().loadConversations();
}

// IM 未开通时重新开通再登录
export async function retryIM(): Promise<void> {
  const auth = useAuthStore();
  const chat = useChatStore();
  try {
    await imApi.imRetry();
  } catch (err) {
    auth.imError = errorMessage(err);
    return;
  }
  await startIM();
  if (auth.stage === AuthStage.IMReady || auth.stage === AuthStage.Synced) {
    void chat.loadConversations();
  }
}

export async function logoutAccount(): Promise<void> {
  try {
    await account.logout();
  } catch {
    // 服务端失败也要清理本地
  }
  try {
    await logoutIM(false);
  } catch {
    // ignore
  }
  const auth = useAuthStore();
  auth.reset();
  useChatStore().reset();
  useContactsStore().reset();
}

export function markMessageFailed(clientMsgID: string): void {
  useChatStore().markFailed(clientMsgID);
}
