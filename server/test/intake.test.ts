import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, mcpRequest, signedInUser } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let t: TestApp;
let admin: supertest.Agent;
let developerToken: string;
let apiRepo: string;
let webRepo: string;

const TASK_RULES = '# Opening tasks\n\nTitle: imperative, under 70 characters.\nAlways add the `needs-triage` label.\n';

function mcp(body: unknown, repository?: string) {
  const request = supertest(t.app)
    .post('/mcp')
    .set('Authorization', `Bearer ${developerToken}`)
    .set('Accept', 'application/json, text/event-stream');
  if (repository) request.set('X-Solstack-Repository', repository);
  return request.send(body as object);
}

async function toolDescriptions(repository?: string): Promise<Map<string, string>> {
  const res = await mcp(mcpRequest('tools/list'), repository).expect(200);
  return new Map(res.body.result.tools.map((tool: { name: string; description: string }) => [tool.name, tool.description]));
}

beforeAll(async () => {
  t = await createTestApp();
  admin = (await signedInUser(t.app, t.deps, { email: 'admin@example.com', name: 'Admin', role: 'admin' })).agent;
  const developer = (await signedInUser(t.app, t.deps, { email: 'dev@example.com', name: 'Dev', role: 'developer' })).agent;
  developerToken = (await developer.post('/api/me/tokens').send({ name: 'cli' }).expect(201)).body.token;
  apiRepo = (await admin.post('/api/admin/repositories').send({ name: 'acme/api' }).expect(201)).body.repository.id;
  webRepo = (await admin.post('/api/admin/repositories').send({ name: 'acme/web' }).expect(201)).body.repository.id;
  await admin
    .put('/api/admin/integrations/github')
    .send({ enabled: true, values: { clientId: 'id', clientSecret: 'secret' } })
    .expect(200);
});

afterAll(async () => {
  await t.pool.end();
});

describe('intake sections', () => {
  it('lists the four built-in sections, empty at first', async () => {
    const res = await admin.get('/api/admin/intake/sections').expect(200);
    expect(res.body.sections.map((s: { target: string; rule: unknown }) => [s.target, s.rule])).toEqual([
      ['tasks', null],
      ['comments', null],
      ['pull_requests', null],
      ['commits', null],
    ]);
  });

  it('fills a section with a fixed name and ID that cannot be changed', async () => {
    const created = await admin
      .post('/api/admin/standards')
      .send({ kind: 'intake', target: 'tasks', content: TASK_RULES })
      .expect(201);
    expect(created.body.standard).toMatchObject({
      kind: 'intake',
      target: 'tasks',
      slug: 'intake-tasks',
      name: 'Opening tasks',
      description: expect.stringContaining('opening a task'),
    });

    await admin.post('/api/admin/standards').send({ kind: 'intake', target: 'tasks', content: '# Again\n' }).expect(409);

    const edited = await admin
      .put(`/api/admin/standards/${created.body.standard.id}`)
      .send({ slug: 'renamed', name: 'Renamed', description: 'Mine', content: TASK_RULES })
      .expect(200);
    expect(edited.body.standard).toMatchObject({ slug: 'intake-tasks', name: 'Opening tasks', description: 'Mine' });

    const sections = (await admin.get('/api/admin/intake/sections').expect(200)).body.sections;
    expect(sections[0].rule).toMatchObject({ slug: 'intake-tasks' });
  });

  it('only lets intake rules fill a section', async () => {
    await admin.post('/api/admin/standards').send({ kind: 'standard', target: 'comments', content: '# x\n' }).expect(400);
  });
});

describe('kinds', () => {
  it('keeps standards, intake rules and product context in separate lists', async () => {
    await admin
      .post('/api/admin/standards')
      .send({ kind: 'context', slug: 'product-overview', name: 'Product overview', content: '# Acme sells…\n' })
      .expect(201);
    await admin
      .post('/api/admin/standards')
      .send({ kind: 'intake', slug: 'release-notes', name: 'Release notes', content: '# Release notes\n' })
      .expect(201);

    const slugs = async (kind: string) =>
      (await admin.get(`/api/admin/standards?kind=${kind}`).expect(200)).body.standards.map((s: { slug: string }) => s.slug);
    expect(await slugs('context')).toEqual(['product-overview']);
    expect(await slugs('intake')).toEqual(['intake-tasks', 'release-notes']);
    expect(await slugs('standard')).toEqual([]);
  });

  it('does not let an import take over a document of another kind or a section ID', async () => {
    const other = await admin
      .post('/api/admin/standards/import')
      .send({ kind: 'standard', items: [{ slug: 'product-overview', name: 'X', content: '# X\n' }], replaceExisting: true })
      .expect(409);
    expect(other.body.error).toMatch(/product context document/);
    await admin
      .post('/api/admin/standards/import')
      .send({ kind: 'intake', items: [{ slug: 'intake-comments', name: 'X', content: '# X\n' }] })
      .expect(409);
  });
});

describe('gateway', () => {
  it('adds the matching intake rules to the tools that write', async () => {
    const tools = await toolDescriptions();
    expect(tools.get('github_create_issue')).toContain('Always add the `needs-triage` label.');
    expect(tools.get('github_add_comment')).toBe('Add a comment to an issue or pull request.');
    expect(tools.get('github_list_issues')).not.toContain('needs-triage');
  });

  it('points to the intake_rules tool when the rules are long', async () => {
    const long = `# Comments\n\n${'Be specific about what changed and why. '.repeat(100)}\n`;
    await admin.post('/api/admin/standards').send({ kind: 'intake', target: 'comments', content: long }).expect(201);
    const description = (await toolDescriptions()).get('github_add_comment')!;
    expect(description).toContain('`intake_rules` tool (target "comments")');
    expect(description.length).toBeLessThan(600);

    const res = await mcp(mcpRequest('tools/call', { name: 'intake_rules', arguments: { target: 'comments' } })).expect(200);
    expect(res.body.result.content[0].text).toContain('Be specific about what changed and why.');
  });

  it('applies rules scoped to a repository only when the agent works in it', async () => {
    await admin
      .post('/api/admin/standards')
      .send({
        kind: 'intake',
        target: 'pull_requests',
        content: '# PRs\n\nLink the Jira ticket in the title.\n',
        appliesToAll: false,
        repositoryIds: [apiRepo],
      })
      .expect(201);

    expect((await toolDescriptions(apiRepo)).get('github_create_pull_request')).toContain('Link the Jira ticket');
    expect((await toolDescriptions(webRepo)).get('github_create_pull_request')).not.toContain('Link the Jira ticket');
    expect((await toolDescriptions()).get('github_create_pull_request')).not.toContain('Link the Jira ticket');
    // An unknown or malformed repository is treated as no repository.
    expect((await toolDescriptions('not-a-uuid')).get('github_create_pull_request')).not.toContain('Link the Jira ticket');
  });

  it('returns every intake rule, custom ones included, when no target is given', async () => {
    const res = await mcp(mcpRequest('tools/call', { name: 'intake_rules', arguments: {} })).expect(200);
    const text: string = res.body.result.content[0].text;
    expect(text).toContain('# Opening tasks');
    expect(text).toContain('# Release notes');
  });

  it('delivers all kinds to the client, labeled', async () => {
    const res = await supertest(t.app)
      .get(`/api/v1/repositories/${apiRepo}/standards`)
      .set('Authorization', `Bearer ${developerToken}`)
      .expect(200);
    const summary = res.body.standards.map((s: { slug: string; kind: string; target: string | null }) => [s.slug, s.kind, s.target]);
    expect(summary).toEqual([
      ['intake-comments', 'intake', 'comments'],
      ['intake-pull-requests', 'intake', 'pull_requests'],
      ['intake-tasks', 'intake', 'tasks'],
      ['product-overview', 'context', null],
      ['release-notes', 'intake', null],
    ]);
  });
});
