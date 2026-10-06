<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import { useToast } from 'primevue/usetoast';
import { onMounted, ref } from 'vue';
import { api, errorMessage } from '../../api';
import PageHeader from '../../components/PageHeader.vue';
import { formatDateTime } from '../../format';
import type { ToolCall } from '../../types';

const toast = useToast();
const calls = ref<ToolCall[]>([]);
const loading = ref(true);

async function load() {
  loading.value = true;
  try {
    calls.value = (await api.get<{ calls: ToolCall[] }>('/admin/activity?limit=200')).calls;
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not load activity', detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <PageHeader
    title="Activity"
    description="The latest tool calls made through the gateway. Arguments and results are not stored."
  >
    <Button label="Refresh" icon="pi pi-refresh" severity="secondary" outlined :loading="loading" @click="load" />
  </PageHeader>

  <DataTable :value="calls" :loading="loading" data-key="id" size="small" paginator :rows="25">
    <template #empty>No tool calls yet.</template>
    <Column header="When">
      <template #body="{ data }">{{ formatDateTime(data.createdAt) }}</template>
    </Column>
    <Column header="User">
      <template #body="{ data }">{{ data.userEmail ?? 'Deleted user' }}</template>
    </Column>
    <Column header="Tool">
      <template #body="{ data }"><code class="text-sm">{{ data.tool }}</code></template>
    </Column>
    <Column header="Result">
      <template #body="{ data }">
        <Tag v-if="data.ok" severity="success" value="OK" />
        <Tag v-else severity="danger" value="Failed" v-tooltip.top="data.error ?? undefined" />
      </template>
    </Column>
    <Column header="Duration" class="text-right">
      <template #body="{ data }"><span class="tabular-nums">{{ data.durationMs }} ms</span></template>
    </Column>
  </DataTable>
</template>
