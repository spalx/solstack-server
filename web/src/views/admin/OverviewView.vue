<script setup lang="ts">
import Message from 'primevue/message';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import PageHeader from '../../components/PageHeader.vue';
import type { Overview } from '../../types';

const overview = ref<Overview | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    overview.value = await api.get<Overview>('/admin/overview');
  } catch (failure) {
    error.value = errorMessage(failure);
  }
});
</script>

<template>
  <PageHeader title="Overview" />
  <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
  <div v-else-if="!overview" class="grid gap-4 sm:grid-cols-3">
    <Skeleton v-for="n in 3" :key="n" height="6rem" />
  </div>
  <template v-else>
    <div class="grid gap-4 sm:grid-cols-3">
      <RouterLink
        to="/admin/users"
        class="rounded-xl border border-surface-200 bg-surface-0 p-5 hover:border-primary dark:border-surface-800 dark:bg-surface-900"
      >
        <p class="text-muted-color text-sm">Users</p>
        <p class="mt-1 text-3xl font-semibold tabular-nums">{{ overview.users.total }}</p>
        <p v-if="overview.users.pendingInvites" class="text-muted-color mt-1 text-xs">
          {{ overview.users.pendingInvites }} invite{{ overview.users.pendingInvites === 1 ? '' : 's' }} pending
        </p>
      </RouterLink>
      <RouterLink
        to="/admin/repositories"
        class="rounded-xl border border-surface-200 bg-surface-0 p-5 hover:border-primary dark:border-surface-800 dark:bg-surface-900"
      >
        <p class="text-muted-color text-sm">Repositories</p>
        <p class="mt-1 text-3xl font-semibold tabular-nums">{{ overview.repositories }}</p>
      </RouterLink>
      <RouterLink
        to="/admin/activity"
        class="rounded-xl border border-surface-200 bg-surface-0 p-5 hover:border-primary dark:border-surface-800 dark:bg-surface-900"
      >
        <p class="text-muted-color text-sm">Tool calls (24h)</p>
        <p class="mt-1 text-3xl font-semibold tabular-nums">{{ overview.toolCallsLast24h.total }}</p>
        <p v-if="overview.toolCallsLast24h.failed" class="mt-1 text-xs text-red-600 dark:text-red-400">
          {{ overview.toolCallsLast24h.failed }} failed
        </p>
      </RouterLink>
    </div>

    <h2 class="mt-10 mb-3 font-semibold">Integrations</h2>
    <div class="divide-y divide-surface-200 rounded-xl border border-surface-200 bg-surface-0 dark:divide-surface-800 dark:border-surface-800 dark:bg-surface-900">
      <div v-for="integration in overview.integrations" :key="integration.id" class="flex items-center justify-between gap-4 p-4">
        <div>
          <p class="font-medium">{{ integration.name }}</p>
          <p class="text-muted-color text-sm">
            {{ integration.connectedUsers }} developer{{ integration.connectedUsers === 1 ? '' : 's' }} connected
          </p>
        </div>
        <Tag v-if="integration.enabled" severity="success" value="Enabled" />
        <RouterLink v-else to="/admin/integrations">
          <Tag severity="secondary" :value="integration.configured ? 'Disabled' : 'Not set up'" />
        </RouterLink>
      </div>
    </div>
  </template>
</template>
