import type { Pool } from '../db/pool.js';
import type { IntakeTarget } from '../intake.js';

/** What a guidance document is for. All kinds are delivered to agents as skills. */
export type GuidanceKind = 'standard' | 'intake' | 'context';

export interface StandardSummary {
  id: string;
  kind: GuidanceKind;
  /** The built-in intake section this document fills, if any. */
  target: IntakeTarget | null;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  appliesToAll: boolean;
  repositoryIds: string[];
  contentLength: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Standard extends StandardSummary {
  content: string;
}

export interface StandardInput {
  kind: GuidanceKind;
  target: IntakeTarget | null;
  slug: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  appliesToAll: boolean;
  repositoryIds: string[];
}

interface StandardRow {
  id: string;
  kind: GuidanceKind;
  target: IntakeTarget | null;
  slug: string;
  name: string;
  description: string;
  content?: string;
  content_length: number;
  enabled: boolean;
  applies_to_all: boolean;
  repository_ids: string[];
  updated_by_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  SELECT standards.id, standards.kind, standards.target, standards.slug, standards.name, standards.description, standards.enabled,
         standards.applies_to_all, standards.created_at, standards.updated_at,
         length(standards.content) AS content_length,
         users.name AS updated_by_name,
         COALESCE(array_agg(sr.repository_id) FILTER (WHERE sr.repository_id IS NOT NULL), '{}') AS repository_ids`;

const FROM = `
  FROM standards
  LEFT JOIN users ON users.id = standards.updated_by
  LEFT JOIN standard_repositories sr ON sr.standard_id = standards.id`;

const GROUP = 'GROUP BY standards.id, users.name';

function toSummary(row: StandardRow): StandardSummary {
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    slug: row.slug,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    appliesToAll: row.applies_to_all,
    repositoryIds: row.repository_ids,
    contentLength: row.content_length,
    updatedBy: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class StandardStore {
  constructor(private readonly pool: Pool) {}

  async list(kind: GuidanceKind): Promise<StandardSummary[]> {
    const { rows } = await this.pool.query<StandardRow>(
      `${SELECT} ${FROM} WHERE standards.kind = $1 ${GROUP} ORDER BY standards.name`,
      [kind],
    );
    return rows.map(toSummary);
  }

  async findById(id: string): Promise<Standard | null> {
    const { rows } = await this.pool.query<StandardRow>(
      `${SELECT}, standards.content ${FROM} WHERE standards.id = $1 ${GROUP}`,
      [id],
    );
    const row = rows[0];
    return row ? { ...toSummary(row), content: row.content ?? '' } : null;
  }

  /**
   * Enabled documents that apply to a repository, with their content, for delivery to agents. Without a
   * repository only documents that apply to all repositories are returned.
   */
  async listForRepository(repositoryId: string | null, kind?: GuidanceKind): Promise<Standard[]> {
    const { rows } = await this.pool.query<StandardRow>(
      `${SELECT}, standards.content ${FROM}
       WHERE standards.enabled
         AND ($2::text IS NULL OR standards.kind = $2)
         AND (standards.applies_to_all OR EXISTS (
           SELECT 1 FROM standard_repositories own
           WHERE own.standard_id = standards.id AND own.repository_id = $1))
       ${GROUP} ORDER BY standards.slug`,
      [repositoryId, kind ?? null],
    );
    return rows.map((row) => ({ ...toSummary(row), content: row.content ?? '' }));
  }

  async findBySlug(slugs: string[]): Promise<Map<string, { id: string; kind: GuidanceKind; target: IntakeTarget | null }>> {
    const { rows } = await this.pool.query<{ id: string; slug: string; kind: GuidanceKind; target: IntakeTarget | null }>(
      'SELECT id, slug, kind, target FROM standards WHERE slug = ANY($1)',
      [slugs],
    );
    return new Map(rows.map(({ slug, ...row }) => [slug, row]));
  }

  async create(input: StandardInput, userId: string): Promise<Standard> {
    return this.transaction(async (query) => {
      const { rows } = await query<{ id: string }>(
        `INSERT INTO standards (kind, target, slug, name, description, content, enabled, applies_to_all, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          input.kind,
          input.target,
          input.slug,
          input.name,
          input.description,
          input.content,
          input.enabled,
          input.appliesToAll,
          userId,
        ],
      );
      const id = rows[0]!.id;
      await this.replaceRepositories(query, id, input);
      return id;
    }).then((id) => this.findById(id) as Promise<Standard>);
  }

  /** Kind and intake section are fixed when a document is created; everything else can change. */
  async update(id: string, input: Omit<StandardInput, 'kind' | 'target'>, userId: string): Promise<Standard | null> {
    const updated = await this.transaction(async (query) => {
      const result = await query(
        `UPDATE standards SET slug = $2, name = $3, description = $4, content = $5, enabled = $6,
           applies_to_all = $7, updated_by = $8, updated_at = now()
         WHERE id = $1`,
        [id, input.slug, input.name, input.description, input.content, input.enabled, input.appliesToAll, userId],
      );
      if (result.rowCount !== 1) return false;
      await this.replaceRepositories(query, id, input);
      return true;
    });
    return updated ? this.findById(id) : null;
  }

  /** Replaces a standard's text while keeping its scope and whether it is enabled. */
  async replaceContent(
    id: string,
    input: Pick<StandardInput, 'name' | 'description' | 'content'>,
    userId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE standards SET name = $2, description = $3, content = $4, updated_by = $5, updated_at = now()
       WHERE id = $1`,
      [id, input.name, input.description, input.content, userId],
    );
  }

  async setEnabled(id: string, enabled: boolean, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE standards SET enabled = $2, updated_by = $3, updated_at = now() WHERE id = $1',
      [id, enabled, userId],
    );
    return result.rowCount === 1;
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM standards WHERE id = $1', [id]);
    return result.rowCount === 1;
  }

  private async replaceRepositories(
    query: Query,
    id: string,
    input: Pick<StandardInput, 'appliesToAll' | 'repositoryIds'>,
  ): Promise<void> {
    await query('DELETE FROM standard_repositories WHERE standard_id = $1', [id]);
    if (!input.appliesToAll && input.repositoryIds.length) {
      await query(
        'INSERT INTO standard_repositories (standard_id, repository_id) SELECT $1, unnest($2::uuid[])',
        [id, input.repositoryIds],
      );
    }
  }

  private async transaction<T>(work: (query: Query) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work((text, values) => client.query(text, values));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

type Query = <R extends object = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: R[]; rowCount: number | null }>;
