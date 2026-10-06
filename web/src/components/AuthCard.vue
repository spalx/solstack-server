<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-10">
    <div
      class="w-full max-w-sm rounded-xl border border-surface-200 bg-surface-0 p-8 shadow-sm dark:border-surface-800 dark:bg-surface-900"
    >
      <div class="mb-6 flex items-center gap-2">
        <i class="pi pi-sitemap text-primary text-xl" />
        <span class="text-lg font-semibold">Solstack</span>
      </div>
      <h1 class="text-xl font-semibold">{{ title }}</h1>
      <p v-if="subtitle" class="text-muted-color mt-1 mb-6 text-sm">{{ subtitle }}</p>
      <div :class="{ 'mt-6': !subtitle }">
        <slot />
      </div>
    </div>
  </div>
</template>
