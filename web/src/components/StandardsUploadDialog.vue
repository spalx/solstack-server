<script setup lang="ts">
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tag from 'primevue/tag';
import { computed, ref, watch } from 'vue';
import { api, errorMessage } from '../api';
import { parseStandardFile, slugify, type ParsedStandard } from '../markdown';

const MAX_FILE_BYTES = 200_000;

const visible = defineModel<boolean>('visible', { required: true });
const props = defineProps<{ existingSlugs: string[] }>();
const emit = defineEmits<{ imported: [summary: string] }>();

const files = ref<ParsedStandard[]>([]);
const rejected = ref<string[]>([]);
const replaceExisting = ref(false);
const importing = ref(false);
const error = ref('');
const dragging = ref(false);
const picker = ref<HTMLInputElement | null>(null);

const existing = computed(() => new Set(props.existingSlugs));
const duplicates = computed(() => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const file of files.value) (seen.has(file.slug) ? repeated : seen).add(file.slug);
  return repeated;
});
const invalid = computed(() => files.value.filter((file) => !file.slug || !file.name.trim() || !file.content.trim()));
const replacements = computed(() => files.value.filter((file) => existing.value.has(file.slug)).length);
const canImport = computed(() => files.value.length > 0 && duplicates.value.size === 0 && invalid.value.length === 0);

watch(visible, (open) => {
  if (open) {
    files.value = [];
    rejected.value = [];
    replaceExisting.value = false;
    error.value = '';
  }
});

async function add(list: FileList | File[]) {
  for (const file of Array.from(list)) {
    if (!/\.(md|markdown)$/i.test(file.name)) rejected.value.push(`${file.name}: not a Markdown file`);
    else if (file.size > MAX_FILE_BYTES) rejected.value.push(`${file.name}: larger than 200 KB`);
    else files.value.push(parseStandardFile(file.name, await file.text()));
  }
}

function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) void add(input.files);
  input.value = '';
}

function onDrop(event: DragEvent) {
  dragging.value = false;
  if (event.dataTransfer?.files) void add(event.dataTransfer.files);
}

function status(file: ParsedStandard): { label: string; severity: 'success' | 'warn' | 'danger' | 'secondary' } {
  if (!file.content.trim()) return { label: 'Empty', severity: 'danger' };
  if (!file.slug) return { label: 'Needs an ID', severity: 'danger' };
  if (duplicates.value.has(file.slug)) return { label: 'Duplicate ID', severity: 'danger' };
  if (existing.value.has(file.slug)) return replaceExisting.value ? { label: 'Replaces', severity: 'warn' } : { label: 'Skipped', severity: 'secondary' };
  return { label: 'New', severity: 'success' };
}

async function submit() {
  importing.value = true;
  error.value = '';
  try {
    const result = await api.post<{ created: string[]; replaced: string[]; skipped: string[] }>('/admin/standards/import', {
      items: files.value.map(({ slug, name, description, content }) => ({ slug, name, description, content })),
      replaceExisting: replaceExisting.value,
    });
    const parts = [
      result.created.length && `${result.created.length} added`,
      result.replaced.length && `${result.replaced.length} replaced`,
      result.skipped.length && `${result.skipped.length} skipped (already exist)`,
    ].filter(Boolean);
    emit('imported', parts.join(', '));
    visible.value = false;
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <Dialog v-model:visible="visible" modal header="Upload standards" class="w-full max-w-5xl">
    <div
      class="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors"
      :class="dragging ? 'border-primary bg-primary-50 dark:bg-primary-950' : 'border-surface-300 dark:border-surface-600'"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <i class="pi pi-upload text-muted-color text-2xl" />
      <p class="text-sm">Drop Markdown files here, or</p>
      <Button label="Choose files" icon="pi pi-folder-open" size="small" outlined @click="picker?.click()" />
      <input ref="picker" type="file" accept=".md,.markdown,text/markdown" multiple class="hidden" @change="onPick" />
      <p class="text-muted-color text-xs">
        Each file becomes one standard. <code>name</code> and <code>description</code> frontmatter are used when present.
      </p>
    </div>

    <Message v-for="reason in rejected" :key="reason" severity="warn" :closable="false" class="mt-3">{{ reason }}</Message>

    <DataTable v-if="files.length" :value="files" size="small" class="mt-4" scrollable scroll-height="22rem" table-style="min-width: 56rem">
      <Column header="File" style="width: 8rem">
        <template #body="{ data }"><span class="text-muted-color text-xs break-all">{{ data.fileName }}</span></template>
      </Column>
      <Column header="Name" style="min-width: 12rem">
        <template #body="{ data }">
          <InputText v-model="data.name" size="small" fluid :invalid="!data.name.trim()" />
        </template>
      </Column>
      <Column header="ID" style="min-width: 12rem">
        <template #body="{ data }">
          <InputText
            :model-value="data.slug"
            size="small"
            fluid
            class="font-mono"
            :invalid="!data.slug || duplicates.has(data.slug)"
            @update:model-value="(value) => (data.slug = slugify(value ?? ''))"
          />
        </template>
      </Column>
      <Column header="Description" style="min-width: 12rem">
        <template #body="{ data }">
          <span v-if="data.description" class="line-clamp-2 text-xs">{{ data.description }}</span>
          <span v-else class="text-muted-color text-xs">None. Add one afterwards so agents know when it applies.</span>
        </template>
      </Column>
      <Column header="Result" style="width: 7rem">
        <template #body="{ data }"><Tag :severity="status(data).severity" :value="status(data).label" /></template>
      </Column>
      <Column class="w-0">
        <template #body="{ index }">
          <Button icon="pi pi-times" text rounded size="small" aria-label="Remove" @click="files.splice(index, 1)" />
        </template>
      </Column>
    </DataTable>

    <label v-if="replacements" class="mt-4 flex items-center gap-2 text-sm">
      <Checkbox v-model="replaceExisting" binary input-id="replace-existing" />
      Replace the {{ replacements }} existing standard{{ replacements === 1 ? '' : 's' }} with the same ID
      <span class="text-muted-color">(their scope and on/off setting are kept)</span>
    </label>

    <Message v-if="error" severity="error" :closable="false" class="mt-4">{{ error }}</Message>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="visible = false" />
      <Button
        :label="files.length ? `Import ${files.length} file${files.length === 1 ? '' : 's'}` : 'Import'"
        icon="pi pi-check"
        :disabled="!canImport"
        :loading="importing"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
