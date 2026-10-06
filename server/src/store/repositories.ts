import type { Pool } from '../db/pool.js';
import { generateToken, hashToken, TOKEN_PREFIX, tokenDisplayPrefix } from '../crypto.js';

export interface Repository {
  id: string;
  name: string;
  gitUrl: string | null;
  agents: string[];
  requiredIntegrations: string[];
  apiKeyPrefix: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryInput {
  name: string;
  gitUrl: string | null;
  agents: string[];
  requiredIntegrations: string[];
}

interface RepositoryRow {
  id: string;
  name: string;
  git_url: string | null;
  agents: string[];
  required_integrations: string[];
  api_key_prefix: string;
  created_at: Date;
  updated_at: Date;
}

function toRepository(row: RepositoryRow): Repository {
  return {
    id: row.id,
    name: row.name,
    gitUrl: row.git_url,
    agents: row.agents,
    requiredIntegrations: row.required_integrations,
    apiKeyPrefix: row.api_key_prefix,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RepositoryStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<Repository[]> {
    const { rows } = await this.pool.query<RepositoryRow>('SELECT * FROM repositories ORDER BY name');
    return rows.map(toRepository);
  }

  async findById(id: string): Promise<Repository | null> {
    const { rows } = await this.pool.query<RepositoryRow>('SELECT * FROM repositories WHERE id = $1', [id]);
    return rows[0] ? toRepository(rows[0]) : null;
  }

  async findByName(name: string): Promise<Repository | null> {
    const { rows } = await this.pool.query<RepositoryRow>('SELECT * FROM repositories WHERE name = $1', [name]);
    return rows[0] ? toRepository(rows[0]) : null;
  }

  async create(input: RepositoryInput): Promise<{ repository: Repository; apiKey: string }> {
    const apiKey = generateToken(TOKEN_PREFIX.repository);
    const { rows } = await this.pool.query<RepositoryRow>(
      `INSERT INTO repositories (name, git_url, agents, required_integrations, api_key_hash, api_key_prefix)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [input.name, input.gitUrl, input.agents, input.requiredIntegrations, hashToken(apiKey), tokenDisplayPrefix(apiKey)],
    );
    return { repository: toRepository(rows[0]!), apiKey };
  }

  async update(id: string, input: RepositoryInput): Promise<Repository | null> {
    const { rows } = await this.pool.query<RepositoryRow>(
      `UPDATE repositories SET name = $2, git_url = $3, agents = $4, required_integrations = $5, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, input.name, input.gitUrl, input.agents, input.requiredIntegrations],
    );
    return rows[0] ? toRepository(rows[0]) : null;
  }

  async rotateKey(id: string): Promise<string | null> {
    const apiKey = generateToken(TOKEN_PREFIX.repository);
    const result = await this.pool.query(
      'UPDATE repositories SET api_key_hash = $2, api_key_prefix = $3, updated_at = now() WHERE id = $1',
      [id, hashToken(apiKey), tokenDisplayPrefix(apiKey)],
    );
    return result.rowCount === 1 ? apiKey : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM repositories WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  async authenticate(apiKey: string): Promise<Repository | null> {
    const { rows } = await this.pool.query<RepositoryRow>('SELECT * FROM repositories WHERE api_key_hash = $1', [
      hashToken(apiKey),
    ]);
    return rows[0] ? toRepository(rows[0]) : null;
  }
}
