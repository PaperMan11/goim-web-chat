// 资料编排：读取 / 保存本人资料、上传头像。
// 头像走 purpose=avatar 上传（≤5MB，公开资源），完成后把 objectKey 写回 profile.avatarKey。

import {
  getMyProfile,
  updateMyProfile,
  type ProfileView,
  type UpdateProfileInput,
} from '@/api/account/profile';
import { uploadAttachment } from '@/services/chat/upload';
import { useAuthStore } from '@/stores/auth';
import { validateAttachment } from '@/utils/file';

// 拉取本人资料并写入 auth.me（登录后与资料页刷新共用）
export async function loadMyProfile(): Promise<ProfileView> {
  const auth = useAuthStore();
  const view = await getMyProfile();
  auth.me = view;
  return view;
}

// 保存资料；返回并写入最新 ProfileView（avatarUrl 由服务端生成）
export async function saveMyProfile(input: UpdateProfileInput): Promise<ProfileView> {
  const auth = useAuthStore();
  const view = await updateMyProfile(input);
  auth.me = view;
  return view;
}

export interface AvatarProgress {
  bytes: number;
  total: number;
}

// 上传头像：校验 → presign(avatar) → PUT → complete → 更新 profile.avatarKey
export async function uploadAvatar(
  file: File,
  onProgress?: (progress: AvatarProgress) => void,
): Promise<ProfileView> {
  const err = validateAttachment('avatar', {
    mime: file.type || 'application/octet-stream',
    size: file.size,
  });
  if (err) throw new Error(err);

  const upload = await uploadAttachment(file, {
    purpose: 'avatar',
    onProgress: (bytes, total) => onProgress?.({ bytes, total }),
  });
  return saveMyProfile({ avatarKey: upload.objectKey });
}
