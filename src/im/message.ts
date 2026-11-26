// 消息能力封装：发送、乐观消息构造、本地/服务端历史、已读与撤回。

import {
  ContentType,
  MsgFrom,
  MsgStatus,
  SessionType,
  type MsgData,
  type SendMsgResp,
  type SendTarget,
} from '@goim/web-sdk';

import { requireIM } from './client';

// 图片消息 content（JSON 字符串写入 MsgData.content）
// 协议 PictureContent 结构：{ origPictureElem: { url, width, height, fileSize, type } }
// 扩展字段 fileId / objectKey 由前端自行加，服务端透传；展示时优先用 fileId 现换 URL
export interface ImageMessageContent {
  fileId: string;
  objectKey: string;
  origPictureElem: {
    url?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    type?: string;
  };
}

// 文件消息 content（ContentType.File 105）
// 协议 FileContent：{ filePath, fileName, fileSize, baseInfo }
// 同样额外带 fileId / objectKey（服务端透传，展示时现换 URL）
export interface FileMessageContent {
  fileId: string;
  objectKey: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  mime?: string;
  baseInfo?: {
    description?: string;
  };
}

export function sendText(
  target: SendTarget,
  text: string,
  clientMsgID?: string,
): Promise<SendMsgResp> {
  return requireIM().messages.sendText(target, text, { clientMsgID });
}

// 发送现成 MsgData（图片/文件等自定义消息由调用方构造）
export function sendMessage(msg: MsgData): Promise<SendMsgResp> {
  return requireIM().messages.send(msg);
}

// 本地缓存历史：走 Local.ListMsgs，取最新 limit 条（seq 降序，需先等待 EventSyncFinish）
export async function loadLocalMessages(
  conversationID: string,
  limit = 100,
): Promise<MsgData[]> {
  const page = await requireIM().local.listMsgs(conversationID, 0, limit);
  return page.items;
}

export interface PullHistoryOptions {
  // 拉更早的消息：seq 小于该值
  beforeSeq?: number;
  // 拉更新的消息：seq 大于该值
  afterSeq?: number;
  pageSize?: number;
}

// 服务端历史分页（sdk-core 已实现，js 走 pullBySeq 按 seq 区间拉取）
// 返回顺序由 order 决定：向前翻页为降序，调用方用 mergeMessages 统一排序
export async function pullHistory(
  conversationID: string,
  options: PullHistoryOptions = {},
): Promise<MsgData[]> {
  const pageSize = options.pageSize ?? 20;
  const instance = requireIM();

  if (options.beforeSeq !== undefined) {
    return instance.messages.pullBySeq(
      conversationID,
      0,
      Math.max(0, options.beforeSeq - 1),
      pageSize,
      1,
    );
  }
  if (options.afterSeq !== undefined) {
    return instance.messages.pullBySeq(
      conversationID,
      options.afterSeq + 1,
      Number.MAX_SAFE_INTEGER,
      pageSize,
      0,
    );
  }
  // 默认拉最新一页
  return instance.messages.pullBySeq(
    conversationID,
    0,
    Number.MAX_SAFE_INTEGER,
    pageSize,
    1,
  );
}

export function markConversationRead(
  conversationID: string,
  hasReadSeq: number,
  seqs: number[] = [],
): Promise<void> {
  return requireIM().messages.markRead(conversationID, hasReadSeq, seqs);
}

export function revokeMessage(conversationID: string, seq: number): Promise<void> {
  return requireIM().messages.revoke(conversationID, seq);
}

// 删除消息：默认仅自己不可见；syncOther=true 为「对所有人删除」（群管理员）
export function deleteMessages(
  conversationID: string,
  seqs: number[],
  opt: { syncSelf?: boolean; syncOther?: boolean } = {},
): Promise<void> {
  return requireIM().messages.delete(conversationID, seqs, {
    isSyncSelf: opt.syncSelf ?? true,
    isSyncOther: opt.syncOther ?? false,
  });
}

// ———— 构造乐观消息 ————

function newClientMsgID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function applyTarget(msg: MsgData, target: SendTarget): void {
  msg.sessionType = target.sessionType;
  if (target.sessionType === SessionType.Group) {
    if (!target.groupID) throw new Error('群聊消息必须提供 groupID');
    msg.groupID = target.groupID;
    msg.recvID = target.groupID;
  } else {
    if (!target.userID) throw new Error('单聊消息必须提供 userID');
    msg.recvID = target.userID;
  }
}

// 构造图片消息（content 为 ImageMessageContent 的 JSON 字符串，遵循 PictureContent 协议结构）
export function buildImageMessage(
  target: SendTarget,
  image: ImageMessageContent,
  opts: { clientMsgID?: string } = {},
): MsgData {
  const instance = requireIM();
  const now = Date.now();
  const msg: MsgData = {
    clientMsgID: opts.clientMsgID ?? newClientMsgID(),
    sendID: instance.requireUserID(),
    senderPlatformID: instance.platformID,
    msgFrom: MsgFrom.User,
    contentType: ContentType.Picture,
    content: JSON.stringify(image),
    createTime: now,
    sendTime: now,
    status: MsgStatus.Sending,
  };
  applyTarget(msg, target);
  return msg;
}

// 构造文件消息（content 为 FileMessageContent 的 JSON 字符串，遵循 FileContent 协议结构）
export function buildFileMessage(
  target: SendTarget,
  file: FileMessageContent,
  opts: { clientMsgID?: string } = {},
): MsgData {
  const instance = requireIM();
  const now = Date.now();
  const msg: MsgData = {
    clientMsgID: opts.clientMsgID ?? newClientMsgID(),
    sendID: instance.requireUserID(),
    senderPlatformID: instance.platformID,
    msgFrom: MsgFrom.User,
    contentType: ContentType.File,
    content: JSON.stringify(file),
    createTime: now,
    sendTime: now,
    status: MsgStatus.Sending,
  };
  applyTarget(msg, target);
  return msg;
}

// 解析图片消息 content（兼容新老结构，老结构里 fileId/objectKey 在顶层）
export function parseImageContent(raw?: string): ImageMessageContent | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // 新结构
    if (typeof parsed.fileId === 'string') {
      return parsed as unknown as ImageMessageContent;
    }
    // 老结构（顶层 mime/size/width/height，无 origPictureElem）
    return {
      fileId: (parsed.fileId as string) ?? '',
      objectKey: (parsed.objectKey as string) ?? '',
      origPictureElem: {
        fileSize: parsed.size as number | undefined,
        type: parsed.mime as string | undefined,
        width: parsed.width as number | undefined,
        height: parsed.height as number | undefined,
      },
    };
  } catch {
    return undefined;
  }
}

// 解析文件消息 content（FileContent 协议）
export function parseFileContent(raw?: string): FileMessageContent | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as FileMessageContent;
  } catch {
    return undefined;
  }
}

// 合并逻辑见 @/utils/message 的 mergeMessages（纯数据处理，不依赖 SDK 实例）
