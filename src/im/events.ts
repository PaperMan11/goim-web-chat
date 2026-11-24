// SDK 事件到业务事件的映射：UI/store 只订阅业务事件，不直接解析 SDK 载荷。

import {
  EventType,
  SyncState,
  TransportStatus,
  type GoimEvent,
  type MsgData,
  type SendMsgResp,
  type SyncStateValue,
  type TransportStatusValue,
} from '@goim/web-sdk';

export interface IMEventSnapshot {
  transport: TransportStatusValue;
  sync: SyncStateValue;
}

export type IMBusinessEvent =
  | { type: 'transport'; status: TransportStatusValue }
  | { type: 'sync'; state: SyncStateValue; error?: unknown }
  | { type: 'message'; messages: MsgData[] }
  | { type: 'message-sent'; resp: SendMsgResp }
  | { type: 'message-revoked'; payload: unknown }
  | { type: 'read'; payload: unknown }
  | { type: 'conversation'; payload: unknown }
  | { type: 'conversations-synced' }
  | { type: 'conversation-deleted'; payload: unknown }
  | { type: 'session-expired'; reason: string }
  | { type: 'token-refreshed' }
  | { type: 'token-refresh-failed'; error?: unknown }
  | { type: 'login'; ok: boolean; error?: unknown }
  | { type: 'raw'; event: GoimEvent };

// NewMsg 载荷在不同事件源下可能是数组、{ msgs } 或单条消息
function extractMessages(payload: unknown): MsgData[] {
  if (Array.isArray(payload)) return payload as MsgData[];
  const envelope = payload as { msgs?: MsgData[]; msg?: MsgData } | undefined;
  if (envelope?.msgs?.length) return envelope.msgs;
  if (envelope?.msg) return [envelope.msg];
  if (payload && typeof payload === 'object' && 'contentType' in payload) {
    return [payload as MsgData];
  }
  return [];
}

export function translateEvent(
  event: GoimEvent,
  snapshot: IMEventSnapshot,
): IMBusinessEvent[] {
  switch (event.type) {
    case EventType.Connect:
      return [{ type: 'transport', status: snapshot.transport }];
    case EventType.Connecting:
    case EventType.Reconnect:
      return [{ type: 'transport', status: TransportStatus.Connecting }];
    case EventType.Disconnect:
      return [{ type: 'transport', status: TransportStatus.Disconnected }];
    case EventType.SyncStart:
      return [{ type: 'sync', state: SyncState.Syncing }];
    case EventType.SyncFinish:
      return [{ type: 'sync', state: SyncState.Synced }];
    case EventType.SyncFailed:
      return [{ type: 'sync', state: SyncState.Failed, error: event.payload }];
    case EventType.NewMsg: {
      const messages = extractMessages(event.payload);
      return messages.length
        ? [{ type: 'message', messages }]
        : [{ type: 'raw', event }];
    }
    case EventType.MsgSent:
      return [{ type: 'message-sent', resp: event.payload as SendMsgResp }];
    case EventType.RevokeMsg:
    case EventType.MsgRevoked:
      return [{ type: 'message-revoked', payload: event.payload }];
    case EventType.MarkAsRead:
      return [{ type: 'read', payload: event.payload }];
    case EventType.ConversationUpdate:
    case EventType.ConversationCreated:
      return [{ type: 'conversation', payload: event.payload }];
    case EventType.ConversationSynced:
      return [{ type: 'conversations-synced' }];
    case EventType.ConversationDelete:
      return [{ type: 'conversation-deleted', payload: event.payload }];
    case EventType.ForceLogout:
      return [{ type: 'session-expired', reason: 'ForceLogout' }];
    case EventType.TokenRefreshed:
      return [{ type: 'token-refreshed' }];
    case EventType.TokenRefreshFailed:
      return [{ type: 'token-refresh-failed', error: event.payload }];
    case EventType.LoginSuccess:
      return [{ type: 'login', ok: true }];
    case EventType.LoginFailed:
      return [{ type: 'login', ok: false, error: event.payload }];
    default:
      return [{ type: 'raw', event }];
  }
}
