import type { Pool } from '../db/pool.js';
import { generateToken, hashToken, TOKEN_PREFIX } from '../crypto.js';

export class SessionStore {
  constructor(private readonly pool: Pool) {}

  async create(userId: string, ttlMs: number): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken(TOKEN_PREFIX.session);
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      userId,
      expiresAt,
    ]);
    return { token, expiresAt };
  }

  async findUserId(token: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()',
      [hashToken(token)],
    );
    return rows[0]?.user_id ?? null;
  }

  async delete(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  /** Removes expired sessions, OAuth states and invites. */
  async purgeExpired(): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= now()');
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at <= now()');
    await this.pool.query('DELETE FROM invites WHERE expires_at <= now()');
  }
}
