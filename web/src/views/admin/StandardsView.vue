<script setup lang="ts">
import Button from 'primevue/button';
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import GuidanceList from '../../components/GuidanceList.vue';
import PageHeader from '../../components/PageHeader.vue';
import { GUIDANCE } from '../../guidance';
import type { GuidanceKind } from '../../types';

/** List page for engineering standards and product context, which work the same way. */
const props = defineProps<{ kind: Exclude<GuidanceKind, 'intake'> }>();
const router = useRouter();
const list = ref<InstanceType<typeof GuidanceList> | null>(null);
const info = GUIDANCE[props.kind];

const empty = {
  standard: { title: 'No standards yet', text: 'Upload your existing Markdown files, or write the first one here.' },
  context: {
    title: 'No product context yet',
    text: 'Start with an overview of the business and product, then add documents for each area: users, glossary, business rules.',
  },
}[props.kind];
</script>

<template>
  <PageHeader :title="info.title" :description="info.intro">
    <div class="flex gap-2">
      <Button label="Upload .md files" icon="pi pi-upload" severity="secondary" outlined @click="list?.openUpload()" />
      <Button :label="kind === 'standard' ? 'New standard' : 'New document'" icon="pi pi-plus" @click="router.push(`${info.path}/new`)" />
    </div>
  </PageHeader>

  <GuidanceList ref="list" :kind="kind" :empty-title="empty.title" :empty-text="empty.text" />
</template>
