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
    ...(
      [
        ['standard', '/admin/standards', 'Standards'],
        ['intake', '/admin/intake', 'Intake'],
        ['context', '/admin/context', 'Product context'],
      ] as const
    ).flatMap(([kind, path, title]) => [
      {
        path,
        component:
          kind === 'intake' ? () => import('./views/admin/IntakeView.vue') : () => import('./views/admin/StandardsView.vue'),
        props: kind === 'intake' ? {} : { kind },
        meta: { admin: true, title },
      },
      {
        path: `${path}/new`,
        component: () => import('./views/admin/StandardEditorView.vue'),
        props: { kind },
        meta: { admin: true, title },
      },
      {
        path: `${path}/:id`,
        component: () => import('./views/admin/StandardEditorView.vue'),
        props: { kind },
        meta: { admin: true, title },
      },
    ]),
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

// After a deploy (or a dev-server restart) an open tab may ask for code chunks that no longer exist.
// Loading the page fresh picks up the new ones instead of leaving a blank screen. Only once a minute,
// so a chunk that is really broken shows an error instead of reloading forever.
const RELOAD_KEY = 'solstack:chunk-reload';
router.onError((error, to) => {
  if (!/dynamically imported module|Importing a module script failed/i.test(String((error as Error)?.message))) return;
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  window.location.assign(to.fullPath);
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · Solstack` : 'Solstack';
});
