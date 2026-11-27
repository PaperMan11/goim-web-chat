<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { SessionType } from '@goim/web-sdk';

import Avatar from '@/components/common/Avatar.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import { useAuthStore } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';
import { useContactsStore } from '@/stores/contacts';

const auth = useAuthStore();
const chat = useChatStore();
const contacts = useContactsStore();
const router = useRouter();

// P0 阶段联系人来自身会话：好友 = 单聊对端，群 = 群聊会话
const friends = computed(() =>
  chat.conversations.filter(
    (conv) =>
      conv.conversationType !== SessionType.Group &&
      conv.userID &&
      conv.userID !== auth.userId,
  ),
);

const groups = computed(() =>
  chat.conversations.filter((conv) => conv.conversationType === SessionType.Group),
);

function openConversation(conversationID?: string): void {
  if (!conversationID) return;
  void router.push({ name: 'chat-conversation', params: { conversationID } });
}

// 点头像进入用户资料详情（行本身仍然打开会话）
function openProfile(userID?: string): void {
  if (!userID) return;
  void router.push({ name: 'user-profile', params: { userId: userID } });
}

async function loadProfiles(): Promise<void> {
  const ids = friends.value
    .map((conv) => conv.userID)
    .filter((id): id is string => Boolean(id));
  if (ids.length) await contacts.ensureProfiles(ids);
}

onMounted(() => {
  void loadProfiles();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
    <main class="min-h-0 flex-1 overflow-y-auto p-4">
      <section class="mb-4">
        <h2 class="mb-2 text-xs font-medium text-slate-500">好友</h2>
        <EmptyState v-if="!friends.length" title="暂无好友" desc="发起单聊后会出现在这里" />
        <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
          <li
            v-for="conv in friends"
            :key="conv.conversationID"
            class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
            @click="openConversation(conv.conversationID)"
          >
            <Avatar
              size="sm"
              :src="contacts.avatarOf(conv.userID)"
              :name="contacts.nicknameOf(conv.userID)"
              class="cursor-pointer"
              @click.stop="openProfile(conv.userID)"
            />
            <div class="min-w-0">
              <button
                type="button"
                class="block max-w-full truncate text-sm text-slate-800 hover:text-blue-600"
                @click.stop="openProfile(conv.userID)"
              >
                {{ contacts.nicknameOf(conv.userID, conv.msgInfo?.senderName) }}
              </button>
              <p class="truncate text-xs text-slate-400">{{ conv.userID }}</p>
            </div>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="mb-2 text-xs font-medium text-slate-500">群聊</h2>
        <EmptyState v-if="!groups.length" title="暂无群聊" desc="加入群聊后会出现在这里" />
        <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
          <li
            v-for="conv in groups"
            :key="conv.conversationID"
            class="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-slate-50"
            @click="openConversation(conv.conversationID)"
          >
            <Avatar
              :src="conv.msgInfo?.groupFaceURL"
              :name="conv.msgInfo?.groupName || conv.groupID"
            />
            <div class="min-w-0">
              <p class="truncate text-sm text-slate-800">
                {{ conv.msgInfo?.groupName || conv.groupID }}
              </p>
              <p class="truncate text-xs text-slate-400">{{ conv.groupID }}</p>
            </div>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>
