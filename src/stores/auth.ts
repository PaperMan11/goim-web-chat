// 登录与 IM 生命周期状态：账号会话、资料、连接/同步状态。

import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  SyncState,
  TransportStatus,
  type SyncStateValue,
  type TransportStatusValue,
} from '@goim/web-sdk';

import { loadSession, type BusinessSession } from '@/api/client';
import type { ProfileView } from '@/api/account/profile';

export const AuthStage = {
  Anonymous: 'anonymous',
  BizAuthenticated: 'biz-authenticated',
  IMConnecting: 'im-connecting',
  IMReady: 'im-ready',
  Synced: 'synced',
} as const;

export type AuthStageValue = (typeof AuthStage)[keyof typeof AuthStage];

export const useAuthStore = defineStore('auth', () => {
  const stage = ref<AuthStageValue>(AuthStage.Anonymous);
  const session = ref<BusinessSession | undefined>(loadSession());
  const me = ref<ProfileView | undefined>();
  const transportStatus = ref<TransportStatusValue>(TransportStatus.Disconnected);
  const syncState = ref<SyncStateValue>(SyncState.None);
  const imError = ref('');
  const loading = ref(false);

  const userId = computed(() => session.value?.userId ?? '');
  const loginName = computed(() => session.value?.loginName ?? '');
  const displayName = computed(
    () => me.value?.nickname || loginName.value || userId.value,
  );
  const avatarUrl = computed(() => me.value?.avatarUrl ?? '');
  const isLoggedIn = computed(() => stage.value !== AuthStage.Anonymous);
  const isConnected = computed(() => transportStatus.value === TransportStatus.Connected);
  const isSynced = computed(() => syncState.value === SyncState.Synced);

  function setSession(value?: BusinessSession): void {
    session.value = value;
  }

  function reset(): void {
    stage.value = AuthStage.Anonymous;
    session.value = undefined;
    me.value = undefined;
    transportStatus.value = TransportStatus.Disconnected;
    syncState.value = SyncState.None;
    imError.value = '';
  }

  return {
    stage,
    session,
    me,
    transportStatus,
    syncState,
    imError,
    loading,
    userId,
    loginName,
    displayName,
    avatarUrl,
    isLoggedIn,
    isConnected,
    isSynced,
    setSession,
    reset,
  };
});
