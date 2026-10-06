<script setup lang="ts">
import ConfirmDialog from 'primevue/confirmdialog';
import Toast from 'primevue/toast';
import { useRoute } from 'vue-router';
import AppLayout from './components/AppLayout.vue';

const route = useRoute();
</script>

<template>
  <Toast position="top-right" />
  <ConfirmDialog />
  <RouterView v-if="route.meta.public" />
  <AppLayout v-else>
    <RouterView />
  </AppLayout>
</template>
