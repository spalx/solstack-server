<script setup lang="ts">
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Password from 'primevue/password';
import Select from 'primevue/select';
import Skeleton from 'primevue/skeleton';
import Tag from 'primevue/tag';
import ToggleSwitch from 'primevue/toggleswitch';
import { useToast } from 'primevue/usetoast';
import { onMounted, reactive, ref } from 'vue';
import { api, errorMessage } from '../../api';
import CopyField from '../../components/CopyField.vue';
import PageHeader from '../../components/PageHeader.vue';
import type { IntegrationView } from '../../types';

interface Draft {
  enabled: boolean;
  values: Record<string, string>;
}

const toast = useToast();
const integrations = ref<IntegrationView[] | null>(null);
const drafts = reactive<Record<string, Draft>>({});
const saving = ref<string | null>(null);
const errors = reactive<Record<string, string>>({});
const loadError = ref('');

function resetDraft(integration: IntegrationView) {
  // Secret inputs start empty: leaving them empty keeps the stored value.
  drafts[integration.id] = { enabled: integration.enabled, values: { ...integration.values } };
}

onMounted(async () => {
  try {
    integrations.value = (await api.get<{ integrations: IntegrationView[] }>('/admin/integrations')).integrations;
    integrations.value.forEach(resetDraft);
  } catch (failure) {
    loadError.value = errorMessage(failure);
  }
});

async function save(integration: IntegrationView) {
  saving.value = integration.id;
  errors[integration.id] = '';
  try {
    const { integration: saved } = await api.put<{ integration: IntegrationView }>(
      `/admin/integrations/${integration.id}`,
      drafts[integration.id],
    );
    integrations.value = integrations.value!.map((i) => (i.id === saved.id ? saved : i));
    resetDraft(saved);
    toast.add({ severity: 'success', summary: `${saved.name} saved`, life: 3000 });
  } catch (failure) {
    errors[integration.id] = errorMessage(failure);
  } finally {
    saving.value = null;
  }
}
</script>

<template>
  <PageHeader
    title="Integrations"
    description="Register this server with each provider, then enable the integration. Developers authorize individually from their Connections page."
  />

  <Message v-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>
  <Skeleton v-else-if="!integrations" height="20rem" />

  <div v-else class="flex flex-col gap-6">
    <section
      v-for="integration in integrations"
      :key="integration.id"
      class="rounded-xl border border-surface-200 bg-surface-0 dark:border-surface-800 dark:bg-surface-900"
    >
      <header class="flex flex-wrap items-center justify-between gap-4 border-b border-surface-200 p-5 dark:border-surface-800">
        <div>
          <div class="flex items-center gap-2">
            <h2 class="text-lg font-semibold">{{ integration.name }}</h2>
            <Tag v-if="integration.enabled" severity="success" value="Enabled" />
            <Tag v-else-if="!integration.configured" severity="secondary" value="Not set up" />
            <Tag v-else severity="secondary" value="Disabled" />
          </div>
          <p class="text-muted-color text-sm">{{ integration.description }}</p>
        </div>
        <label class="flex items-center gap-2 text-sm font-medium">
          <ToggleSwitch v-model="drafts[integration.id]!.enabled" />
          Enabled
        </label>
      </header>

      <div class="grid gap-8 p-5 lg:grid-cols-2">
        <div>
          <h3 class="mb-3 text-sm font-semibold">1. Register with {{ integration.name }}</h3>
          <div v-for="step in integration.setup" :key="step.label" class="mb-4">
            <p class="mb-1 text-sm font-medium">{{ step.label }}</p>
            <CopyField :value="step.value" />
            <p v-if="step.help" class="text-muted-color mt-1 text-xs">{{ step.help }}</p>
          </div>
        </div>

        <form class="flex flex-col gap-4" @submit.prevent="save(integration)">
          <h3 class="text-sm font-semibold">2. Enter the credentials</h3>
          <div v-for="field in integration.fields" :key="field.key" class="flex flex-col gap-1">
            <label :for="`${integration.id}-${field.key}`" class="text-sm font-medium">
              {{ field.label }}<span v-if="field.required" class="text-red-500"> *</span>
            </label>
            <Password
              v-if="field.type === 'secret'"
              v-model="drafts[integration.id]!.values[field.key]"
              :input-id="`${integration.id}-${field.key}`"
              :feedback="false"
              toggle-mask
              fluid
              autocomplete="off"
              :placeholder="integration.secretsSet[field.key] ? 'Saved. Leave empty to keep it.' : ''"
            />
            <Select
              v-else-if="field.type === 'select'"
              v-model="drafts[integration.id]!.values[field.key]"
              :input-id="`${integration.id}-${field.key}`"
              :options="field.options"
              option-label="label"
              option-value="value"
              fluid
            />
            <InputText
              v-else
              :id="`${integration.id}-${field.key}`"
              v-model="drafts[integration.id]!.values[field.key]"
              :placeholder="field.default"
              autocomplete="off"
            />
            <small v-if="field.help" class="text-muted-color">{{ field.help }}</small>
          </div>
          <Message v-if="errors[integration.id]" severity="error" :closable="false">{{ errors[integration.id] }}</Message>
          <div>
            <Button type="submit" label="Save" :loading="saving === integration.id" />
          </div>
        </form>
      </div>
    </section>
  </div>
</template>
