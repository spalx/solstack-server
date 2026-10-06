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
import { api, errorMessage } from '../../api';
import PageHeader from '../../components/PageHeader.vue';
import StandardsUploadDialog from '../../components/StandardsUploadDialog.vue';
import { formatRelative } from '../../format';
import type { Repository, StandardSummary } from '../../types';

const router = useRouter();
const toast = useToast();
const confirm = useConfirm();

const standards = ref<StandardSummary[]>([]);
const repositories = ref<Repository[]>([]);
const loading = ref(true);
const uploadOpen = ref(false);

const repositoryNames = computed(() => new Map(repositories.value.map((r) => [r.id, r.name])));

async function load() {
  try {
    const [s, r] = await Promise.all([
      api.get<{ standards: StandardSummary[] }>('/admin/standards'),
      api.get<{ repositories: Repository[] }>('/admin/repositories'),
    ]);
    standards.value = s.standards;
    repositories.value = r.repositories;
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not load standards', detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function toggle(standard: StandardSummary, enabled: boolean) {
  const previous = standard.enabled;
  standard.enabled = enabled;
  try {
    await api.patch(`/admin/standards/${standard.id}`, { enabled });
  } catch (failure) {
    standard.enabled = previous;
    toast.add({ severity: 'error', summary: 'Could not update', detail: errorMessage(failure), life: 5000 });
  }
}

function remove(standard: StandardSummary) {
  confirm.require({
    header: `Delete "${standard.name}"?`,
    message: 'Agents will stop receiving this standard. This cannot be undone.',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/admin/standards/${standard.id}`);
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not delete', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}

async function imported(summary: string) {
  toast.add({ severity: 'success', summary: 'Standards imported', detail: summary, life: 5000 });
  await load();
}

function scope(standard: StandardSummary): string {
  if (standard.appliesToAll) return 'All repositories';
  const names = standard.repositoryIds.map((id) => repositoryNames.value.get(id)).filter(Boolean);
  return names.length ? names.join(', ') : 'No repositories';
}
</script>

<template>
  <PageHeader
    title="Engineering standards"
    description="Conventions your agents follow: how to structure code, name things, test and commit. Write them here or upload Markdown files."
  >
    <div class="flex gap-2">
      <Button label="Upload .md files" icon="pi pi-upload" severity="secondary" outlined @click="uploadOpen = true" />
      <Button label="New standard" icon="pi pi-plus" @click="router.push('/admin/standards/new')" />
    </div>
  </PageHeader>

  <DataTable
    :value="standards"
    :loading="loading"
    data-key="id"
    scrollable
    table-style="min-width: 48rem"
    row-hover
    class="cursor-pointer"
    @row-click="({ data }) => router.push(`/admin/standards/${data.id}`)"
  >
    <template #empty>
      <div class="py-6 text-center">
        <p class="font-medium">No standards yet</p>
        <p class="text-muted-color mt-1 text-sm">Upload your existing Markdown files, or write the first one here.</p>
      </div>
    </template>
    <Column header="Standard">
      <template #body="{ data }">
        <p class="font-medium" :class="{ 'text-muted-color': !data.enabled }">{{ data.name }}</p>
        <p class="text-muted-color line-clamp-2 max-w-xl text-sm">
          {{ data.description || 'No description. Agents use it to decide when this standard applies.' }}
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

  <StandardsUploadDialog
    v-model:visible="uploadOpen"
    :existing-slugs="standards.map((s) => s.slug)"
    @imported="imported"
  />
</template>
