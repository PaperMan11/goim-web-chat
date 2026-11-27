// 消息撤回编排：解析目标消息 seq（发送回包不含 seq，需回本地缓存补），
// 调 SDK 撤回，成功后把内存中的消息标记为已撤回。

import type { MsgData } from '@goim/web-sdk';

import { loadLocalMessages, revokeMessage } from '@/im/message';
import { useChatStore } from '@/stores/chat';

// 撤回时限：本人只能撤回 2 分钟内的消息（微信同款）；管理员代撤他人消息由服务端豁免
export const REVOKE_WINDOW_MS = 2 * 60 * 1000;

// 是否仍在可撤回窗口内；sendTime 缺失（历史数据）时按可撤处理，最终由服务端裁决
export function withinRevokeWindow(msg: MsgData, now = Date.now()): boolean {
  const sendTime = msg.sendTime ?? 0;
  return sendTime <= 0 || now - sendTime <= REVOKE_WINDOW_MS;
}

export async function resolveMessageSeq(
  conversationID: string,
  msg: MsgData,
): Promise<number> {
  if ((msg.seq ?? 0) > 0) return msg.seq as number;

  // 刚发送的消息还没经过同步，seq 需要从本地缓存按 clientMsgID / serverMsgID 反查
  const list = await loadLocalMessages(conversationID, 50);
  const hit = list.find(
    (item) =>
      (msg.clientMsgID && item.clientMsgID === msg.clientMsgID) ||
      (msg.serverMsgID && item.serverMsgID === msg.serverMsgID),
  );
  const seq = hit?.seq ?? 0;
  if (!seq) throw new Error('消息尚未同步，请稍后重试');
  return seq;
}

export async function revokeChatMessage(msg: MsgData): Promise<void> {
  const conversationID = msg.conversationID;
  if (!conversationID) throw new Error('消息缺少会话 ID');
  // 点击时再校验一次：组件渲染后可能已越过窗口，服务端也会做最终裁决
  if (!withinRevokeWindow(msg)) throw new Error('消息发送超过 2 分钟，无法撤回');

  const seq = await resolveMessageSeq(conversationID, msg);
  await revokeMessage(conversationID, seq);

  // 与接收方共用同一状态更新路径：标记消息并同步会话摘要
  useChatStore().markRevoked(conversationID, seq, msg.clientMsgID);
}
