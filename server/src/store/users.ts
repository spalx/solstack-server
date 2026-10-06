import type { Pool } from '../db/pool.js';
import { generateToken, hashToken, TOKEN_PREFIX } from '../crypto.js';

export type Role = 'admin' | 'developer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  /** False until the user accepts their invite and sets a password. */
  active: boolean;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
  password_hash: string | null;
  created_at: Date;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    disabled: row.disabled,
    active: row.password_hash !== null,
    createdAt: row.created_at,
  };
}

export class UserStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<User[]> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users ORDER BY created_at');
    return rows.map(toUser);
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findCredentials(email: string): Promise<{ user: User; passwordHash: string | null } | null> {
    const { rows } = await this.pool.query<UserRow>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const row = rows[0];
    return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
  }

  async create(input: { email: string; name: string; role: Role }): Promise<User> {
    const { rows } = await this.pool.query<UserRow>(
      'INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING *',
      [input.email.toLowerCase(), input.name, input.role],
    );
    return toUser(rows[0]!);
  }

  async update(id: string, changes: { name?: string; role?: Role; disabled?: boolean }): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `UPDATE users SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         disabled = COALESCE($4, disabled)
       WHERE id = $1 RETURNING *`,
      [id, changes.name ?? null, changes.role ?? null, changes.disabled ?? null],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, passwordHash]);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM users WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async countAdmins(): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      "SELECT count(*) FROM users WHERE role = 'admin' AND NOT disabled",
    );
    return Number(rows[0]!.count);
  }

  /** Replaces any previous invite for the user and returns the new plaintext invite token. */
  async createInvite(userId: string): Promise<string> {
    const token = generateToken(TOKEN_PREFIX.invite);
    await this.pool.query('DELETE FROM invites WHERE user_id = $1', [userId]);
    await this.pool.query('INSERT INTO invites (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
      hashToken(token),
      userId,
      new Date(Date.now() + INVITE_TTL_MS),
    ]);
    return token;
  }

  async findByInvite(token: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT users.* FROM invites JOIN users ON users.id = invites.user_id
       WHERE invites.token_hash = $1 AND invites.expires_at > now() AND NOT users.disabled`,
      [hashToken(token)],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async consumeInvite(token: string): Promise<void> {
    await this.pool.query('DELETE FROM invites WHERE token_hash = $1', [hashToken(token)]);
  }
}
