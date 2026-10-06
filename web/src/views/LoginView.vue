<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import AuthCard from '../components/AuthCard.vue';
import { setSession } from '../session';
import type { SessionUser } from '../types';

const route = useRoute();
const router = useRouter();
const email = ref('');
const password = ref('');
const error = ref('');
const submitting = ref(false);

/** Only follow same-site paths, so a crafted link can't send people elsewhere after signing in. */
function nextPath(): string {
  const next = route.query.next;
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/connections';
}

async function submit() {
  error.value = '';
  submitting.value = true;
  try {
    const { user } = await api.post<{ user: SessionUser }>('/auth/login', { email: email.value, password: password.value });
    setSession(user);
    const next = nextPath();
    // Authorization flows start on the server, outside the single-page app.
    if (next.startsWith('/api/connect/')) window.location.assign(next);
    else await router.replace(next);
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard title="Sign in">
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-2">
        <label for="email" class="text-sm font-medium">Email</label>
        <InputText id="email" v-model="email" type="email" autocomplete="username" required autofocus />
      </div>
      <div class="flex flex-col gap-2">
        <label for="password" class="text-sm font-medium">Password</label>
        <Password
          v-model="password"
          input-id="password"
          :feedback="false"
          toggle-mask
          fluid
          autocomplete="current-password"
          required
        />
      </div>
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      <Button type="submit" label="Sign in" :loading="submitting" />
      <p class="text-muted-color text-xs">Don't have an account? Ask an admin for an invite link.</p>
    </form>
  </AuthCard>
</template>
