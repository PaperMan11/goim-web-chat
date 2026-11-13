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

// ———— 环境配置（见 .env.local） ————

// Go 侧 HTTP 客户端要求完整 URL，相对路径在这里补全为当前页面 origin
function resolveHttpBase(raw: string): string {
  return /^https?:\/\//.test(raw) ? raw : new URL(raw, location.origin).href;
}

const API_URL = resolveHttpBase(import.meta.env.VITE_GOIM_API_URL || '/api/v1');
const WS_URL = import.meta.env.VITE_GOIM_WS_URL || '/ws';
const PLATFORM_ID = Number(import.meta.env.VITE_GOIM_PLATFORM_ID || '1');
const ADMIN_USER_ID = import.meta.env.VITE_GOIM_ADMIN_USER_ID || 'imAdmin';
const ADMIN_SECRET = import.meta.env.VITE_GOIM_ADMIN_SECRET || '';

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
  loginUserID: string;
  loginError: string;
  loggingIn: boolean;
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
  loginUserID: '',
  loginError: '',
  loggingIn: false,
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

// ———— 登录 ————

async function login(): Promise<void> {
  if (!client) return;

  const userID = state.loginUserID.trim();
  if (!userID) {
    state.loginError = '请输入 userID';
    return;
  }

  state.loginError = '';
  state.loggingIn = true;
  try {
    await client.login(userID);
    log('登录返回（WS 就绪），等待后台同步…');
    updateStatus();
    void refreshConversations();
  } catch (err) {
    state.loginError = errMsg(err);
    log(`登录失败：${errMsg(err)}`);
  } finally {
    state.loggingIn = false;
    updateStatus();
  }
}

async function logout(): Promise<void> {
  state.selected = undefined;
  state.messages = [];
  state.conversations = [];
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
        adminSecret: ADMIN_SECRET,
        adminUserID: ADMIN_USER_ID,
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
