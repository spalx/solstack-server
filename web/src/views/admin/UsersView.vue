<script setup lang="ts">
import Button from 'primevue/button';
import Column from 'primevue/column';
import DataTable from 'primevue/datatable';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Menu from 'primevue/menu';
import Message from 'primevue/message';
import Select from 'primevue/select';
import Tag from 'primevue/tag';
import { useConfirm } from 'primevue/useconfirm';
import { useToast } from 'primevue/usetoast';
import type { MenuItem } from 'primevue/menuitem';
import { reactive, ref, onMounted } from 'vue';
import { api, errorMessage } from '../../api';
import PageHeader from '../../components/PageHeader.vue';
import SecretDialog from '../../components/SecretDialog.vue';
import { currentUser } from '../../session';
import type { AdminUser, Role } from '../../types';

const toast = useToast();
const confirm = useConfirm();

const users = ref<AdminUser[]>([]);
const loading = ref(true);
const inviteOpen = ref(false);
const form = reactive({ email: '', name: '', role: 'developer' as Role });
const formError = ref('');
const saving = ref(false);
const inviteUrl = ref<string | null>(null);
const inviteFor = ref('');

const actionsMenu = ref<InstanceType<typeof Menu> | null>(null);
const menuItems = ref<MenuItem[]>([]);

const roles = [
  { label: 'Developer', value: 'developer' },
  { label: 'Admin', value: 'admin' },
];

async function load() {
  try {
    users.value = (await api.get<{ users: AdminUser[] }>('/admin/users')).users;
  } catch (failure) {
    toast.add({ severity: 'error', summary: 'Could not load users', detail: errorMessage(failure), life: 5000 });
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function openInvite() {
  Object.assign(form, { email: '', name: '', role: 'developer' });
  formError.value = '';
  inviteOpen.value = true;
}

async function invite() {
  saving.value = true;
  formError.value = '';
  try {
    const result = await api.post<{ inviteUrl: string }>('/admin/users', form);
    inviteFor.value = form.email;
    inviteUrl.value = result.inviteUrl;
    inviteOpen.value = false;
    await load();
  } catch (failure) {
    formError.value = errorMessage(failure);
  } finally {
    saving.value = false;
  }
}

async function run(action: () => Promise<unknown>, failureSummary: string) {
  try {
    await action();
    await load();
  } catch (failure) {
    toast.add({ severity: 'error', summary: failureSummary, detail: errorMessage(failure), life: 6000 });
  }
}

function newLink(user: AdminUser) {
  void run(async () => {
    inviteUrl.value = (await api.post<{ inviteUrl: string }>(`/admin/users/${user.id}/invite`)).inviteUrl;
    inviteFor.value = user.email;
  }, 'Could not create link');
}

function openActions(event: Event, user: AdminUser) {
  const isSelf = user.id === currentUser.value?.id;
  menuItems.value = [
    {
      label: user.active ? 'Password reset link' : 'New invite link',
      icon: 'pi pi-envelope',
      command: () => newLink(user),
    },
    {
      label: user.role === 'admin' ? 'Make developer' : 'Make admin',
      icon: 'pi pi-shield',
      disabled: isSelf,
      command: () =>
        run(() => api.patch(`/admin/users/${user.id}`, { role: user.role === 'admin' ? 'developer' : 'admin' }), 'Could not change role'),
    },
    {
      label: user.disabled ? 'Enable' : 'Disable',
      icon: user.disabled ? 'pi pi-check-circle' : 'pi pi-ban',
      disabled: isSelf,
      command: () => run(() => api.patch(`/admin/users/${user.id}`, { disabled: !user.disabled }), 'Could not update user'),
    },
    { separator: true },
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      class: 'text-red-600',
      disabled: isSelf,
      command: () =>
        confirm.require({
          header: `Delete ${user.email}?`,
          message: 'Their connections and access tokens are deleted too. This cannot be undone.',
          acceptProps: { label: 'Delete', severity: 'danger' },
          rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
          accept: () => run(() => api.delete(`/admin/users/${user.id}`), 'Could not delete user'),
        }),
    },
  ];
  actionsMenu.value?.toggle(event);
}
</script>

<template>
  <PageHeader title="Users" description="Invite developers and admins. Everyone sets their own password from an invite link.">
    <Button label="Invite user" icon="pi pi-user-plus" @click="openInvite" />
  </PageHeader>

  <DataTable :value="users" :loading="loading" data-key="id" scrollable table-style="min-width: 44rem">
    <Column header="User">
      <template #body="{ data }">
        <p class="font-medium">{{ data.name }}</p>
        <p class="text-muted-color text-sm">{{ data.email }}</p>
      </template>
    </Column>
    <Column header="Role">
      <template #body="{ data }">
        <Tag :severity="data.role === 'admin' ? 'info' : 'secondary'" :value="data.role === 'admin' ? 'Admin' : 'Developer'" />
      </template>
    </Column>
    <Column header="Status">
      <template #body="{ data }">
        <Tag v-if="data.disabled" severity="danger" value="Disabled" />
        <Tag v-else-if="!data.active" severity="warn" value="Invite pending" />
        <Tag v-else severity="success" value="Active" />
      </template>
    </Column>
    <Column header="Connections">
      <template #body="{ data }">
        <div class="flex flex-wrap gap-1">
          <Tag
            v-for="connection in data.connections"
            :key="connection.integrationId"
            :severity="connection.status === 'active' ? 'success' : 'warn'"
            :value="`${connection.integrationId}: ${connection.accountName}`"
            v-tooltip.top="connection.status === 'active' ? 'Connected' : 'Needs to reconnect'"
          />
          <span v-if="!data.connections.length" class="text-muted-color text-sm">None</span>
        </div>
      </template>
    </Column>
    <Column class="w-0">
      <template #body="{ data }">
        <Button icon="pi pi-ellipsis-v" text rounded size="small" aria-label="Actions" @click="openActions($event, data)" />
      </template>
    </Column>
  </DataTable>
  <Menu ref="actionsMenu" :model="menuItems" popup />

  <Dialog v-model:visible="inviteOpen" modal header="Invite user" class="w-full max-w-md">
    <form id="invite-form" class="flex flex-col gap-4" @submit.prevent="invite">
      <div class="flex flex-col gap-1">
        <label for="invite-email" class="text-sm font-medium">Email</label>
        <InputText id="invite-email" v-model="form.email" type="email" required autofocus />
      </div>
      <div class="flex flex-col gap-1">
        <label for="invite-name" class="text-sm font-medium">Name</label>
        <InputText id="invite-name" v-model="form.name" required />
      </div>
      <div class="flex flex-col gap-1">
        <label for="invite-role" class="text-sm font-medium">Role</label>
        <Select v-model="form.role" input-id="invite-role" :options="roles" option-label="label" option-value="value" fluid />
      </div>
      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>
    </form>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="inviteOpen = false" />
      <Button type="submit" form="invite-form" label="Create invite" :loading="saving" />
    </template>
  </Dialog>

  <SecretDialog
    :title="`Link for ${inviteFor}`"
    :value="inviteUrl"
    warning="Send this link to them yourself. It works once and expires in 7 days."
    @close="inviteUrl = null"
  />
</template>
