<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import PageHeader from '../components/PageHeader.vue';
import { formatRelative } from '../format';
import type { ConnectionStatus, DeveloperRepository } from '../types';

const ICONS: Record<string, string> = { github: 'pi pi-github', trello: 'pi pi-objects-column' };

const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirm();

const connections = ref<ConnectionStatus[] | null>(null);
const repositories = ref<DeveloperRepository[]>([]);
const loadError = ref('');

const names = computed(() => new Map((connections.value ?? []).map((c) => [c.id, c.name])));
const reposNeedingAction = computed(() => repositories.value.filter((r) => r.missingIntegrations.length > 0));

async function load() {
  try {
    const [c, r] = await Promise.all([
      api.get<{ connections: ConnectionStatus[] }>('/me/connections'),
      api.get<{ repositories: DeveloperRepository[] }>('/me/repositories'),
    ]);
    connections.value = c.connections;
    repositories.value = r.repositories;
  } catch (failure) {
    loadError.value = errorMessage(failure);
  }
}

onMounted(async () => {
  // Results of an authorization round-trip come back as query parameters.
  const { connected, error } = route.query;
  if (connected || error) await router.replace({ query: {} });
  await load();
  if (typeof connected === 'string') {
    const name = names.value.get(connected) ?? connected;
    toast.add({ severity: 'success', summary: 'Connected', detail: `${name} is now connected.`, life: 4000 });
  }
  if (typeof error === 'string') {
    toast.add({ severity: 'error', summary: 'Could not connect', detail: error, life: 8000 });
  }
});

function connect(id: string) {
  // Full-page navigation: the server redirects to the provider's authorization page.
  window.location.assign(`/api/connect/${encodeURIComponent(id)}/start`);
}

function disconnect(connection: ConnectionStatus) {
  confirm.require({
    header: `Disconnect ${connection.name}?`,
    message: `Your agents will lose access to ${connection.name} until you connect again.`,
    acceptProps: { label: 'Disconnect', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/me/connections/${connection.id}`);
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Disconnect failed', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}
</script>

<template>
  <PageHeader
    title="Connections"
    description="Authorize the integrations your agents use. Each connection acts as you, with your own permissions."
  />

  <Message v-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>

  <div v-else-if="!connections" class="grid gap-4 md:grid-cols-2">
    <Skeleton v-for="n in 2" :key="n" height="9rem" />
  </div>

  <template v-else>
    <Message v-if="connections.length === 0" severity="info" :closable="false">
      No integrations are enabled on this server yet. An admin can enable them under Administration → Integrations.
    </Message>

    <Message v-for="repo in reposNeedingAction" :key="repo.id" severity="warn" :closable="false" class="mb-4">
      <strong>{{ repo.name }}</strong> requires
      {{ repo.missingIntegrations.map((id) => names.get(id) ?? id).join(' and ') }}.
    </Message>

    <div class="grid gap-4 md:grid-cols-2">
      <div
        v-for="connection in connections"
        :key="connection.id"
        class="flex flex-col rounded-xl border border-surface-200 bg-surface-0 p-5 dark:border-surface-800 dark:bg-surface-900"
      >
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <i :class="ICONS[connection.id] ?? 'pi pi-link'" class="text-2xl" />
            <h2 class="font-semibold">{{ connection.name }}</h2>
          </div>
          <Tag v-if="connection.connected" severity="success" value="Connected" class="shrink-0 whitespace-nowrap" />
          <Tag
            v-else-if="connection.status === 'invalid'"
            severity="warn"
            value="Reconnect needed"
            class="shrink-0 whitespace-nowrap"
          />
          <Tag v-else severity="secondary" value="Not connected" class="shrink-0 whitespace-nowrap" />
        </div>
        <p class="text-muted-color mt-2 text-sm">{{ connection.description }}</p>

        <p v-if="connection.accountName" class="text-muted-color mt-4 text-sm">
          Signed in as <span class="text-color font-medium">{{ connection.accountName }}</span>
          · {{ formatRelative(connection.connectedAt) }}
        </p>

        <div class="mt-5 flex gap-2 pt-1 md:mt-auto">
          <Button
            v-if="!connection.connected"
            :label="connection.status === 'invalid' ? 'Reconnect' : 'Connect'"
            icon="pi pi-external-link"
            @click="connect(connection.id)"
          />
          <template v-else>
            <Button label="Reconnect" severity="secondary" outlined @click="connect(connection.id)" />
            <Button label="Disconnect" severity="danger" text @click="disconnect(connection)" />
          </template>
        </div>
      </div>
    </div>
  </template>
</template>
