<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorMessage } from '../../api';
import GuidanceList from '../../components/GuidanceList.vue';
import PageHeader from '../../components/PageHeader.vue';
import { formatRelative } from '../../format';
import { GUIDANCE } from '../../guidance';
import type { IntakeSection } from '../../types';

const ICONS: Record<IntakeSection['target'], string> = {
  tasks: 'pi pi-check-square',
  comments: 'pi pi-comments',
  pull_requests: 'pi pi-github',
  commits: 'pi pi-code',
};

const router = useRouter();
const info = GUIDANCE.intake;
const sections = ref<IntakeSection[] | null>(null);
const error = ref('');
const list = ref<InstanceType<typeof GuidanceList> | null>(null);

onMounted(async () => {
  try {
    sections.value = (await api.get<{ sections: IntakeSection[] }>('/admin/intake/sections')).sections;
  } catch (failure) {
    error.value = errorMessage(failure);
  }
});

function open(section: IntakeSection) {
  void router.push(section.rule ? `${info.path}/${section.rule.id}` : `${info.path}/new?target=${section.target}`);
}
</script>

<template>
  <PageHeader :title="info.title" :description="info.intro" />

  <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
  <div v-else-if="!sections" class="grid gap-4 md:grid-cols-2">
    <Skeleton v-for="n in 4" :key="n" height="8rem" />
  </div>
  <div v-else class="grid gap-4 md:grid-cols-2">
    <button
      v-for="section in sections"
      :key="section.target"
      type="button"
      class="flex flex-col rounded-xl border border-surface-200 bg-surface-0 p-5 text-left transition-colors hover:border-primary dark:border-surface-800 dark:bg-surface-900"
      @click="open(section)"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <i :class="ICONS[section.target]" class="text-muted-color text-lg" />
          <h2 class="font-semibold">{{ section.name }}</h2>
        </div>
        <Tag v-if="!section.rule" severity="secondary" value="Not set" class="shrink-0" />
        <Tag v-else-if="!section.rule.enabled" severity="secondary" value="Off" class="shrink-0" />
        <Tag v-else-if="section.rule.appliesToAll" severity="success" value="All repositories" class="shrink-0 whitespace-nowrap" />
        <Tag v-else severity="success" :value="`${section.rule.repositoryIds.length} repositories`" class="shrink-0 whitespace-nowrap" />
      </div>
      <p class="text-muted-color mt-2 text-sm">{{ section.help }}</p>
      <p class="mt-4 pt-1 text-sm md:mt-auto">
        <span v-if="section.rule" class="text-muted-color">
          Updated {{ formatRelative(section.rule.updatedAt) }}<template v-if="section.rule.updatedBy"> by {{ section.rule.updatedBy }}</template>
        </span>
        <span v-else class="text-primary font-medium">Write the rules <i class="pi pi-arrow-right ml-1 text-xs" /></span>
      </p>
    </button>
  </div>

  <div class="mt-10 mb-3 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="font-semibold">Custom rules</h2>
      <p class="text-muted-color text-sm">Anything else agents write: release notes, status updates, documentation.</p>
    </div>
    <div class="flex gap-2">
      <Button label="Upload .md files" icon="pi pi-upload" severity="secondary" outlined size="small" @click="list?.openUpload()" />
      <Button label="New rule" icon="pi pi-plus" size="small" @click="router.push(`${info.path}/new`)" />
    </div>
  </div>
  <GuidanceList
    ref="list"
    kind="intake"
    custom-only
    empty-title="No custom rules"
    empty-text="Add rules for anything else agents write outside the code."
  />
</template>
