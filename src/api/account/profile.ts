// 用户资料接口，与 goim-business internal/handler/account/profile.go 一一对应。

import { request } from '../http';

// 本人完整资料（types.ProfileView）
export interface ProfileView {
  userId: string;
  loginName: string;
  nickname: string;
  avatarKey: string;
  avatarUrl: string;
  bio: string;
}

// 他人可见的公开资料（types.PublicProfileView），不含登录名与签名
export interface PublicProfileView {
  userId: string;
  nickname: string;
  avatarKey: string;
  avatarUrl: string;
}

// 字段缺省表示不修改；avatarKey 传空字符串表示清空头像
export interface UpdateProfileInput {
  nickname?: string;
  avatarKey?: string;
  bio?: string;
}

// GET /profile/me
export async function getMyProfile(): Promise<ProfileView> {
  return request<ProfileView>('/profile/me', { method: 'GET' });
}

// PUT /profile/me
export async function updateMyProfile(input: UpdateProfileInput): Promise<ProfileView> {
  return request<ProfileView>('/profile/me', { method: 'PUT', data: input });
}

// POST /profile/batch；单次最多 100 个 userId，不存在的用户由服务端跳过（调用方负责分批）
export async function batchProfiles(userIds: string[]): Promise<PublicProfileView[]> {
  return request<PublicProfileView[]>('/profile/batch', {
    method: 'POST',
    data: { userIds },
  });
}

// GET /profile/users/{userId}
export async function getPublicProfile(userId: string): Promise<PublicProfileView> {
  return request<PublicProfileView>(
    `/profile/users/${encodeURIComponent(userId)}`,
    { method: 'GET' },
  );
}
