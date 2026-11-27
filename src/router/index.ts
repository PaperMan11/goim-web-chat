// 路由结构：/login 独立；登录后的页面统一由 ChatLayout 提供外壳

import { createRouter, createWebHistory } from 'vue-router';

import { loadSession } from '@/api/client';
import ChatLayout from '@/layouts/ChatLayout.vue';
import ChatView from '@/views/chat/ChatView.vue';
import ContactsView from '@/views/contacts/ContactsView.vue';
import LoginView from '@/views/login/LoginView.vue';
import UserProfileView from '@/views/profile/UserProfileView.vue';
import DevicesView from '@/views/settings/DevicesView.vue';
import PasswordView from '@/views/settings/PasswordView.vue';
import SessionsView from '@/views/settings/SessionsView.vue';
import SettingsView from '@/views/settings/SettingsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    {
      path: '/',
      component: ChatLayout,
      children: [
        { path: '', redirect: '/chat' },
        { path: 'chat', name: 'chat', component: ChatView },
        { path: 'chat/:conversationID', name: 'chat-conversation', component: ChatView },
        { path: 'contacts', name: 'contacts', component: ContactsView },
        { path: 'settings', name: 'settings', component: SettingsView },
        { path: 'settings/sessions', name: 'settings-sessions', component: SessionsView },
        { path: 'settings/devices', name: 'settings-devices', component: DevicesView },
        { path: 'settings/password', name: 'settings-password', component: PasswordView },
        { path: 'users/:userId', name: 'user-profile', component: UserProfileView },
      ],
    },
  ],
});

// 无业务会话一律回登录页；已登录用户访问 /login 直接进聊天
router.beforeEach((to) => {
  const loggedIn = Boolean(loadSession()?.accessToken);
  if (to.name !== 'login' && !loggedIn) return { name: 'login' };
  if (to.name === 'login' && loggedIn) return { name: 'chat' };
  return true;
});

export default router;
