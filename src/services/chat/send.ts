// 消息发送编排：构造乐观消息、调用 SDK、失败置为 Failed。

import {
  ContentType,
  MsgFrom,
  MsgStatus,
  SessionType,
  buildTextContent,
  type Conversation,
  type MsgData,
} from '@goim/web-sdk';

import { sendText } from '@/im/message';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { messageText } from '@/utils/message';

export interface MessageTarget {
  sessionType: number;
  userID?: string;
  groupID?: string;
}

function newClientMsgID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function targetOfConversation(conv: Conversation): MessageTarget | undefined {
  const inferred =
    conv.conversationType ?? (conv.groupID ? SessionType.Group : SessionType.C2C);
  if (inferred === SessionType.Group) {
    return conv.groupID ? { sessionType: inferred, groupID: conv.groupID } : undefined;
  }
  return conv.userID ? { sessionType: inferred, userID: conv.userID } : undefined;
}

export async function sendTextMessage(conv: Conversation, text: string): Promise<void> {
  const auth = useAuthStore();
  const chat = useChatStore();
  const conversationID = conv.conversationID;
  const target = targetOfConversation(conv);
  if (!conversationID || !target) throw new Error('会话缺少发送目标');

  const clientMsgID = newClientMsgID();
  const now = Date.now();
  const optimistic: MsgData = {
    clientMsgID,
    sendID: auth.userId,
    senderNickname: auth.displayName,
    sessionType: target.sessionType,
    msgFrom: MsgFrom.User,
    contentType: ContentType.Text,
    // SDK 文本消息 content 为 JSON（{"text":..}），乐观消息保持一致，避免合并后展示差异
    content: buildTextContent(text),
    createTime: now,
    sendTime: now,
    status: MsgStatus.Sending,
    conversationID,
    recvID: target.userID ?? target.groupID,
    groupID: target.groupID,
  };

  chat.upsertMessages([optimistic]);

  try {
    const resp = await sendText(target, text, clientMsgID);
    chat.upsertMessages([
      {
        clientMsgID,
        serverMsgID: resp.serverMsgID,
        sendTime: resp.sendTime,
        status: MsgStatus.SendSuccess,
        conversationID,
      },
    ]);
  } catch (err) {
    chat.upsertMessages([{ clientMsgID, status: MsgStatus.SendFailed, conversationID }]);
    throw err;
  }
}

// 失败消息重试：复用原 clientMsgID，避免服务端重复入库
export async function retryMessage(msg: MsgData): Promise<void> {
  const conv = useChatStore().conversations.find(
    (item) => item.conversationID === msg.conversationID,
  );
  if (!conv || !msg.content) throw new Error('会话已不存在，无法重试');
  await sendTextMessage(conv, messageText(msg));
}
