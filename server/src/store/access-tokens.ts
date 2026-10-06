import type { Pool } from '../db/pool.js';
import { generateToken, hashToken, TOKEN_PREFIX, tokenDisplayPrefix } from '../crypto.js';

export interface AccessToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface AccessTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  created_at: Date;
  last_used_at: Date | null;
}

function toAccessToken(row: AccessTokenRow): AccessToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

export class AccessTokenStore {
  constructor(private readonly pool: Pool) {}

  async listForUser(userId: string): Promise<AccessToken[]> {
    const { rows } = await this.pool.query<AccessTokenRow>(
      'SELECT * FROM access_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC',
      [userId],
    );
    return rows.map(toAccessToken);
  }

  async create(userId: string, name: string): Promise<{ token: string; accessToken: AccessToken }> {
    const token = generateToken(TOKEN_PREFIX.developer);
    const { rows } = await this.pool.query<AccessTokenRow>(
      'INSERT INTO access_tokens (user_id, name, token_hash, token_prefix) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, name, hashToken(token), tokenDisplayPrefix(token)],
    );
    return { token, accessToken: toAccessToken(rows[0]!) };
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE access_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [id, userId],
    );
    return result.rowCount === 1;
  }

  /** Resolves a token to its owner and records the use. */
  async authenticate(token: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `UPDATE access_tokens SET last_used_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL RETURNING user_id`,
      [hashToken(token)],
    );
    return rows[0]?.user_id ?? null;
  }
}
