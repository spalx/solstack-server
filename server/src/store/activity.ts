import type { Pool } from '../db/pool.js';

export interface ToolCallRecord {
  userId: string;
  integrationId: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface ToolCallEntry {
  id: string;
  userEmail: string | null;
  integrationId: string | null;
  tool: string;
  ok: boolean;
  durationMs: number;
  error: string | null;
  createdAt: Date;
}

export class ActivityStore {
  constructor(private readonly pool: Pool) {}

  async record(call: ToolCallRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO tool_calls (user_id, integration_id, tool, ok, duration_ms, error) VALUES ($1, $2, $3, $4, $5, $6)',
      [call.userId, call.integrationId, call.tool, call.ok, call.durationMs, call.error?.slice(0, 500) ?? null],
    );
  }

  async recent(limit: number): Promise<ToolCallEntry[]> {
    const { rows } = await this.pool.query<{
      id: string;
      email: string | null;
      integration_id: string | null;
      tool: string;
      ok: boolean;
      duration_ms: number;
      error: string | null;
      created_at: Date;
    }>(
      `SELECT tool_calls.*, users.email FROM tool_calls LEFT JOIN users ON users.id = tool_calls.user_id
       ORDER BY tool_calls.created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: row.id,
      userEmail: row.email,
      integrationId: row.integration_id,
      tool: row.tool,
      ok: row.ok,
      durationMs: row.duration_ms,
      error: row.error,
      createdAt: row.created_at,
    }));
  }

  async countSince(since: Date): Promise<{ total: number; failed: number }> {
    const { rows } = await this.pool.query<{ total: string; failed: string }>(
      'SELECT count(*) AS total, count(*) FILTER (WHERE NOT ok) AS failed FROM tool_calls WHERE created_at >= $1',
      [since],
    );
    return { total: Number(rows[0]!.total), failed: Number(rows[0]!.failed) };
  }
}
