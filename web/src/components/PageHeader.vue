<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <div class="mb-8 flex flex-wrap items-start justify-between gap-4">
    <div>
      <h1 class="text-2xl font-semibold">{{ title }}</h1>
      <p v-if="description" class="text-muted-color mt-1 max-w-2xl">{{ description }}</p>
    </div>
    <slot />
  </div>
</template>
