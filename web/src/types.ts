export type Role = 'admin' | 'developer';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select';
  required: boolean;
  default?: string;
  options?: { label: string; value: string }[];
  help?: string;
}

export interface IntegrationView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  fields: SettingField[];
  values: Record<string, string>;
  secretsSet: Record<string, boolean>;
  setup: { label: string; value: string; help?: string }[];
}

export interface ConnectionStatus {
  id: string;
  name: string;
  description: string;
  connected: boolean;
  status: 'active' | 'invalid' | null;
  accountName: string | null;
  connectedAt: string | null;
}

export interface Repository {
  id: string;
  name: string;
  gitUrl: string | null;
  agents: string[];
  requiredIntegrations: string[];
  apiKeyPrefix: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeveloperRepository {
  id: string;
  name: string;
  gitUrl: string | null;
  agents: string[];
  requiredIntegrations: string[];
  missingIntegrations: string[];
}

export interface Catalog {
  agents: { id: string; name: string }[];
  integrations: { id: string; name: string }[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  active: boolean;
  createdAt: string;
  connections: { integrationId: string; accountName: string; status: 'active' | 'invalid' }[];
}

export interface AccessToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ToolCall {
  id: string;
  userEmail: string | null;
  integrationId: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  createdAt: string;
}

export interface Overview {
  users: { total: number; pendingInvites: number };
  repositories: number;
  toolCallsLast24h: { total: number; failed: number };
  integrations: { id: string; name: string; enabled: boolean; configured: boolean; connectedUsers: number }[];
}

export interface StandardSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  appliesToAll: boolean;
  repositoryIds: string[];
  contentLength: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Standard extends StandardSummary {
  content: string;
}
