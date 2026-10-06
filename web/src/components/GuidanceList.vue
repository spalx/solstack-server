<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import { formatRelative } from '../format';
import { GUIDANCE } from '../guidance';
import type { GuidanceKind, Repository, StandardSummary } from '../types';
import StandardsUploadDialog from './StandardsUploadDialog.vue';

/** The list of standards, intake rules or product context documents, with upload and inline on/off. */
const props = defineProps<{
  kind: GuidanceKind;
  /** Leave out built-in intake sections (they have their own cards on the Intake page). */
  customOnly?: boolean;
  emptyTitle: string;
  emptyText: string;
}>();

const router = useRouter();
const toast = useToast();
const confirm = useConfirm();
const info = computed(() => GUIDANCE[props.kind]);

const documents = ref<StandardSummary[]>([]);
const repositories = ref<Repository[]>([]);
const loading = ref(true);
const uploadOpen = ref(false);

const shown = computed(() => (props.customOnly ? documents.value.filter((d) => !d.target) : documents.value));
const repositoryNames = computed(() => new Map(repositories.value.map((r) => [r.id, r.name])));

async function load() {
  try {
    const [s, r] = await Promise.all([
      api.get<{ standards: StandardSummary[] }>(`/admin/standards?kind=${props.kind}`),
      api.get<{ repositories: Repository[] }>('/admin/repositories'),
    ]);
    documents.value = s.standards;
    repositories.value = r.repositories;
  } catch (failure) {
    toast.add({ severity: 'error', summary: `Could not load ${info.value.title.toLowerCase()}`, detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);
defineExpose({ openUpload: () => (uploadOpen.value = true), reload: load });

async function toggle(document: StandardSummary, enabled: boolean) {
  const previous = document.enabled;
  document.enabled = enabled;
  try {
    await api.patch(`/admin/standards/${document.id}`, { enabled });
  } catch (failure) {
    document.enabled = previous;
    toast.add({ severity: 'error', summary: 'Could not update', detail: errorMessage(failure), life: 5000 });
  }
}

function remove(document: StandardSummary) {
  confirm.require({
    header: `Delete "${document.name}"?`,
    message: `Agents will stop receiving this ${info.value.singular}. This cannot be undone.`,
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/admin/standards/${document.id}`);
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not delete', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}

async function imported(summary: string) {
  toast.add({ severity: 'success', summary: 'Imported', detail: summary, life: 5000 });
  await load();
}

function scope(document: StandardSummary): string {
  const names = document.repositoryIds.map((id) => repositoryNames.value.get(id)).filter(Boolean);
  return names.length ? names.join(', ') : 'No repositories';
}
</script>

<template>
  <DataTable
    :value="shown"
    :loading="loading"
    data-key="id"
    scrollable
    table-style="min-width: 48rem"
    row-hover
    class="cursor-pointer"
    @row-click="({ data }) => router.push(`${info.path}/${data.id}`)"
  >
    <template #empty>
      <div class="py-6 text-center">
        <p class="font-medium">{{ emptyTitle }}</p>
        <p class="text-muted-color mt-1 text-sm">{{ emptyText }}</p>
      </div>
    </template>
    <Column header="Name">
      <template #body="{ data }">
        <p class="font-medium" :class="{ 'text-muted-color': !data.enabled }">{{ data.name }}</p>
        <p class="text-muted-color line-clamp-2 max-w-xl text-sm">
          {{ data.description || 'No description. Agents use it to decide when this applies.' }}
        </p>
      </template>
    </Column>
    <Column header="Applies to">
      <template #body="{ data }">
        <Tag v-if="data.appliesToAll" severity="secondary" value="All repositories" class="whitespace-nowrap" />
        <span v-else class="text-sm">{{ scope(data) }}</span>
      </template>
    </Column>
    <Column header="Updated">
      <template #body="{ data }">
        <span class="text-sm whitespace-nowrap">{{ formatRelative(data.updatedAt) }}</span>
        <p v-if="data.updatedBy" class="text-muted-color text-xs">by {{ data.updatedBy }}</p>
      </template>
    </Column>
    <Column header="Enabled" class="w-0">
      <template #body="{ data }">
        <ToggleSwitch
          :model-value="data.enabled"
          :aria-label="`Enable ${data.name}`"
          @click.stop
          @update:model-value="(value: boolean) => toggle(data, value)"
        />
      </template>
    </Column>
    <Column class="w-0">
      <template #body="{ data }">
        <Button
          icon="pi pi-trash"
          text
          severity="danger"
          size="small"
          :aria-label="`Delete ${data.name}`"
          v-tooltip.top="'Delete'"
          @click.stop="remove(data)"
        />
      </template>
    </Column>
  </DataTable>

  <StandardsUploadDialog v-model:visible="uploadOpen" :kind="kind" @imported="imported" />
</template>
