<script setup lang="ts">
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import Textarea from 'primevue/textarea';
import { computed, ref } from 'vue';
import { renderMarkdown } from '../markdown';

const model = defineModel<string>({ required: true });
defineProps<{ id?: string; invalid?: boolean; placeholder?: string }>();

const tab = ref('write');
const preview = computed(() => (tab.value === 'preview' ? renderMarkdown(model.value) : ''));

/** Tab inserts two spaces instead of leaving the field, which is what people expect when writing Markdown. */
function indent(event: KeyboardEvent) {
  const field = event.target as HTMLTextAreaElement;
  const { selectionStart: start, selectionEnd: end } = field;
  model.value = `${model.value.slice(0, start)}  ${model.value.slice(end)}`;
  requestAnimationFrame(() => field.setSelectionRange(start + 2, start + 2));
}
</script>

<template>
  <Tabs v-model:value="tab" class="rounded-md border border-surface-200 dark:border-surface-700">
    <TabList>
      <Tab value="write"><i class="pi pi-pencil mr-2 text-xs" />Write</Tab>
      <Tab value="preview"><i class="pi pi-eye mr-2 text-xs" />Preview</Tab>
    </TabList>
    <TabPanels class="!p-0">
      <TabPanel value="write">
        <Textarea
          :id="id"
          v-model="model"
          :invalid="invalid"
          rows="22"
          spellcheck="true"
          :placeholder="placeholder ?? 'Write in Markdown…'"
          class="block w-full resize-y !rounded-none !border-0 font-mono text-sm leading-relaxed !shadow-none"
          @keydown.tab.exact.prevent="indent"
        />
      </TabPanel>
      <TabPanel value="preview">
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderMarkdown -->
        <div v-if="model.trim()" class="prose prose-sm max-w-none p-4 dark:prose-invert" v-html="preview" />
        <p v-else class="text-muted-color p-4 text-sm">Nothing to preview yet.</p>
      </TabPanel>
    </TabPanels>
  </Tabs>
</template>
