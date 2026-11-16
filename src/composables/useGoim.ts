// goim SDK 状态与业务逻辑的 Vue 组合式封装（模块级单例，供各组件共享）

import { computed, reactive } from 'vue';
import {
  ContentType,
  Goim,
  MsgFrom,
  MsgStatus,
  SessionType,
  SyncState,
  TransportStatus,
  isGoimError,
  type Conversation,
  type GoimEvent,
  type MsgData,
} from '@goim/web-sdk';
import * as account from '../api/account/account';
import * as im from '../api/account/im';
import { clearSession, CODE_DEPENDENCY, isBusinessApiError } from '../api/client';

// ———— 环境配置（见 .env.local） ————

// Go 侧 HTTP 客户端要求完整 URL，相对路径在这里补全为当前页面 origin
function resolveHttpBase(raw: string): string {
  return /^https?:\/\//.test(raw) ? raw : new URL(raw, location.origin).href;
}

const API_URL = resolveHttpBase(import.meta.env.VITE_GOIM_API_URL || '/api/v1');
const WS_URL = import.meta.env.VITE_GOIM_WS_URL || '/ws';
const PLATFORM_ID = Number(import.meta.env.VITE_GOIM_PLATFORM_ID || '5');

// 相对路径的 WS 地址按当前页面 origin 补全
function resolveEndpoint(raw: string): string {
  if (raw.startsWith('ws://') || raw.startsWith('wss://')) return raw;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

// ———— 状态 ————

interface ChatState {
  ready: boolean;
  initError: string;
  userID: string;
  transportStatus: number;
  syncState: number;
  conversations: Conversation[];
  selected?: Conversation;
  messages: MsgData[];
  logs: string[];
  loginName: string;
  password: string;
  loginError: string;
  loggingIn: boolean;
  registering: boolean;
  targetType: number;
  targetID: string;
  draft: string;
}

const state = reactive<ChatState>({
  ready: false,
  initError: '',
  userID: '',
  transportStatus: TransportStatus.Disconnected,
  syncState: SyncState.None,
  conversations: [],
  selected: undefined,
  messages: [],
  logs: [],
  loginName: '',
  password: '',
  loginError: '',
  loggingIn: false,
  registering: false,
  targetType: SessionType.C2C,
  targetID: '',
  draft: '',
});

// SDK 实例不做响应式代理，避免 vue 深度追踪 wasm 桥接对象
let client: Goim | undefined;
let refreshingConversations = false;
let booted = false;

// ———— 工具 ————

function errMsg(err: unknown): string {
  if (isBusinessApiError(err)) return `[${err.code}] ${err.message}`;
  if (isGoimError(err)) return `[${err.code}] ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

function log(line: string): void {
  const time = new Date().toLocaleTimeString();
  state.logs.push(`[${time}] ${line}`);
  // 只保留最近 1000 条，避免页面长时间运行后内存与渲染压力
  const max = 1000;
  if (state.logs.length > max) {
    state.logs.splice(0, state.logs.length - max);
  }
}

function logEvent(ev: GoimEvent): void {
  const payload =
    ev.payload === undefined ? '' : ` ${truncate(JSON.stringify(ev.payload), 240)}`;
  log(`event ${ev.name}${payload}`);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatTime(ms?: number): string {
  if (!ms) return '';
  return new Date(ms).toLocaleTimeString();
}

function newClientMsgID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ———— 展示用文案 ————

function connLabel(status: number): string {
  switch (status) {
    case TransportStatus.Connected:
      return '已连接';
    case TransportStatus.Connecting:
      return '连接中';
    default:
      return '未连接';
  }
}

function syncLabel(sync: number): string {
  switch (sync) {
    case SyncState.Syncing:
      return '同步中';
    case SyncState.Synced:
      return '已同步';
    case SyncState.Failed:
      return '同步失败';
    default:
      return '未开始';
  }
}

interface Badge {
  text: string;
  tone: '' | 'ok' | 'warn' | 'bad';
}

const connBadge = computed<Badge>(() => {
  if (!state.ready) {
    return state.initError
      ? { text: '初始化失败', tone: 'bad' }
      : { text: 'wasm 加载中', tone: '' };
  }
  const status = state.transportStatus;
  return {
    text: connLabel(status),
    tone:
      status === TransportStatus.Connected
        ? 'ok'
        : status === TransportStatus.Connecting
          ? 'warn'
          : 'bad',
  };
});

const syncBadge = computed<Badge>(() => {
  if (!state.userID) return { text: '同步 —', tone: '' };
  return {
    text: `同步 ${syncLabel(state.syncState)}`,
    tone:
      state.syncState === SyncState.Synced
        ? 'ok'
        : state.syncState === SyncState.Failed
          ? 'bad'
          : '',
  };
});

const userBadge = computed<Badge>(() =>
  state.userID
    ? { text: state.userID, tone: 'ok' }
    : { text: '未登录', tone: '' },
);

function conversationTitle(conv: Conversation): string {
  if (conv.conversationType === SessionType.Group) {
    return conv.msgInfo?.groupName || conv.groupID || conv.conversationID || '(未知群)';
  }
  return conv.msgInfo?.senderName || conv.userID || conv.conversationID || '(未知会话)';
}

function statusText(status?: number): string {
  switch (status) {
    case MsgStatus.Sending:
      return '发送中';
    case MsgStatus.Failed:
      return '发送失败';
    case MsgStatus.Revoked:
      return '已撤回';
    default:
      return '';
  }
}

function messageMeta(msg: MsgData): string {
  return [statusText(msg.status), msg.seq ? `#${msg.seq}` : ''].filter(Boolean).join(' ');
}

function messageHead(msg: MsgData): string {
  const who =
    msg.sendID === state.userID
      ? '我'
      : msg.senderNickname || msg.sendID || '未知';
  return `${who} · ${formatTime(msg.sendTime)}`;
}

// ———— 状态同步 ————

function updateStatus(): void {
  if (!client) return;
  state.transportStatus = client.status();
  state.userID = client.currentUserID ?? '';
  if (!state.userID) {
    state.syncState = SyncState.None;
    return;
  }
  try {
    state.syncState = client.syncState();
  } catch {
    state.syncState = SyncState.None;
  }
}

// ———— 数据操作 ————

function mergeMessage(msg: MsgData): void {
  const index = state.messages.findIndex(
    (m) =>
      (msg.serverMsgID && m.serverMsgID === msg.serverMsgID) ||
      (msg.clientMsgID && m.clientMsgID === msg.clientMsgID),
  );
  if (index >= 0) {
    state.messages[index] = { ...state.messages[index], ...msg };
  } else {
    state.messages.push(msg);
  }
  state.messages.sort((a, b) => {
    if (a.seq && b.seq && a.seq !== b.seq) return a.seq - b.seq;
    return (a.sendTime ?? 0) - (b.sendTime ?? 0);
  });
}

function markSent(clientMsgID: string, serverMsgID?: string, sendTime?: number): void {
  const index = state.messages.findIndex((m) => m.clientMsgID === clientMsgID);
  if (index < 0) return;
  state.messages[index] = {
    ...state.messages[index],
    status: MsgStatus.Success,
    ...(serverMsgID ? { serverMsgID } : {}),
    ...(sendTime ? { sendTime } : {}),
  };
}

async function refreshConversations(): Promise<void> {
  if (!client?.currentUserID || refreshingConversations) return;
  refreshingConversations = true;
  try {
    let local: Conversation[] = [];
    try {
      local = await client.conversations.listLocal();
    } catch (err) {
      log(`读取本地会话失败：${errMsg(err)}`);
    }

    let remote: Conversation[] = [];
    try {
      remote = await client.conversations.getAll();
    } catch (err) {
      log(`拉取远端会话失败：${errMsg(err)}`);
    }

    state.conversations = remote.length ? remote : local;
    log(`会话刷新：远端 ${remote.length} 条 / 本地 ${local.length} 条`);
  } finally {
    refreshingConversations = false;
  }
}

async function selectConversation(conv: Conversation): Promise<void> {
  state.selected = conv;
  state.messages = [];
  state.targetType = conv.conversationType ?? SessionType.C2C;
  state.targetID =
    (conv.conversationType === SessionType.Group ? conv.groupID : conv.userID) ?? '';

  if (!client || !conv.conversationID) return;

  try {
    state.messages = await client.messages.historyLocal(conv.conversationID);
    log(`本地历史 ${conv.conversationID}: ${state.messages.length} 条`);
  } catch (err) {
    log(`读取本地历史失败：${errMsg(err)}`);
  }

  const lastSeq = state.messages.reduce((max, m) => Math.max(max, m.seq ?? 0), 0);
  if (lastSeq > 0) {
    void client.messages
      .markRead(conv.conversationID, lastSeq)
      .catch((err) => log(`标记已读失败：${errMsg(err)}`));
  }
}

async function sendMessage(): Promise<void> {
  if (!client?.currentUserID) {
    log('请先登录');
    return;
  }

  const text = state.draft.trim();
  if (!text) return;

  const sessionType = Number(state.targetType);
  const target = state.targetID.trim();
  if (!target) {
    log('请填写发送目标 userID / groupID');
    return;
  }

  const clientMsgID = newClientMsgID();
  mergeMessage({
    clientMsgID,
    sendID: client.currentUserID,
    sessionType,
    msgFrom: MsgFrom.User,
    contentType: ContentType.Text,
    content: text,
    createTime: Date.now(),
    sendTime: Date.now(),
    status: MsgStatus.Sending,
    conversationID: state.selected?.conversationID,
  });
  state.draft = '';

  try {
    const resp = await client.messages.sendText(
      sessionType === SessionType.Group
        ? { sessionType, groupID: target }
        : { sessionType, userID: target },
      text,
      { clientMsgID },
    );
    markSent(clientMsgID, resp.serverMsgID, resp.sendTime);
    log(`发送成功 clientMsgID=${clientMsgID} serverMsgID=${resp.serverMsgID}`);
  } catch (err) {
    const index = state.messages.findIndex((m) => m.clientMsgID === clientMsgID);
    if (index >= 0) {
      state.messages[index] = { ...state.messages[index], status: MsgStatus.Failed };
    }
    log(`发送失败：${errMsg(err)}`);
  }
}

// ———— IM token 自动续期 ————

const IM_TOKEN_RENEW_INTERVAL_MS = 30 * 1000;
const IM_TOKEN_RENEW_AHEAD_MS = 5 * 60 * 1000;

let imTokenExpireAt = 0;
let imRenewTimer: number | undefined;
let imRenewing = false;

function stopImTokenRenewal(): void {
  if (imRenewTimer !== undefined) {
    window.clearInterval(imRenewTimer);
    imRenewTimer = undefined;
  }
  imTokenExpireAt = 0;
}

async function renewImToken(): Promise<void> {
  if (!client?.currentUserID || imRenewing) return;
  if (imTokenExpireAt - Date.now() >= IM_TOKEN_RENEW_AHEAD_MS) return;

  imRenewing = true;
  try {
    const resp = await im.imToken();
    client.updateToken(resp.token, resp.expireTimeSeconds);
    imTokenExpireAt = Date.now() + resp.expireTimeSeconds * 1000;
    log(`IM token 已自动续期，剩余 ${resp.expireTimeSeconds}s`);
  } catch (err) {
    log(`IM token 续期失败：${errMsg(err)}`);
  } finally {
    imRenewing = false;
  }
}

function startImTokenRenewal(expireTimeSeconds: number): void {
  stopImTokenRenewal();
  imTokenExpireAt = Date.now() + expireTimeSeconds * 1000;
  imRenewTimer = window.setInterval(() => {
    void renewImToken();
  }, IM_TOKEN_RENEW_INTERVAL_MS);
}

// ———— 登录 / 注册 ————

// IM 账号尚未开通时先触发重试，再兑换一次
async function exchangeImToken(): Promise<im.IMTokenResponse> {
  try {
    return await im.imToken();
  } catch (err) {
    if (!isBusinessApiError(err) || err.code !== CODE_DEPENDENCY) {
      throw err;
    }
    log('IM 账号尚未开通，尝试重新开通…');
    try {
      await im.imRetry();
      return await im.imToken();
    } catch {
      throw new Error('IM 账号开通失败，请稍后重试');
    }
  }
}

async function authenticate(kind: 'login' | 'register'): Promise<void> {
  if (!client || state.loggingIn || state.registering) return;

  const loginName = state.loginName.trim();
  const password = state.password;
  if (!loginName) {
    state.loginError = '请输入登录名';
    return;
  }
  if (!password) {
    state.loginError = '请输入密码';
    return;
  }

  state.loginError = '';
  if (kind === 'login') {
    state.loggingIn = true;
  } else {
    state.registering = true;
  }
  try {
    if (kind === 'login') {
      await account.login({ loginName, password });
      log(`业务登录成功：${loginName}`);
    } else {
      await account.register({ loginName, password, nickname: loginName });
      log(`业务注册成功：${loginName}`);
    }

    const imToken = await exchangeImToken();
    await client.loginWithToken(
      imToken.userId,
      imToken.token,
      imToken.expireTimeSeconds,
      imToken.platformId || PLATFORM_ID,
    );
    startImTokenRenewal(imToken.expireTimeSeconds);
    state.password = '';
    log('IM 登录返回（WS 就绪），等待后台同步…');
    updateStatus();
    void refreshConversations();
  } catch (err) {
    // 登录失败不吞错误；同时清理定时器与业务会话，避免残留半登录态
    stopImTokenRenewal();
    clearSession();
    state.loginError = errMsg(err);
    log(`${kind === 'login' ? '登录' : '注册'}失败：${errMsg(err)}`);
  } finally {
    state.loggingIn = false;
    state.registering = false;
    updateStatus();
  }
}

async function login(): Promise<void> {
  await authenticate('login');
}

async function register(): Promise<void> {
  await authenticate('register');
}

async function logout(): Promise<void> {
  stopImTokenRenewal();
  state.selected = undefined;
  state.messages = [];
  state.conversations = [];

  try {
    await account.logout();
  } catch (err) {
    log(`业务登出失败：${errMsg(err)}`);
  }

  if (!client?.currentUserID) {
    updateStatus();
    return;
  }
  try {
    await client.logout(false);
    log('已登出（保留本地数据）');
  } catch (err) {
    log(`登出失败：${errMsg(err)}`);
  }
  updateStatus();
}

// ———— 事件 ————

function onIncomingMessage(msg: MsgData): void {
  const convID = msg.conversationID;
  if (state.selected?.conversationID && convID === state.selected.conversationID) {
    mergeMessage(msg);
  } else {
    log(`收到其它会话消息 conv=${convID ?? '?'} content=${truncate(msg.content ?? '', 60)}`);
  }
  void refreshConversations();
}

function bindEvents(goim: Goim): void {
  goim.on((ev) => {
    logEvent(ev);
    switch (ev.name) {
      case 'EventNewMsg': {
        const msg = ev.payload as MsgData | undefined;
        if (msg) onIncomingMessage(msg);
        break;
      }
      case 'EventMsgSent': {
        const resp = ev.payload as
          | { clientMsgID?: string; serverMsgID?: string; sendTime?: number }
          | undefined;
        if (resp?.clientMsgID) {
          markSent(resp.clientMsgID, resp.serverMsgID, resp.sendTime);
        }
        break;
      }
      case 'EventSyncFinish':
      case 'EventConversationUpdate':
      case 'EventConversationSynced':
        void refreshConversations();
        break;
      case 'EventForceLogout':
        log('被踢下线，已清理会话状态');
        void logout();
        break;
      default:
        break;
    }
    updateStatus();
  });
}

// ———— 启动 ————

async function boot(): Promise<void> {
  if (booted) return;
  booted = true;
  log(`api=${API_URL}`);
  log(`ws=${resolveEndpoint(WS_URL)}`);
  try {
    client = await Goim.init(
      {
        baseURL: API_URL,
        endpoint: resolveEndpoint(WS_URL),
        platformID: PLATFORM_ID,
        sessionDataPath: 'idb',
        // wasm 无 stdout，日志经 onLog 回调进入页面事件日志；级别由这里控制
        logging: { level: 'debug', format: 'console' },
      },
      // 显式指定 wasm 资源目录，避免依赖 SDK 包内相对路径
      { wasmBasePath: `${import.meta.env.BASE_URL}wasm/` },
    );
    bindEvents(client);
    state.ready = true;
    updateStatus();
    log('wasm 与 goimSdk 就绪');
    window.setInterval(updateStatus, 1000);
  } catch (err) {
    const message = errMsg(err);
    state.initError = message;
    log(`初始化失败：${message}`);
  }
}

export function useGoim() {
  return {
    state,
    connBadge,
    syncBadge,
    userBadge,
    boot,
    login,
    register,
    logout,
    refreshConversations,
    selectConversation,
    sendMessage,
    clearLogs: () => {
      state.logs = [];
    },
    conversationTitle,
    messageHead,
    messageMeta,
    formatTime,
  };
}
