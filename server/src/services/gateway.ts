import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { UpstreamError, type Credentials, type Tool } from '../integrations/types.js';
import type { Stores } from '../store/index.js';
import type { User } from '../store/users.js';
import type { IntegrationState } from './integrations.js';

/** Refresh a little before expiry so a token doesn't expire mid-request. */
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

/** Runs integration tools on behalf of a developer, using that developer's own credentials. */
export class Gateway {
  constructor(
    private readonly stores: Stores,
    private readonly baseUrl: string,
  ) {}

  async callTool(user: User, state: IntegrationState, tool: Tool, args: Record<string, unknown>): Promise<CallToolResult> {
    const started = Date.now();
    const { integration } = state;
    const record = (ok: boolean, error?: string) =>
      this.stores.activity
        .record({ userId: user.id, integrationId: integration.id, tool: tool.name, ok, durationMs: Date.now() - started, error })
        .catch((failure) => console.error('Failed to record tool call', failure));

    const connectHint = `Connect it at ${this.baseUrl}/connections and try again.`;
    const connection = await this.stores.connections.get(user.id, integration.id);
    if (!connection) {
      await record(false, 'not_connected');
      return errorResult(`${integration.name} is not connected for ${user.email}. ${connectHint}`);
    }
    if (connection.status === 'invalid') {
      await record(false, 'connection_invalid');
      return errorResult(`The ${integration.name} authorization for ${user.email} has expired or was revoked. ${connectHint}`);
    }

    try {
      const credentials = await this.freshCredentials(user.id, state, connection.credentials);
      const result = await tool.run(args, { ...state.context, credentials });
      await record(true);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof UpstreamError && error.status === 401) {
        await this.stores.connections.markInvalid(user.id, integration.id);
        await record(false, message);
        return errorResult(`${integration.name} rejected the stored authorization. ${connectHint}`);
      }
      await record(false, message);
      return errorResult(message);
    }
  }

  private async freshCredentials(userId: string, state: IntegrationState, credentials: Credentials): Promise<Credentials> {
    if (!credentials.expiresAt || Date.parse(credentials.expiresAt) - REFRESH_MARGIN_MS > Date.now()) return credentials;
    if (!state.integration.refresh) {
      throw new UpstreamError(state.integration.name, 401, `${state.integration.name} token expired`);
    }
    const refreshed = await state.integration.refresh(state.context, credentials).catch((error: unknown) => {
      // Any refresh failure means the developer has to authorize again.
      throw new UpstreamError(state.integration.name, 401, error instanceof Error ? error.message : 'Token refresh failed');
    });
    await this.stores.connections.updateCredentials(userId, state.integration.id, refreshed);
    return refreshed;
  }
}
