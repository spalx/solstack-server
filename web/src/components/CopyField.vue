<script setup lang="ts">
import Button from 'primevue/button';
import { ref } from 'vue';

const props = defineProps<{ value: string; multiline?: boolean }>();
const copied = ref(false);

async function copy() {
  await navigator.clipboard.writeText(props.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-md border border-surface-200 bg-surface-50 py-1 pr-1 pl-3 dark:border-surface-700 dark:bg-surface-800"
  >
    <pre v-if="multiline" class="min-w-0 flex-1 overflow-x-auto py-1.5 text-sm">{{ value }}</pre>
    <code v-else class="min-w-0 flex-1 truncate py-1.5 text-sm">{{ value }}</code>
    <Button
      :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
      text
      size="small"
      :aria-label="copied ? 'Copied' : 'Copy'"
      v-tooltip.top="copied ? 'Copied' : 'Copy'"
      @click="copy"
    />
  </div>
</template>
