import { ref } from 'vue';
import { api, ApiError } from './api';
import type { SessionUser } from './types';

export const currentUser = ref<SessionUser | null>(null);
let loaded = false;

export async function loadSession(): Promise<SessionUser | null> {
  if (loaded) return currentUser.value;
  try {
    currentUser.value = (await api.get<{ user: SessionUser }>('/auth/me')).user;
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 401)) throw error;
    currentUser.value = null;
  }
  loaded = true;
  return currentUser.value;
}

export function setSession(user: SessionUser | null): void {
  currentUser.value = user;
  loaded = true;
}

export async function signOut(): Promise<void> {
  await api.post('/auth/logout');
  setSession(null);
}
