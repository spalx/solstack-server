import type { Pool } from '../db/pool.js';
import type { SecretBox } from '../crypto.js';

export interface IntegrationRecord {
  enabled: boolean;
  settings: Record<string, string>;
  secrets: Record<string, string>;
}

const EMPTY: IntegrationRecord = { enabled: false, settings: {}, secrets: {} };

export class IntegrationStore {
  constructor(
    private readonly pool: Pool,
    private readonly box: SecretBox,
  ) {}

  async getAll(): Promise<Map<string, IntegrationRecord>> {
    const { rows } = await this.pool.query<{
      id: string;
      enabled: boolean;
      settings: Record<string, string>;
      secrets: string | null;
    }>('SELECT id, enabled, settings, secrets FROM integrations');
    return new Map(
      rows.map((row) => [
        row.id,
        {
          enabled: row.enabled,
          settings: row.settings,
          secrets: row.secrets ? this.box.openJson<Record<string, string>>(row.secrets) : {},
        },
      ]),
    );
  }

  async get(id: string): Promise<IntegrationRecord> {
    return (await this.getAll()).get(id) ?? EMPTY;
  }

  async save(id: string, record: IntegrationRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO integrations (id, enabled, settings, secrets, updated_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET enabled = $2, settings = $3, secrets = $4, updated_at = now()`,
      [id, record.enabled, JSON.stringify(record.settings), this.box.sealJson(record.secrets)],
    );
  }
}
