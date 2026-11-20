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
    case ContentType.Revoke:
      return '[已撤回]';
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
