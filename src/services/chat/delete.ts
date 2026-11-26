// 消息删除编排：解析目标消息 seq → 调服务端删除（默认仅自己）→ 本地移除。
// 服务端会给自己推送 2102 通知，SDK 据此删除本地行；这里先做乐观移除，界面立即生效。

import type { MsgData } from '@goim/web-sdk';

import { deleteMessages } from '@/im/message';
import { useChatStore } from '@/stores/chat';

import { resolveMessageSeq } from './revoke';

export interface DeleteMessageOptions {
  // true = 对所有人删除（群管理员能力）；默认 false 仅自己不可见
  syncOther?: boolean;
}

export async function deleteChatMessage(
  msg: MsgData,
  options: DeleteMessageOptions = {},
): Promise<void> {
  const conversationID = msg.conversationID;
  if (!conversationID) throw new Error('消息缺少会话 ID');

  const seq = await resolveMessageSeq(conversationID, msg);
  await deleteMessages(conversationID, [seq], {
    syncSelf: true,
    syncOther: options.syncOther ?? false,
  });

  useChatStore().markDeleted(conversationID, [seq]);
}
