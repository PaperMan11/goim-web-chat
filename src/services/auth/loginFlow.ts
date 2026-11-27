// 登录流程编排：账号登录 → im/token → SDK 登录 → 同步完成。
// UI 只调用这里的函数，不直接组合 api / im。

import {
  SyncState,
  type ClearConversationTips,
  type ConversationUpdateTips,
  type DeleteMsgsTips,
  type MarkAsReadTips,
  type RevokeMsgTips,
  type SendMsgResp,
} from '@goim/web-sdk';

import * as account from '@/api/account/account';
import * as imApi from '@/api/account/im';
import { CODE_DEPENDENCY, getDeviceId, isBusinessApiError, loadSession } from '@/api/client';
import { onAuthInvalid } from '@/api/http';
import { getMyProfile } from '@/api/account/profile';
import {
  getIM,
  initIM,
  loginIM,
  logoutIM,
  subscribeIM,
  waitForSync,
} from '@/im/client';
import {
  ensureIMTokenValid,
  refreshIMToken,
  startIMTokenRenewal,
  stopIMTokenRenewal,
} from '@/services/auth/imToken';
import { AuthStage, useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useContactsStore } from '@/stores/contacts';
import { errorMessage } from '@/utils/error';

let eventsBound = false;

// 登录态不可恢复：停续期 → 登出 SDK（Disconnect 断 WS、清内存 session）
// → 清业务态 → 整页回登录页
async function expireSession(): Promise<void> {
  stopIMTokenRenewal();
  try {
    // clearData=false 保留 IndexedDB（按 owner 分区，不影响切换）；
    // 关键是 Disconnect 把 WS 连接上的旧用户身份清掉，否则下一次 Connect()
    // 还可能拿到 IsConnected()=true 直接跳过重连
    await logoutIM(false);
  } catch {
    // ignore：wasm 未加载、WS 已断开等
  }
  useAuthStore().reset();
  useChatStore().reset();
  useContactsStore().reset();
  window.location.replace('/login');
}

function bindIMEvents(): void {
  if (eventsBound) return;
  eventsBound = true;

  // 业务侧 refresh 返回 1002/2004 时（例如设备被移除、会话被踢），立即退出登录，
  // 不依赖用户主动切换页面触发下一次请求。
  onAuthInvalid(() => expireSession());

  subscribeIM((event) => {
    const auth = useAuthStore();
    const chat = useChatStore();

    switch (event.type) {
      case 'transport':
        auth.transportStatus = event.status;
        break;
      case 'sync':
        const wasSynced = auth.syncState === SyncState.Synced;
        auth.syncState = event.state;
        if (event.state === SyncState.Synced && auth.stage === AuthStage.IMReady) {
          auth.stage = AuthStage.Synced;
        }
        // 同步完成（登录补拉 / 断线重连）后，离线消息已落本地但不会逐条推送 NewMsg，
        // 必须重读本地：会话列表摘要 + 当前打开会话的消息窗口
        if (event.state === SyncState.Synced && !wasSynced) {
          void chat.loadCachedConversations();
          void chat.refreshActiveConversation();
        }
        break;
      case 'message': {
        chat.upsertMessages(event.messages);
        const activeID = chat.activeConversationID;
        // 按会话分组：active 会话收到新消息直接 markRead 推到最新，不计未读；
        // 非 active 会话才去 refreshUnread
        const otherIDs: string[] = [];
        let activeMaxSeq = 0;
        let activeHasMsg = false;
        for (const msg of event.messages) {
          if (!msg.conversationID) continue;
          // 仅"正在查看且页面可见"才自动已读；tab 不可见时 active 会话也正常计未读
          if (msg.conversationID === activeID && chat.isPageVisible) {
            activeHasMsg = true;
            activeMaxSeq = Math.max(activeMaxSeq, msg.seq ?? 0);
          } else {
            otherIDs.push(msg.conversationID);
          }
        }
        if (otherIDs.length) void chat.refreshUnread(otherIDs);
        if (activeHasMsg) {
          // store 层面先清 0，避免 refreshUnread 异步回来造成的闪烁
          chat.unread[activeID] = 0;
          // 调 SDK markRead：同步更新本地 IsRead 字段 + 上报已读给服务端
          void chat.markActiveRead();
        }
        break;
      }
      case 'message-sent': {
        chat.markSent(event.resp as SendMsgResp);
        // 自己发消息成功后，该会话未读清 0（core 层已排除 self-sent 计入未读，
        // 这里再主动清 store 里的缓存，避免极端时序下的脏读）
        const clientMsgID = (event.resp as SendMsgResp)?.clientMsgID;
        if (clientMsgID) {
          for (const list of Object.values(chat.messagesByConversation)) {
            const m = list.find((x) => x.clientMsgID === clientMsgID);
            if (m?.conversationID) {
              chat.unread[m.conversationID] = 0;
              void chat.refreshUnreadFor(m.conversationID);
              break;
            }
          }
        }
        break;
      }
      case 'message-revoked': {
        // 2101 通知 tips（RevokeMsgTips）
        const tip = event.payload as RevokeMsgTips | undefined;
        if (tip?.conversationID && tip.seq) {
          chat.markRevoked(tip.conversationID, tip.seq, tip.clientMsgID);
        }
        break;
      }
      case 'message-deleted': {
        // 2102 通知 tips（DeleteMsgsTips）
        const tip = event.payload as DeleteMsgsTips | undefined;
        if (tip?.conversationID && tip.seqs?.length) {
          chat.markDeleted(tip.conversationID, tip.seqs);
        }
        break;
      }
      case 'conversation': {
        // 1300 会话变更 / SDK 摘要刷新：tips 带本次变更的会话 ID，只收窄未读刷新；
        // 列表仍整体重读（1300 的落库由随后的 conversations-synced 保证）
        const tip = event.payload as ConversationUpdateTips | undefined;
        void chat.loadCachedConversations(tip?.conversationIDList);
        break;
      }
      case 'conversations-synced':
        // 会话增量同步完成：payload 为空且可能含全量回退，全量重读 + 全量未读
        void chat.loadCachedConversations();
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
      case 'login':
        if (!event.ok) auth.imError = 'IM 登录失败';
        break;
      case 'session-expired':
        expireSession();
        break;
      case 'token-refreshed':
        // SDK 已用宿主注入的 token 完成续期，重排本地到期时间
        ensureIMTokenValid();
        break;
      case 'token-refresh-failed':
        // SDK 侧续期失败（无可用预取 token），由宿主立即重新兑换
        void refreshIMToken();
        break;
      default:
        break;
    }
  });
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
  // 重新登录期间先停旧续期，避免旧 token 的定时器干扰
  stopIMTokenRenewal();
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
    // 先初始化并注册事件，再登录：否则会漏掉 LoginSuccess / Connecting / SyncStart 等登录期事件
    await initIM({
      apiBaseURL: credentials.apiBaseUrl || undefined,
      wsEndpoint: credentials.wsUrl || undefined,
      platformID: credentials.platformId,
      deviceID: getDeviceId(),
      sdkVersion: __SDK_VERSION__,
    });
    bindIMEvents();

    // 关键防御：如果 goim 单例已登录过另一个用户（ForceLogout 后不刷直接切号、或手动退出后直接切号），
    // 必须先 logout(false) 清内存 session + Disconnect 断 WS；否则 WS 还连着旧用户，
    // 下一次 Connect() 会因 IsConnected()=true 跳过重连，新用户的 senderID 请求被服务端拒绝。
    const existing = getIM();
    if (existing?.currentUserID && existing.currentUserID !== credentials.userId) {
      await existing.logout(false);
    }

    await loginIM({
      userID: credentials.userId,
      token: credentials.token,
      expireTimeSeconds: credentials.expireTimeSeconds,
      platformID: credentials.platformId,
    });
    auth.stage = AuthStage.IMReady;
  } catch (err) {
    auth.imError = errorMessage(err);
    return;
  }

  // 登录成功后启动 IM token 续期：到期前预取并注入 SDK
  startIMTokenRenewal({
    expireTimeSeconds: credentials.expireTimeSeconds,
    onInvalid: () => expireSession(),
  });

  void afterReady();
}

async function afterReady(): Promise<void> {
  const auth = useAuthStore();
  const chat = useChatStore();
  // 先用本地缓存渲染会话，增量同步完成后再由事件刷新
  void chat.loadCachedConversations();
  // 直接刷新在 /chat/:id 时，ChatView 早于登录执行，消息需要在此补载
  void chat.refreshActiveConversation();

  try {
    auth.me = await getMyProfile();
  } catch {
    // 资料失败不影响聊天
  }

  try {
    await waitForSync(30_000);
    auth.stage = AuthStage.Synced;
  } catch {
    // 同步超时仍可继续使用本地缓存
  }
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
    void chat.loadCachedConversations();
  }
}

export async function logoutAccount(): Promise<void> {
  // 先停续期，避免登出过程中定时器又兑换一次 token
  stopIMTokenRenewal();
  try {
    await account.logout();
  } catch {
    // 服务端失败也要清理本地
  }
  // clearData=false：IndexedDB 按 owner 分区，不同用户互不影响，保留旧用户缓存省一次全量同步
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
