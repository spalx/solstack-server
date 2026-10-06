<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import MultiSelect from 'primevue/multiselect';
import RadioButton from 'primevue/radiobutton';
import Skeleton from 'primevue/skeleton';
import Textarea from 'primevue/textarea';
import ToggleSwitch from 'primevue/toggleswitch';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../../api';
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import { formatDateTime } from '../../format';
import { parseStandardFile, slugify } from '../../markdown';
import type { Repository, Standard } from '../../types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const confirm = useConfirm();

const id = computed(() => (route.params.id ? String(route.params.id) : null));
const isNew = computed(() => id.value === null);

const form = reactive({
  name: '',
  slug: '',
  description: '',
  content: '',
  enabled: true,
  appliesToAll: true,
  repositoryIds: [] as string[],
});
const original = ref('');
const standard = ref<Standard | null>(null);
const repositories = ref<Repository[]>([]);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const loadError = ref('');
/** While creating, the ID follows the name until someone edits the ID directly. */
const slugTouched = ref(false);
const filePicker = ref<HTMLInputElement | null>(null);

const snapshot = () => JSON.stringify(form);
const dirty = computed(() => !loading.value && snapshot() !== original.value);

onMounted(async () => {
  try {
    repositories.value = (await api.get<{ repositories: Repository[] }>('/admin/repositories')).repositories;
    if (id.value) {
      standard.value = (await api.get<{ standard: Standard }>(`/admin/standards/${id.value}`)).standard;
      const { name, slug, description, content, enabled, appliesToAll, repositoryIds } = standard.value;
      Object.assign(form, { name, slug, description, content, enabled, appliesToAll, repositoryIds: [...repositoryIds] });
      slugTouched.value = true;
    }
  } catch (failure) {
    loadError.value = errorMessage(failure);
  } finally {
    original.value = snapshot();
    loading.value = false;
  }
});

function onNameInput(value: string | undefined) {
  form.name = value ?? '';
  if (!slugTouched.value) form.slug = slugify(form.name);
}

function onSlugInput(value: string | undefined) {
  slugTouched.value = true;
  form.slug = slugify(value ?? '');
}

async function loadFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const parsed = parseStandardFile(file.name, await file.text());
  form.content = parsed.content;
  if (!form.name) onNameInput(parsed.name);
  if (!form.description) form.description = parsed.description;
  if (!slugTouched.value && parsed.slug) form.slug = parsed.slug;
  toast.add({ severity: 'info', summary: `Loaded ${file.name}`, detail: 'Review it, then save.', life: 3000 });
}

async function save() {
  saving.value = true;
  error.value = '';
  try {
    const body = { ...form, repositoryIds: form.appliesToAll ? [] : form.repositoryIds };
    const result = isNew.value
      ? await api.post<{ standard: Standard }>('/admin/standards', body)
      : await api.put<{ standard: Standard }>(`/admin/standards/${id.value}`, body);
    standard.value = result.standard;
    original.value = snapshot();
    toast.add({ severity: 'success', summary: `${result.standard.name} saved`, life: 3000 });
    if (isNew.value) await router.replace(`/admin/standards/${result.standard.id}`);
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    saving.value = false;
  }
}

function remove() {
  if (!standard.value) return;
  confirm.require({
    header: `Delete "${standard.value.name}"?`,
    message: 'Agents will stop receiving this standard. This cannot be undone.',
    acceptProps: { label: 'Delete', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/admin/standards/${standard.value!.id}`);
        original.value = snapshot();
        await router.push('/admin/standards');
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not delete', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}

onBeforeRouteLeave(() => !dirty.value || window.confirm('You have unsaved changes. Leave without saving?'));

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (dirty.value) event.preventDefault();
}
window.addEventListener('beforeunload', warnBeforeUnload);
onBeforeUnmount(() => window.removeEventListener('beforeunload', warnBeforeUnload));
</script>

<template>
  <RouterLink to="/admin/standards" class="text-muted-color mb-4 inline-flex items-center gap-1 text-sm hover:underline">
    <i class="pi pi-arrow-left text-xs" /> Standards
  </RouterLink>

  <Message v-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>
  <Skeleton v-else-if="loading" height="30rem" />

  <form v-else class="flex flex-col gap-6" @submit.prevent="save">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">{{ isNew ? 'New standard' : form.name || 'Untitled standard' }}</h1>
        <p v-if="standard" class="text-muted-color mt-1 text-sm">
          Last updated {{ formatDateTime(standard.updatedAt) }}<template v-if="standard.updatedBy"> by {{ standard.updatedBy }}</template>
        </p>
      </div>
      <div class="flex gap-2">
        <Button v-if="!isNew" label="Delete" icon="pi pi-trash" severity="danger" text @click="remove" />
        <Button type="submit" :label="isNew ? 'Create standard' : 'Save'" icon="pi pi-check" :loading="saving" :disabled="!isNew && !dirty" />
      </div>
    </div>

    <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

    <div class="grid gap-6 xl:grid-cols-[1fr_18rem]">
      <div class="flex min-w-0 flex-col gap-5">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex flex-col gap-1">
            <label for="standard-name" class="text-sm font-medium">Name</label>
            <InputText
              id="standard-name"
              :model-value="form.name"
              placeholder="Backend standards"
              required
              @update:model-value="onNameInput"
            />
          </div>
          <div class="flex flex-col gap-1">
            <label for="standard-slug" class="text-sm font-medium">ID</label>
            <InputText
              id="standard-slug"
              :model-value="form.slug"
              placeholder="backend-standards"
              class="font-mono"
              required
              @update:model-value="onSlugInput"
            />
            <small class="text-muted-color">The skill name agents see. Lowercase with dashes, up to 64 characters.</small>
          </div>
        </div>

        <div class="flex flex-col gap-1">
          <label for="standard-description" class="text-sm font-medium">When it applies</label>
          <Textarea
            id="standard-description"
            v-model="form.description"
            rows="2"
            auto-resize
            placeholder="Use when writing or reviewing backend code: services, controllers, migrations and tests."
          />
          <small class="text-muted-color">Agents read this to decide whether to load the full standard, so be specific.</small>
        </div>

        <div class="flex flex-col gap-1">
          <div class="flex items-end justify-between gap-2">
            <label for="standard-content" class="text-sm font-medium">Content</label>
            <Button label="Load from file" icon="pi pi-file-import" size="small" text @click="filePicker?.click()" />
            <input ref="filePicker" type="file" accept=".md,.markdown,text/markdown" class="hidden" @change="loadFile" />
          </div>
          <MarkdownEditor id="standard-content" v-model="form.content" />
        </div>
      </div>

      <aside class="order-first grid gap-4 sm:grid-cols-2 xl:sticky xl:top-6 xl:order-none xl:flex xl:flex-col xl:gap-5 xl:self-start">
        <section class="rounded-xl border border-surface-200 bg-surface-0 p-4 dark:border-surface-800 dark:bg-surface-900">
          <label class="flex items-center justify-between gap-2 text-sm font-medium">
            Enabled
            <ToggleSwitch v-model="form.enabled" />
          </label>
          <p class="text-muted-color mt-1 text-xs">Disabled standards are kept but not given to agents.</p>
        </section>

        <section class="rounded-xl border border-surface-200 bg-surface-0 p-4 dark:border-surface-800 dark:bg-surface-900">
          <p class="mb-3 text-sm font-medium">Applies to</p>
          <label class="mb-2 flex items-center gap-2 text-sm">
            <RadioButton v-model="form.appliesToAll" :value="true" input-id="scope-all" /> All repositories
          </label>
          <label class="flex items-center gap-2 text-sm">
            <RadioButton v-model="form.appliesToAll" :value="false" input-id="scope-some" /> Selected repositories
          </label>
          <MultiSelect
            v-if="!form.appliesToAll"
            v-model="form.repositoryIds"
            :options="repositories"
            option-label="name"
            option-value="id"
            display="chip"
            filter
            :show-toggle-all="false"
            placeholder="Choose repositories"
            class="mt-3"
            fluid
          />
          <p v-if="!form.appliesToAll && !repositories.length" class="text-muted-color mt-2 text-xs">
            There are no repositories yet. Add them under Repositories.
          </p>
        </section>
      </aside>
    </div>
  </form>
</template>
