import type { Pool } from '../db/pool.js';
import { generateToken, hashToken, TOKEN_PREFIX, type SecretBox } from '../crypto.js';
import type { Credentials } from '../integrations/types.js';

export type ConnectionStatus = 'active' | 'invalid';

export interface Connection {
  userId: string;
  integrationId: string;
  accountName: string;
  scopes: string | null;
  status: ConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionWithCredentials extends Connection {
  credentials: Credentials;
}

interface ConnectionRow {
  user_id: string;
  integration_id: string;
  credentials: string;
  account_name: string;
  scopes: string | null;
  status: ConnectionStatus;
  created_at: Date;
  updated_at: Date;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function toConnection(row: ConnectionRow): Connection {
  return {
    userId: row.user_id,
    integrationId: row.integration_id,
    accountName: row.account_name,
    scopes: row.scopes,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ConnectionStore {
  constructor(
    private readonly pool: Pool,
    private readonly box: SecretBox,
  ) {}

  async listForUser(userId: string): Promise<Connection[]> {
    const { rows } = await this.pool.query<ConnectionRow>('SELECT * FROM connections WHERE user_id = $1', [userId]);
    return rows.map(toConnection);
  }

  async listAll(): Promise<Connection[]> {
    const { rows } = await this.pool.query<ConnectionRow>('SELECT * FROM connections');
    return rows.map(toConnection);
  }

  async get(userId: string, integrationId: string): Promise<ConnectionWithCredentials | null> {
    const { rows } = await this.pool.query<ConnectionRow>(
      'SELECT * FROM connections WHERE user_id = $1 AND integration_id = $2',
      [userId, integrationId],
    );
    const row = rows[0];
    return row ? { ...toConnection(row), credentials: this.box.openJson<Credentials>(row.credentials) } : null;
  }

  async upsert(input: {
    userId: string;
    integrationId: string;
    credentials: Credentials;
    accountName: string;
    scopes?: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO connections (user_id, integration_id, credentials, account_name, scopes, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (user_id, integration_id) DO UPDATE SET
         credentials = $3, account_name = $4, scopes = $5, status = 'active', updated_at = now()`,
      [input.userId, input.integrationId, this.box.sealJson(input.credentials), input.accountName, input.scopes ?? null],
    );
  }

  async updateCredentials(userId: string, integrationId: string, credentials: Credentials): Promise<void> {
    await this.pool.query(
      'UPDATE connections SET credentials = $3, updated_at = now() WHERE user_id = $1 AND integration_id = $2',
      [userId, integrationId, this.box.sealJson(credentials)],
    );
  }

  async markInvalid(userId: string, integrationId: string): Promise<void> {
    await this.pool.query(
      "UPDATE connections SET status = 'invalid', updated_at = now() WHERE user_id = $1 AND integration_id = $2",
      [userId, integrationId],
    );
  }

  async delete(userId: string, integrationId: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM connections WHERE user_id = $1 AND integration_id = $2', [
      userId,
      integrationId,
    ]);
    return result.rowCount === 1;
  }

  /** Creates the anti-forgery state for an authorization flow, bound to the user and integration. */
  async createState(userId: string, integrationId: string): Promise<string> {
    const state = generateToken(TOKEN_PREFIX.state);
    await this.pool.query(
      'INSERT INTO oauth_states (state_hash, user_id, integration_id, expires_at) VALUES ($1, $2, $3, $4)',
      [hashToken(state), userId, integrationId, new Date(Date.now() + STATE_TTL_MS)],
    );
    return state;
  }

  /** Single use: returns true only if the state was issued for this user and integration and has not expired. */
  async consumeState(state: string, userId: string, integrationId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ user_id: string; integration_id: string }>(
      'DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, integration_id',
      [hashToken(state)],
    );
    const row = rows[0];
    return row !== undefined && row.user_id === userId && row.integration_id === integrationId;
  }
}
