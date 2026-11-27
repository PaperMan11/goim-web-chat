// 资料缓存：按 userId 批量拉取公开资料（昵称、头像公开 URL），TTL 由调用方决定是否刷新。

import { ref } from 'vue';
import { defineStore } from 'pinia';

import { batchProfiles, getPublicProfile, type PublicProfileView } from '@/api/account/profile';

const BATCH_SIZE = 100;
const TTL = 10 * 60 * 1000;

export const useContactsStore = defineStore('contacts', () => {
  const profiles = ref<Record<string, PublicProfileView>>({});
  const loading = ref(false);

  let requested = new Set<string>();
  let fetchedAt = 0;

  async function ensureProfiles(userIds: string[]): Promise<void> {
    const now = Date.now();
    if (now - fetchedAt > TTL) requested = new Set();
    const missing = userIds.filter(
      (id) => id && !profiles.value[id] && !requested.has(id),
    );
    if (!missing.length) return;

    missing.forEach((id) => requested.add(id));
    loading.value = true;
    try {
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const chunk = missing.slice(i, i + BATCH_SIZE);
        const list = await batchProfiles(chunk);
        for (const profile of list) {
          profiles.value[profile.userId] = profile;
        }
      }
      fetchedAt = Date.now();
    } catch {
      // 失败允许下次重试
      missing.forEach((id) => requested.delete(id));
    } finally {
      loading.value = false;
    }
  }

  // 单人资料：优先用缓存，未命中走 GET /profile/users/{userId}（资料详情页使用）
  async function ensureProfile(userId: string): Promise<PublicProfileView | undefined> {
    if (!userId) return undefined;
    const cached = profiles.value[userId];
    if (cached) return cached;
    loading.value = true;
    try {
      const profile = await getPublicProfile(userId);
      profiles.value = { ...profiles.value, [userId]: profile };
      return profile;
    } catch {
      return undefined;
    } finally {
      loading.value = false;
    }
  }

  function nicknameOf(userId?: string, fallback?: string): string {
    if (!userId) return fallback || '未知用户';
    return profiles.value[userId]?.nickname || fallback || userId;
  }

  function avatarOf(userId?: string): string {
    return (userId ? profiles.value[userId]?.avatarUrl : '') || '';
  }

  function reset(): void {
    profiles.value = {};
    requested = new Set();
    fetchedAt = 0;
  }

  return {
    profiles,
    loading,
    ensureProfiles,
    ensureProfile,
    nicknameOf,
    avatarOf,
    reset,
  };
});
