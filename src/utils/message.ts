// 消息展示文案：content 是 JSON 字符串（见 sdk-js protocol 层），UI 统一经这里解析。

import {
  ContentType,
  parseFileContent,
  parseQuoteContent,
  parseTextContent,
  type MsgData,
} from '@goim/web-sdk';

type MessageLike = Pick<MsgData, 'contentType' | 'content'>;

// 单条消息的纯文本展示（图片/文件等返回占位文案）
export function messageText(msg?: MessageLike): string {
  // 撤回后 SDK 会把摘要 content 清空、contentType 改写为 111 Revoke，
  // 必须先按类型判定，不能依赖 content 非空（否则会话列表摘要显示为空）
  if (
    msg?.contentType === ContentType.Revoke ||
    msg?.contentType === ContentType.MsgRevokeNotification
  ) {
    return '[已撤回]';
  }
  const content = msg?.content;
  if (!content) return '';
  switch (msg?.contentType) {
    case ContentType.Text:
    case ContentType.AtText:
    case ContentType.AdvancedText:
    case ContentType.MarkdownText:
      return parseTextContent(content)?.text ?? content;
    case ContentType.Quote:
      return parseQuoteContent(content)?.text ?? content;
    case ContentType.Picture:
    case ContentType.Voice:
    case ContentType.Video:
    case ContentType.File:
    case ContentType.Location:
    case ContentType.Card:
    case ContentType.Merger:
      return messagePlaceholder(msg!.contentType, content);
    default:
      return content;
  }
}

function messagePlaceholder(contentType: number, content: string): string {
  switch (contentType) {
    case ContentType.Picture:
      return '[图片]';
    case ContentType.Voice:
      return '[语音]';
    case ContentType.Video:
      return '[视频]';
    case ContentType.File: {
      const file = parseFileContent(content);
      return file?.fileName ? `[文件] ${file.fileName}` : '[文件]';
    }
    case ContentType.Location:
      return '[位置]';
    case ContentType.Card:
      return '[名片]';
    case ContentType.Merger:
      return '[聊天记录]';
    default:
      return content;
  }
}

// 会话列表预览：截断到 max 个字符
export function messagePreview(msg: MessageLike | undefined, max = 30): string {
  const text = messageText(msg);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ———— 消息合并 ————

// undefined 不覆盖已有字段（避免回包只有部分字段时把内容清空）
function assignDefined(target: MsgData, source: MsgData): void {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
}

function compareMessages(a: MsgData, b: MsgData): number {
  const aSeq = a.seq ?? 0;
  const bSeq = b.seq ?? 0;
  // 无 seq 的是本地乐观消息（发送回包不含 seq），必然最新，排在末尾；
  // 若按 seq=0 比较会被排到最前面，导致"发出去了却看不到"
  if (!aSeq || !bSeq) {
    if (!aSeq && !bSeq) return (a.sendTime ?? 0) - (b.sendTime ?? 0);
    return aSeq ? -1 : 1;
  }
  return aSeq - bSeq;
}

// 按 serverMsgID / clientMsgID 去重合并，返回排序后的新数组（不修改入参）
// 后到的字段覆盖先到的，但 undefined 不覆盖
export function mergeMessages(existing: MsgData[], incoming: MsgData[]): MsgData[] {
  const merged: MsgData[] = existing.map((msg) => ({ ...msg }));
  const byServer = new Map<string, MsgData>();
  const byClient = new Map<string, MsgData>();

  const index = (msg: MsgData): void => {
    if (msg.serverMsgID) byServer.set(msg.serverMsgID, msg);
    if (msg.clientMsgID) byClient.set(msg.clientMsgID, msg);
  };

  for (const msg of merged) index(msg);

  for (const msg of incoming) {
    const found =
      (msg.serverMsgID ? byServer.get(msg.serverMsgID) : undefined) ??
      (msg.clientMsgID ? byClient.get(msg.clientMsgID) : undefined);
    if (found) {
      assignDefined(found, msg);
      index(found);
      continue;
    }
    const copy = { ...msg };
    merged.push(copy);
    index(copy);
  }

  return merged.sort(compareMessages);
}
