<script setup lang="ts">
import Button from 'primevue/button';
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { currentUser, signOut } from '../session';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const route = useRoute();
const router = useRouter();
const menuOpen = ref(false);

const developerNav: NavItem[] = [
  { to: '/connections', label: 'Connections', icon: 'pi pi-link' },
  { to: '/access', label: 'Agent access', icon: 'pi pi-key' },
];

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: 'pi pi-chart-bar' },
  { to: '/admin/integrations', label: 'Integrations', icon: 'pi pi-th-large' },
  { to: '/admin/repositories', label: 'Repositories', icon: 'pi pi-book' },
  { to: '/admin/users', label: 'Users', icon: 'pi pi-users' },
  { to: '/admin/activity', label: 'Activity', icon: 'pi pi-history' },
];

const isAdmin = computed(() => currentUser.value?.role === 'admin');

watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

function isActive(item: NavItem): boolean {
  return item.to === '/admin' ? route.path === '/admin' : route.path.startsWith(item.to);
}

async function logout() {
  await signOut();
  await router.push('/login');
}
</script>

<template>
  <div class="min-h-screen md:flex">
    <header
      class="flex items-center justify-between border-b border-surface-200 bg-surface-0 px-4 py-3 md:hidden dark:border-surface-800 dark:bg-surface-900"
    >
      <span class="font-semibold">Solstack</span>
      <Button
        :icon="menuOpen ? 'pi pi-times' : 'pi pi-bars'"
        text
        rounded
        aria-label="Toggle navigation"
        @click="menuOpen = !menuOpen"
      />
    </header>

    <aside
      :class="[menuOpen ? 'block' : 'hidden', 'md:block']"
      class="border-b border-surface-200 bg-surface-0 md:sticky md:top-0 md:h-screen md:w-64 md:shrink-0 md:border-r md:border-b-0 dark:border-surface-800 dark:bg-surface-900"
    >
      <div class="flex h-full flex-col p-4">
        <div class="mb-6 hidden items-center gap-2 px-2 md:flex">
          <i class="pi pi-sitemap text-primary text-xl" />
          <span class="text-lg font-semibold">Solstack</span>
        </div>

        <nav class="flex flex-col gap-1">
          <RouterLink
            v-for="item in developerNav"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
            :class="isActive(item) ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300' : 'hover:bg-surface-100 dark:hover:bg-surface-800'"
          >
            <i :class="item.icon" />
            {{ item.label }}
          </RouterLink>

          <template v-if="isAdmin">
            <p class="text-muted-color mt-5 mb-1 px-3 text-xs font-semibold tracking-wide uppercase">Administration</p>
            <RouterLink
              v-for="item in adminNav"
              :key="item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
              :class="isActive(item) ? 'bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300' : 'hover:bg-surface-100 dark:hover:bg-surface-800'"
            >
              <i :class="item.icon" />
              {{ item.label }}
            </RouterLink>
          </template>
        </nav>

        <div class="mt-6 border-t border-surface-200 pt-4 md:mt-auto dark:border-surface-800">
          <p class="truncate px-2 text-sm font-medium">{{ currentUser?.name }}</p>
          <p class="text-muted-color truncate px-2 text-xs">{{ currentUser?.email }}</p>
          <Button label="Sign out" icon="pi pi-sign-out" text size="small" class="mt-2" @click="logout" />
        </div>
      </div>
    </aside>

    <main class="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
      <div class="mx-auto max-w-5xl">
        <slot />
      </div>
    </main>
  </div>
</template>
