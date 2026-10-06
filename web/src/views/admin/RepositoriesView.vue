<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../../api';
import PageHeader from '../../components/PageHeader.vue';
import SecretDialog from '../../components/SecretDialog.vue';
import { formatDateTime } from '../../format';
import type { Catalog, Repository } from '../../types';

const toast = useToast();
const confirm = useConfirm();

const repositories = ref<Repository[]>([]);
const catalog = ref<Catalog>({ agents: [], integrations: [] });
const loading = ref(true);

const editorOpen = ref(false);
const editing = ref<Repository | null>(null);
const form = reactive({ name: '', gitUrl: '', agents: [] as string[], requiredIntegrations: [] as string[] });
const formError = ref('');
const saving = ref(false);
const apiKey = ref<string | null>(null);
const apiKeyRepository = ref('');

const agentNames = computed(() => new Map(catalog.value.agents.map((a) => [a.id, a.name])));
const integrationNames = computed(() => new Map(catalog.value.integrations.map((i) => [i.id, i.name])));

async function load() {
  try {
    const [r, c] = await Promise.all([
      api.get<{ repositories: Repository[] }>('/admin/repositories'),
      api.get<Catalog>('/admin/catalog'),
    ]);
    repositories.value = r.repositories;
    catalog.value = c;
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not load repositories', detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openEditor(repository: Repository | null) {
  editing.value = repository;
  form.name = repository?.name ?? '';
  form.gitUrl = repository?.gitUrl ?? '';
  form.agents = [...(repository?.agents ?? [])];
  form.requiredIntegrations = [...(repository?.requiredIntegrations ?? [])];
  formError.value = '';
  editorOpen.value = true;
}

async function save() {
  saving.value = true;
  formError.value = '';
  const body = { ...form, gitUrl: form.gitUrl.trim() || null };
  try {
    if (editing.value) {
      await api.put(`/admin/repositories/${editing.value.id}`, body);
    } else {
      const result = await api.post<{ apiKey: string; repository: Repository }>('/admin/repositories', body);
      apiKey.value = result.apiKey;
      apiKeyRepository.value = result.repository.name;
    }
    editorOpen.value = false;
    await load();
  } catch (failure) {
    formError.value = errorMessage(failure);
  } finally {
    saving.value = false;
  }
}

function rotateKey(repository: Repository) {
  confirm.require({
    header: `Rotate the API key for ${repository.name}?`,
    message: 'The current key stops working immediately. Anyone running init with it will need the new key.',
    acceptProps: { label: 'Rotate key', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        apiKey.value = (await api.post<{ apiKey: string }>(`/admin/repositories/${repository.id}/rotate-key`)).apiKey;
        apiKeyRepository.value = repository.name;
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not rotate key', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}

function remove(repository: Repository) {
  confirm.require({
    header: `Delete ${repository.name}?`,
    message: 'Its API key stops working. This does not touch the repository itself.',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/admin/repositories/${repository.id}`);
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not delete', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}
</script>

<template>
  <PageHeader
    title="Repositories"
    description="Each repository gets an API key. Whoever sets the repository up passes it to the client's init command."
  >
    <Button label="Add repository" icon="pi pi-plus" @click="openEditor(null)" />
  </PageHeader>

  <DataTable :value="repositories" :loading="loading" data-key="id" scrollable table-style="min-width: 48rem">
    <template #empty>No repositories yet.</template>
    <Column header="Repository">
      <template #body="{ data }">
        <p class="font-medium whitespace-nowrap">{{ data.name }}</p>
        <p v-if="data.gitUrl" class="text-muted-color truncate text-xs">{{ data.gitUrl }}</p>
      </template>
    </Column>
    <Column header="Agents">
      <template #body="{ data }">
        <div class="flex flex-wrap gap-1">
          <Tag v-for="id in data.agents" :key="id" severity="secondary" :value="agentNames.get(id) ?? id" />
          <span v-if="!data.agents.length" class="text-muted-color text-sm">None</span>
        </div>
      </template>
    </Column>
    <Column header="Required integrations">
      <template #body="{ data }">
        <div class="flex flex-wrap gap-1">
          <Tag v-for="id in data.requiredIntegrations" :key="id" :value="integrationNames.get(id) ?? id" />
          <span v-if="!data.requiredIntegrations.length" class="text-muted-color text-sm">None</span>
        </div>
      </template>
    </Column>
    <Column header="API key">
      <template #body="{ data }">
        <code class="text-sm">{{ data.apiKeyPrefix }}…</code>
        <p class="text-muted-color text-xs">Updated {{ formatDateTime(data.updatedAt) }}</p>
      </template>
    </Column>
    <Column class="w-0">
      <template #body="{ data }">
        <div class="flex justify-end gap-1">
          <Button icon="pi pi-pencil" text size="small" aria-label="Edit" v-tooltip.top="'Edit'" @click="openEditor(data)" />
          <Button icon="pi pi-refresh" text size="small" aria-label="Rotate key" v-tooltip.top="'Rotate key'" @click="rotateKey(data)" />
          <Button icon="pi pi-trash" text severity="danger" size="small" aria-label="Delete" v-tooltip.top="'Delete'" @click="remove(data)" />
        </div>
      </template>
    </Column>
  </DataTable>

  <Dialog
    v-model:visible="editorOpen"
    modal
    :header="editing ? `Edit ${editing.name}` : 'Add repository'"
    class="w-full max-w-lg"
  >
    <form id="repository-form" class="flex flex-col gap-4" @submit.prevent="save">
      <div class="flex flex-col gap-1">
        <label for="repo-name" class="text-sm font-medium">Name</label>
        <InputText id="repo-name" v-model="form.name" placeholder="acme/web-app" required autofocus />
      </div>
      <div class="flex flex-col gap-1">
        <label for="repo-url" class="text-sm font-medium">Git URL <span class="text-muted-color font-normal">(optional)</span></label>
        <InputText id="repo-url" v-model="form.gitUrl" placeholder="git@github.com:acme/web-app.git" />
      </div>
      <div class="flex flex-col gap-1">
        <label for="repo-agents" class="text-sm font-medium">Supported agents</label>
        <MultiSelect
          v-model="form.agents"
          input-id="repo-agents"
          :options="catalog.agents"
          option-label="name"
          option-value="id"
          display="chip"
          :show-toggle-all="false"
          placeholder="Select agents"
          fluid
        />
        <small class="text-muted-color">The client generates commands and instructions for these agents.</small>
      </div>
      <div class="flex flex-col gap-1">
        <label for="repo-integrations" class="text-sm font-medium">Required integrations</label>
        <MultiSelect
          v-model="form.requiredIntegrations"
          input-id="repo-integrations"
          :options="catalog.integrations"
          option-label="name"
          option-value="id"
          display="chip"
          :show-toggle-all="false"
          placeholder="Select integrations"
          fluid
        />
        <small class="text-muted-color">Developers working on this repository must connect these.</small>
      </div>
      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>
    </form>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="editorOpen = false" />
      <Button type="submit" form="repository-form" :label="editing ? 'Save' : 'Create'" :loading="saving" />
    </template>
  </Dialog>

  <SecretDialog
    :title="`API key for ${apiKeyRepository}`"
    :value="apiKey"
    warning="Copy it now. It won't be shown again. If it's lost, rotate the key."
    @close="apiKey = null"
  />
</template>
