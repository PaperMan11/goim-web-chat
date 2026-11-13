<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import LoginBar from './components/LoginBar.vue';
import ConversationList from './components/ConversationList.vue';
import MessagePanel from './components/MessagePanel.vue';
import EventLog from './components/EventLog.vue';
import { useGoim } from './composables/useGoim';

const { boot } = useGoim();

onMounted(() => {
  void boot();
});
</script>

<template>
  <AppHeader />
  <LoginBar />
  <main>
    <ConversationList />
    <MessagePanel />
  </main>
  <EventLog />
</template>
