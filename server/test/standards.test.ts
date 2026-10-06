import type supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signedInUser } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let t: TestApp;
let admin: supertest.Agent;
let developer: supertest.Agent;
let repositoryId: string;

const backend = {
  slug: 'backend-standards',
  name: 'Backend standards',
  description: 'Use when writing Node services.',
  content: '# Backend standards\n\nValidate input with Zod.\n',
};

beforeAll(async () => {
  t = await createTestApp();
  admin = (await signedInUser(t.app, t.deps, { email: 'admin@example.com', name: 'Ada Admin', role: 'admin' })).agent;
  developer = (await signedInUser(t.app, t.deps, { email: 'dev@example.com', name: 'Dev', role: 'developer' })).agent;
  repositoryId = (await admin.post('/api/admin/repositories').send({ name: 'acme/api' }).expect(201)).body.repository.id;
});

afterAll(async () => {
  await t.pool.end();
});

describe('standards', () => {
  it('are admin-only', async () => {
    await developer.get('/api/admin/standards').expect(403);
    await developer.post('/api/admin/standards').send(backend).expect(403);
  });

  it('can be created, read, edited and listed without their content', async () => {
    const created = await admin.post('/api/admin/standards').send(backend).expect(201);
    expect(created.body.standard).toMatchObject({ ...backend, enabled: true, appliesToAll: true, updatedBy: 'Ada Admin' });

    const id = created.body.standard.id;
    await admin
      .put(`/api/admin/standards/${id}`)
      .send({ ...backend, content: '# Backend\n\nUpdated.\n', appliesToAll: false, repositoryIds: [repositoryId] })
      .expect(200);

    const read = await admin.get(`/api/admin/standards/${id}`).expect(200);
    expect(read.body.standard).toMatchObject({ content: '# Backend\n\nUpdated.\n', appliesToAll: false, repositoryIds: [repositoryId] });

    const list = await admin.get('/api/admin/standards').expect(200);
    expect(list.body.standards).toHaveLength(1);
    expect(list.body.standards[0]).not.toHaveProperty('content');
    expect(list.body.standards[0].contentLength).toBe('# Backend\n\nUpdated.\n'.length);
  });

  it('reject invalid input', async () => {
    await admin.post('/api/admin/standards').send({ ...backend, slug: 'Backend Standards' }).expect(400);
    await admin.post('/api/admin/standards').send({ ...backend, slug: 'empty', content: '   ' }).expect(400);
    const noRepos = await admin
      .post('/api/admin/standards')
      .send({ ...backend, slug: 'scoped', appliesToAll: false, repositoryIds: [] })
      .expect(400);
    expect(noRepos.body.error).toMatch(/at least one repository/);
    const taken = await admin.post('/api/admin/standards').send(backend).expect(409);
    expect(taken.body.error).toMatch(/already exists/);
  });

  it('can be disabled and deleted', async () => {
    const { body } = await admin.post('/api/admin/standards').send({ ...backend, slug: 'temp' }).expect(201);
    await admin.patch(`/api/admin/standards/${body.standard.id}`).send({ enabled: false }).expect(204);
    expect((await admin.get(`/api/admin/standards/${body.standard.id}`)).body.standard.enabled).toBe(false);
    await admin.delete(`/api/admin/standards/${body.standard.id}`).expect(204);
    await admin.get(`/api/admin/standards/${body.standard.id}`).expect(404);
  });

  it('lose a repository from their scope when that repository is deleted', async () => {
    const repo = (await admin.post('/api/admin/repositories').send({ name: 'acme/temp' }).expect(201)).body.repository;
    const { body } = await admin
      .post('/api/admin/standards')
      .send({ ...backend, slug: 'temp-scope', appliesToAll: false, repositoryIds: [repo.id] })
      .expect(201);
    await admin.delete(`/api/admin/repositories/${repo.id}`).expect(204);
    expect((await admin.get(`/api/admin/standards/${body.standard.id}`)).body.standard.repositoryIds).toEqual([]);
  });
});

describe('importing standards', () => {
  const frontend = { slug: 'frontend-standards', name: 'Frontend standards', content: '# Frontend\n' };

  it('creates new ones and skips existing ones unless asked to replace them', async () => {
    const skipped = await admin
      .post('/api/admin/standards/import')
      .send({ items: [frontend, { ...backend, content: '# Imported backend\n' }] })
      .expect(200);
    expect(skipped.body).toEqual({ created: ['frontend-standards'], replaced: [], skipped: ['backend-standards'] });

    const replaced = await admin
      .post('/api/admin/standards/import')
      .send({ items: [{ ...backend, content: '# Imported backend\n' }], replaceExisting: true })
      .expect(200);
    expect(replaced.body).toEqual({ created: [], replaced: ['backend-standards'], skipped: [] });

    const list = (await admin.get('/api/admin/standards')).body.standards as { slug: string; id: string }[];
    const backendId = list.find((s) => s.slug === 'backend-standards')!.id;
    const standard = (await admin.get(`/api/admin/standards/${backendId}`)).body.standard;
    // Replacing changes the text but keeps the scope chosen earlier.
    expect(standard).toMatchObject({ content: '# Imported backend\n', appliesToAll: false, repositoryIds: [repositoryId] });
  });

  it('refuses two files that map to the same standard', async () => {
    const res = await admin
      .post('/api/admin/standards/import')
      .send({ items: [{ ...frontend, slug: 'git' }, { ...frontend, slug: 'git' }] })
      .expect(400);
    expect(res.body.error).toMatch(/"git"/);
  });
});

