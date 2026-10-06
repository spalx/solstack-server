<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { api, errorMessage } from '../api';
import CopyField from '../components/CopyField.vue';
import PageHeader from '../components/PageHeader.vue';
import SecretDialog from '../components/SecretDialog.vue';
import { formatDateTime, formatRelative } from '../format';
import type { AccessToken } from '../types';

const toast = useToast();
const confirm = useConfirm();

const tokens = ref<AccessToken[]>([]);
const mcpUrl = ref('');
const loading = ref(true);
const createOpen = ref(false);
const tokenName = ref('');
const creating = ref(false);
const newToken = ref<string | null>(null);
const showNewToken = ref(false);

/** Snippets show the real token right after it is created; otherwise a placeholder. */
const tokenForSnippets = computed(() => newToken.value ?? '<your access token>');

const snippets = computed(() => {
  const url = mcpUrl.value;
  const token = tokenForSnippets.value;
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      where: 'Run in a terminal:',
      code: `claude mcp add --transport http --scope user solstack ${url} \\\n  --header "Authorization: Bearer ${token}"`,
    },
    {
      id: 'cursor',
      label: 'Cursor',
      where: 'Add to ~/.cursor/mcp.json:',
      code: JSON.stringify({ mcpServers: { solstack: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2),
    },
    {
      id: 'vscode',
      label: 'VS Code',
      where: 'Add to your user mcp.json (Command Palette → "MCP: Open User Configuration"). VS Code asks for the token once and stores it securely:',
      code: JSON.stringify(
        {
          servers: { solstack: { type: 'http', url, headers: { Authorization: 'Bearer ${input:solstack-token}' } } },
          inputs: [{ type: 'promptString', id: 'solstack-token', description: 'Solstack access token', password: true }],
        },
        null,
        2,
      ),
    },
    {
      id: 'codex',
      label: 'Codex',
      where: 'Add to ~/.codex/config.toml and export SOLSTACK_TOKEN in your shell profile:',
      code: `[mcp_servers.solstack]\nurl = "${url}"\nbearer_token_env_var = "SOLSTACK_TOKEN"`,
    },
  ];
});

async function load() {
  try {
    const result = await api.get<{ tokens: AccessToken[]; mcpUrl: string }>('/me/tokens');
    tokens.value = result.tokens;
    mcpUrl.value = result.mcpUrl;
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not load tokens', detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function createToken() {
  creating.value = true;
  try {
    const result = await api.post<{ token: string }>('/me/tokens', { name: tokenName.value });
    newToken.value = result.token;
    showNewToken.value = true;
    createOpen.value = false;
    tokenName.value = '';
    await load();
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not create token', detail: errorMessage(failure), life: 5000 });
  } finally {
    creating.value = false;
  }
}

function revoke(token: AccessToken) {
  confirm.require({
    header: `Revoke "${token.name}"?`,
    message: 'Agents and tools using this token will stop working immediately.',
    acceptProps: { label: 'Revoke', severity: 'danger' },
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    accept: async () => {
      try {
        await api.delete(`/me/tokens/${token.id}`);
        await load();
      } catch (failure) {
        toast.add({ severity: 'error', summary: 'Could not revoke token', detail: errorMessage(failure), life: 5000 });
      }
    },
  });
}
</script>

<template>
  <PageHeader
    title="Agent access"
    description="Your agents reach GitHub and Trello through this server's MCP gateway, authenticated with a personal access token."
  >
    <Button label="New token" icon="pi pi-plus" @click="createOpen = true" />
  </PageHeader>

  <section class="mb-10">
    <h2 class="mb-3 font-semibold">Access tokens</h2>
    <DataTable :value="tokens" :loading="loading" data-key="id" size="small">
      <template #empty>No tokens yet. Create one for each machine or agent you use.</template>
      <Column field="name" header="Name" />
      <Column header="Token">
        <template #body="{ data }">
          <code class="text-sm">{{ data.prefix }}…</code>
        </template>
      </Column>
      <Column header="Created">
        <template #body="{ data }">{{ formatDateTime(data.createdAt) }}</template>
      </Column>
      <Column header="Last used">
        <template #body="{ data }">{{ formatRelative(data.lastUsedAt) }}</template>
      </Column>
      <Column class="w-0 text-right">
        <template #body="{ data }">
          <Button label="Revoke" severity="danger" text size="small" @click="revoke(data)" />
        </template>
      </Column>
    </DataTable>
  </section>

  <section>
    <h2 class="mb-1 font-semibold">Connect your agent</h2>
    <p class="text-muted-color mb-4 text-sm">
      In a Solstack repository, <code>solstack setup</code> does this for you. Elsewhere, add the gateway by hand:
    </p>
    <div class="mb-4">
      <label class="mb-1 block text-sm font-medium">MCP server URL</label>
      <CopyField :value="mcpUrl" />
    </div>
    <Tabs value="claude-code">
      <TabList>
        <Tab v-for="snippet in snippets" :key="snippet.id" :value="snippet.id">{{ snippet.label }}</Tab>
      </TabList>
      <TabPanels>
        <TabPanel v-for="snippet in snippets" :key="snippet.id" :value="snippet.id">
          <p class="text-muted-color mb-2 text-sm">{{ snippet.where }}</p>
          <CopyField :value="snippet.code" multiline />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </section>

  <Dialog v-model:visible="createOpen" modal header="New access token" class="w-full max-w-md">
    <form id="create-token" class="flex flex-col gap-2" @submit.prevent="createToken">
      <label for="token-name" class="text-sm font-medium">Name</label>
      <InputText id="token-name" v-model="tokenName" placeholder="e.g. Work laptop – Claude Code" required autofocus />
      <small class="text-muted-color">So you can tell your tokens apart later.</small>
    </form>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="createOpen = false" />
      <Button type="submit" form="create-token" label="Create" :loading="creating" />
    </template>
  </Dialog>

  <SecretDialog
    title="Your new access token"
    :value="showNewToken ? newToken : null"
    warning="Copy it now. It won't be shown again. The setup snippets below include it until you leave this page."
    @close="showNewToken = false"
  >
    <Message severity="secondary" :closable="false" class="mt-4">
      Treat it like a password: anyone with it can act as you on every connected integration.
    </Message>
  </SecretDialog>
</template>
