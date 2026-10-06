import { createRouter, createWebHistory } from 'vue-router';
import { loadSession } from './session';

declare module 'vue-router' {
  interface RouteMeta {
    /** Reachable without signing in. */
    public?: boolean;
    admin?: boolean;
    title?: string;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/connections' },
    { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: 'Sign in' } },
    { path: '/invite/:token', component: () => import('./views/InviteView.vue'), meta: { public: true, title: 'Set your password' } },
    { path: '/connections', component: () => import('./views/ConnectionsView.vue'), meta: { title: 'Connections' } },
    { path: '/connect/:id', component: () => import('./views/ConnectCallbackView.vue'), meta: { title: 'Connecting' } },
    { path: '/access', component: () => import('./views/AccessView.vue'), meta: { title: 'Agent access' } },
    { path: '/admin', component: () => import('./views/admin/OverviewView.vue'), meta: { admin: true, title: 'Overview' } },
    {
      path: '/admin/integrations',
      component: () => import('./views/admin/IntegrationsView.vue'),
      meta: { admin: true, title: 'Integrations' },
    },
    {
      path: '/admin/repositories',
      component: () => import('./views/admin/RepositoriesView.vue'),
      meta: { admin: true, title: 'Repositories' },
    },
    { path: '/admin/users', component: () => import('./views/admin/UsersView.vue'), meta: { admin: true, title: 'Users' } },
    { path: '/admin/activity', component: () => import('./views/admin/ActivityView.vue'), meta: { admin: true, title: 'Activity' } },
    { path: '/:pathMatch(.*)*', redirect: '/connections' },
  ],
});

router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  const user = await loadSession();
  if (!user) return { path: '/login', query: { next: to.fullPath } };
  if (to.meta.admin && user.role !== 'admin') return '/connections';
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Harness` : 'Harness';
});
