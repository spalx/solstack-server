<script setup lang="ts">
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Message from 'primevue/message';
import CopyField from './CopyField.vue';

/** Shows a value that the server returns only once (API keys, tokens, invite links). */
defineProps<{ title: string; value: string | null; warning: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Dialog :visible="value !== null" modal :header="title" class="w-full max-w-xl" :closable="false">
    <Message severity="warn" :closable="false" class="mb-4">{{ warning }}</Message>
    <CopyField v-if="value" :value="value" />
    <slot />
    <template #footer>
      <Button label="Done" @click="emit('close')" />
    </template>
  </Dialog>
</template>
