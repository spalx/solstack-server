<script setup lang="ts">
import ProgressSpinner from 'primevue/progressspinner';
import { onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';

/**
 * Landing page for providers that return the token in the URL fragment (Trello). The fragment never
 * reaches the server, so this page reads it and posts it back, then clears it from the address bar.
 */
const route = useRoute();
const router = useRouter();

onMounted(async () => {
  const id = String(route.params.id);
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const state = typeof route.query.state === 'string' ? route.query.state : '';
  history.replaceState(null, '', window.location.pathname);

  const params = Object.fromEntries(fragment.entries());
  if (params.error || Object.keys(params).length === 0) {
    await router.replace({ path: '/connections', query: { error: params.error ?? 'Authorization was cancelled.' } });
    return;
  }
  try {
    await api.post(`/connect/${encodeURIComponent(id)}/complete`, { ...params, state });
    await router.replace({ path: '/connections', query: { connected: id } });
  } catch (failure) {
    await router.replace({ path: '/connections', query: { error: errorMessage(failure) } });
  }
});
</script>

<template>
  <div class="flex flex-col items-center gap-4 py-20">
    <ProgressSpinner style="width: 3rem; height: 3rem" />
    <p class="text-muted-color">Finishing the connection…</p>
  </div>
</template>
