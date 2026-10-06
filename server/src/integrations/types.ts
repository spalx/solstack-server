import type { z } from 'zod';

/** A value the admin fills in when configuring an integration. Secret fields are stored encrypted and never returned. */
export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'select';
  required: boolean;
  default?: string;
  options?: { label: string; value: string }[];
  help?: string;
}

/** Something the admin has to copy into the provider's developer console. */
export interface SetupStep {
  label: string;
  value: string;
  help?: string;
}

/** A developer's credentials for one integration. Stored encrypted. */
export interface Credentials {
  accessToken: string;
  refreshToken?: string;
  /** ISO timestamp; absent when the token does not expire. */
  expiresAt?: string;
}

export interface AuthorizationResult {
  credentials: Credentials;
  accountName: string;
  scopes?: string;
}

export interface IntegrationContext {
  baseUrl: string;
  /** Admin settings and secrets, merged, with defaults applied. */
  config: Record<string, string>;
  fetch: typeof fetch;
}

export interface ToolContext extends IntegrationContext {
  credentials: Credentials;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  readOnly: boolean;
  run(args: Record<string, unknown>, context: ToolContext): Promise<unknown>;
}

export interface Integration {
  id: string;
  name: string;
  description: string;
  fields: SettingField[];
  setupSteps(baseUrl: string): SetupStep[];
  /** Where to send the developer's browser to start authorizing. */
  authorizeUrl(context: IntegrationContext, state: string): string;
  /** Turns what the provider handed back (an OAuth code, a token, ...) into stored credentials. */
  completeAuthorization(context: IntegrationContext, params: Record<string, string>): Promise<AuthorizationResult>;
  /** Exchanges a refresh token for new credentials. Integrations whose tokens never expire omit it. */
  refresh?(context: IntegrationContext, credentials: Credentials): Promise<Credentials>;
  tools: Tool[];
}

/** Thrown when a provider rejects a request. A 401 marks the developer's connection as needing re-authorization. */
export class UpstreamError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function defineTool<Shape extends z.ZodRawShape>(tool: {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  readOnly: boolean;
  run(args: z.infer<z.ZodObject<Shape>>, context: ToolContext): Promise<unknown>;
}): Tool {
  return tool as unknown as Tool;
}

export async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body = JSON.parse(text) as { message?: string; error?: string };
    return body.message ?? body.error ?? (text || response.statusText);
  } catch {
    return text.slice(0, 300) || response.statusText;
  }
}
