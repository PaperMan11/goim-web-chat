<script setup lang="ts">
import { SessionType } from '@goim/web-sdk';
import { useGoim } from '../composables/useGoim';

const { state, refreshConversations, selectConversation, conversationTitle } = useGoim();
</script>

<template>
  <aside class="conv-panel">
    <div class="panel-title">
      <span>会话列表</span>
      <button class="secondary small" @click="() => refreshConversations()">刷新</button>
    </div>
    <ul id="conv-list">
      <li v-if="!state.conversations.length" class="conv">
        {{ state.userID ? '暂无会话（等待同步完成）' : '登录后加载会话' }}
      </li>
      <li
        v-for="(conv, index) in state.conversations"
        :key="conv.conversationID ?? index"
        class="conv"
        :class="{ active: conv.conversationID === state.selected?.conversationID }"
        @click="() => selectConversation(conv)"
      >
        <div class="conv-title">{{ conversationTitle(conv) }}</div>
        <div class="conv-sub">{{ conv.msgInfo?.content || (conv.conversationID ?? '') }}</div>
      </li>
    </ul>
    <div class="target-box">
      <div class="panel-title"><span>发送目标</span></div>
      <select v-model.number="state.targetType">
        <option :value="SessionType.C2C">单聊</option>
        <option :value="SessionType.Group">群聊</option>
      </select>
      <input v-model="state.targetID" placeholder="userID / groupID" autocomplete="off" />
    </div>
  </aside>
</template>
