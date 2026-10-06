<script setup lang="ts">
import Button from 'primevue/button';
import Message from 'primevue/message';
import Password from 'primevue/password';
import ProgressSpinner from 'primevue/progressspinner';
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, errorMessage } from '../api';
import AuthCard from '../components/AuthCard.vue';
import { setSession } from '../session';
import type { SessionUser } from '../types';

const MIN_LENGTH = 12;

const route = useRoute();
const router = useRouter();
const token = String(route.params.token);

const invite = ref<{ email: string; name: string } | null>(null);
const loadError = ref('');
const password = ref('');
const confirm = ref('');
const error = ref('');
const submitting = ref(false);

const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value);

onMounted(async () => {
  try {
    invite.value = await api.get(`/invites/${encodeURIComponent(token)}`);
  } catch (failure) {
    loadError.value = errorMessage(failure);
  }
});

async function submit() {
  error.value = '';
  if (password.value.length < MIN_LENGTH) {
    error.value = `Use at least ${MIN_LENGTH} characters.`;
    return;
  }
  if (password.value !== confirm.value) {
    error.value = 'The passwords do not match.';
    return;
  }
  submitting.value = true;
  try {
    const { user } = await api.post<{ user: SessionUser }>(`/invites/${encodeURIComponent(token)}`, {
      password: password.value,
    });
    setSession(user);
    await router.replace(user.role === 'admin' ? '/admin' : '/connections');
  } catch (failure) {
    error.value = errorMessage(failure);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthCard
    title="Set your password"
    :subtitle="invite ? `Welcome, ${invite.name}. Choose a password for ${invite.email}.` : undefined"
  >
    <Message v-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>
    <div v-else-if="!invite" class="flex justify-center py-6">
      <ProgressSpinner style="width: 2.5rem; height: 2.5rem" />
    </div>
    <form v-else class="flex flex-col gap-4" @submit.prevent="submit">
      <div class="flex flex-col gap-2">
        <label for="password" class="text-sm font-medium">Password</label>
        <Password v-model="password" input-id="password" :feedback="false" toggle-mask fluid autocomplete="new-password" required />
        <small class="text-muted-color">At least {{ MIN_LENGTH }} characters.</small>
      </div>
      <div class="flex flex-col gap-2">
        <label for="confirm" class="text-sm font-medium">Confirm password</label>
        <Password
          v-model="confirm"
          input-id="confirm"
          :feedback="false"
          toggle-mask
          fluid
          autocomplete="new-password"
          :invalid="mismatch"
          required
        />
      </div>
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      <Button type="submit" label="Save and continue" :loading="submitting" />
    </form>
  </AuthCard>
</template>
