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

import { buildFileMessage, buildImageMessage, parseFileContent, parseImageContent, sendMessage } from '@/im/message';
import { uploadAttachment, type UploadResult } from '@/services/chat/upload';
import { sendText } from '@/im/message';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { isImageMime, validateAttachment } from '@/utils/file';
import { MAX_TEXT_MESSAGE_LENGTH, messageText } from '@/utils/message';

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
  // 输入框已限制 maxlength，这里兜住其它入口（脚本、粘贴、草稿恢复）
  if (text.length > MAX_TEXT_MESSAGE_LENGTH) {
    throw new Error(`单条消息最多 ${MAX_TEXT_MESSAGE_LENGTH} 字`);
  }
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

// ———— 附件消息（图片 / 文件）——

export interface AttachmentProgress {
  bytes: number;
  total: number;
}

export interface SendAttachmentOptions {
  onProgress?: (progress: AttachmentProgress) => void;
}

export async function sendAttachment(
  conv: Conversation,
  file: File,
  options: SendAttachmentOptions = {},
): Promise<void> {
  const chat = useChatStore();
  const conversationID = conv.conversationID;
  const target = targetOfConversation(conv);
  if (!conversationID || !target) throw new Error('会话缺少发送目标');

  // 1) 按文件类型自动选 purpose：图片 → chat_image，其他 → chat_file
  const isImage = isImageMime(file.type);
  const purpose = isImage ? 'chat_image' : 'chat_file';

  // 2) 校验（purpose 感知的 MIME / 大小白名单）
  const err = validateAttachment(purpose, { mime: file.type || 'application/octet-stream', size: file.size });
  if (err) throw new Error(err);

  // 3) 上传（带进度 + conversationId，后端会校验会话成员）
  const upload: UploadResult = await uploadAttachment(file, {
    purpose,
    conversationId: purpose === 'chat_image' || purpose === 'chat_file' ? conversationID : undefined,
    onProgress: (bytes, total) => options.onProgress?.({ bytes, total }),
  });

  // 4) 构造乐观消息
  const optimistic = await (async () => {
    if (isImage) {
      // 聊天图片：ContentType.Picture (102)
      const { width, height } = await tryReadImageSize(file).catch(() => ({ width: undefined, height: undefined }));
      return buildImageMessage(target, {
        fileId: upload.fileId,
        objectKey: upload.objectKey,
        origPictureElem: {
          fileSize: upload.size,
          type: upload.mime,
          width,
          height,
        },
      });
    }
    // 聊天文件：ContentType.File (105)
    return buildFileMessage(target, {
      fileId: upload.fileId,
      objectKey: upload.objectKey,
      fileName: file.name,
      fileSize: upload.size,
      mime: upload.mime,
    });
  })();
  optimistic.conversationID = conversationID;
  optimistic.recvID = target.userID ?? target.groupID;
  optimistic.groupID = target.groupID;
  optimistic.sendID = useAuthStore().userId;

  // 5) 乐观插入 → send → 回包 / 失败
  chat.upsertMessages([optimistic]);

  try {
    const resp = await sendMessage(optimistic);
    chat.upsertMessages([
      {
        clientMsgID: optimistic.clientMsgID,
        serverMsgID: resp.serverMsgID,
        sendTime: resp.sendTime,
        status: MsgStatus.SendSuccess,
        conversationID,
      },
    ]);
  } catch (err) {
    chat.upsertMessages([
      { clientMsgID: optimistic.clientMsgID, status: MsgStatus.SendFailed, conversationID },
    ]);
    throw err;
  }
}

// 从 File 读取图片天然宽高（FileReader → Image.onload）
function tryReadImageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
