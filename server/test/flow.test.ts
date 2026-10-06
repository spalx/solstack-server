import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASE_URL, browser, createTestApp, json, mcpRequest, signedInUser } from './helpers.js';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

let t: TestApp;
let admin: supertest.Agent;
let developer: supertest.Agent;
let developerToken: string;

const GITHUB = { clientId: 'Iv1.test', clientSecret: 'github-secret', scopes: 'repo' };
const TRELLO_TOKEN = 'ATTA' + 'a'.repeat(60);

function mcp(token: string, body: unknown) {
  return supertest(t.app)
    .post('/mcp')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send(body as object);
}

beforeAll(async () => {
  t = await createTestApp();
  admin = (await signedInUser(t.app, t.deps, { email: 'admin@example.com', name: 'Admin', role: 'admin' })).agent;
  developer = (await signedInUser(t.app, t.deps, { email: 'dev@example.com', name: 'Dev', role: 'developer' })).agent;
  const created = await developer.post('/api/me/tokens').send({ name: 'laptop' }).expect(201);
  developerToken = created.body.token;
});

afterAll(async () => {
  await t.pool.end();
});

beforeEach(() => {
  t.upstream.reset();
});

describe('sessions and access control', () => {
  it('signs in with email and password', async () => {
    const agent = browser(t.app);
    await agent.post('/api/auth/login').send({ email: 'dev@example.com', password: 'wrong password!!' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'DEV@example.com', password: 'a long enough password' }).expect(200);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body.user).toMatchObject({ email: 'dev@example.com', role: 'developer' });
  });

  it('rejects state-changing requests from another origin', async () => {
    await admin.post('/api/admin/repositories').set('Origin', 'https://evil.example').send({ name: 'x' }).expect(403);
  });

  it('keeps developers out of the admin API', async () => {
    await developer.get('/api/admin/users').expect(403);
    await supertest(t.app).get('/api/admin/users').expect(401);
  });

  it('does not let the last admin demote themselves', async () => {
    const users = await admin.get('/api/admin/users').expect(200);
    const self = users.body.users.find((u: { email: string }) => u.email === 'admin@example.com');
    await admin.patch(`/api/admin/users/${self.id}`).send({ role: 'developer' }).expect(400);
  });
});

describe('integration configuration', () => {
  it('refuses to enable an integration that is missing required fields', async () => {
    const res = await admin.put('/api/admin/integrations/github').send({ enabled: true, values: {} }).expect(400);
    expect(res.body.error).toMatch(/Client ID/);
  });

  it('stores secrets without ever returning them', async () => {
    await admin.put('/api/admin/integrations/github').send({ enabled: true, values: GITHUB }).expect(200);
    const res = await admin.get('/api/admin/integrations').expect(200);
    const github = res.body.integrations.find((i: { id: string }) => i.id === 'github');
    expect(github).toMatchObject({ enabled: true, configured: true, secretsSet: { clientSecret: true } });
    expect(JSON.stringify(res.body)).not.toContain(GITHUB.clientSecret);
    expect(github.setup[0].value).toBe(`${BASE_URL}/api/connect/github/callback`);
  });

  it('keeps a stored secret when the field is left empty', async () => {
    await admin
      .put('/api/admin/integrations/github')
      .send({ enabled: true, values: { ...GITHUB, clientSecret: '', scopes: 'repo read:org' } })
      .expect(200);
    const state = await t.deps.integrations.state('github');
    expect(state.context.config).toMatchObject({ clientSecret: GITHUB.clientSecret, scopes: 'repo read:org' });
  });
});

describe('repositories', () => {
  it('issues an API key the client can use to read the repository setup', async () => {
    const created = await admin
      .post('/api/admin/repositories')
      .send({ name: 'acme/web', agents: ['claude-code', 'cursor'], requiredIntegrations: ['github', 'trello'] })
      .expect(201);
    expect(created.body.apiKey).toMatch(/^hsr_/);
    await admin.post('/api/admin/repositories').send({ name: 'acme/web' }).expect(409);
    await admin.post('/api/admin/repositories').send({ name: 'x', agents: ['notepad'] }).expect(400);

    const config = await supertest(t.app)
      .get('/api/v1/repository')
      .set('Authorization', `Bearer ${created.body.apiKey}`)
      .expect(200);
    expect(config.body.agents.map((a: { id: string }) => a.id)).toEqual(['claude-code', 'cursor']);
    expect(config.body.requiredIntegrations).toEqual([
      { id: 'github', name: 'GitHub', available: true },
      { id: 'trello', name: 'Trello', available: false },
    ]);
    expect(config.body.server.mcpUrl).toBe(`${BASE_URL}/mcp`);

    const rotated = await admin.post(`/api/admin/repositories/${created.body.repository.id}/rotate-key`).expect(200);
    await supertest(t.app).get('/api/v1/repository').set('Authorization', `Bearer ${created.body.apiKey}`).expect(401);
    await supertest(t.app).get('/api/v1/repository').set('Authorization', `Bearer ${rotated.body.apiKey}`).expect(200);
  });
});

describe('connecting GitHub', () => {
  it('runs the OAuth flow and stores the developer connection', async () => {
    const start = await developer.get('/api/connect/github/start').expect(302);
    const authorize = new URL(start.headers.location!);
    expect(authorize.origin + authorize.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(authorize.searchParams.get('client_id')).toBe(GITHUB.clientId);
    const state = authorize.searchParams.get('state')!;

    t.upstream.on((url, init) => {
      if (url.href !== 'https://github.com/login/oauth/access_token') return;
      expect(JSON.parse(init.body as string)).toMatchObject({ code: 'the-code', client_secret: GITHUB.clientSecret });
      return json({ access_token: 'gho_dev', scope: 'repo,read:org', token_type: 'bearer' });
    });
    t.upstream.on((url) => (url.href === 'https://api.github.com/user' ? json({ login: 'octodev' }) : undefined));

    // A state issued to someone else, or a reused state, is rejected.
    const forged = await admin.get(`/api/connect/github/callback?code=the-code&state=${state}`).expect(302);
    expect(forged.headers.location).toMatch(/^\/connections\?error=/);

    const start2 = await developer.get('/api/connect/github/start').expect(302);
    const state2 = new URL(start2.headers.location!).searchParams.get('state')!;
    const callback = await developer.get(`/api/connect/github/callback?code=the-code&state=${state2}`).expect(302);
    expect(callback.headers.location).toBe('/connections?connected=github');

    const replay = await developer.get(`/api/connect/github/callback?code=the-code&state=${state2}`).expect(302);
    expect(replay.headers.location).toMatch(/error=/);

    const me = await supertest(t.app).get('/api/v1/me').set('Authorization', `Bearer ${developerToken}`).expect(200);
    expect(me.body.connections).toEqual([
      expect.objectContaining({ id: 'github', connected: true, accountName: 'octodev' }),
    ]);
  });
});

describe('MCP gateway', () => {
  it('requires a developer token', async () => {
    await supertest(t.app).post('/mcp').send(mcpRequest('tools/list')).expect(401);
    await mcp('hsd_not-a-real-token', mcpRequest('tools/list')).expect(401);
  });

  it('initializes and lists only tools of enabled integrations', async () => {
    const init = await mcp(
      developerToken,
      mcpRequest('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }),
    ).expect(200);
    expect(init.body.result.serverInfo.name).toBe('harness-gateway');

    const list = await mcp(developerToken, mcpRequest('tools/list')).expect(200);
    const names: string[] = list.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('harness_connections');
    expect(names).toContain('github_list_issues');
    expect(names.some((name) => name.startsWith('trello_'))).toBe(false);
  });

  it('calls GitHub with the developer token and records the call', async () => {
    t.upstream.on((url, init) => {
      if (url.pathname !== '/repos/acme/web/issues') return;
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_dev');
      expect(url.searchParams.get('state')).toBe('open');
      return json([
        { number: 1, title: 'Bug', state: 'open', body: null, html_url: 'u1', user: { login: 'a' }, labels: [{ name: 'bug' }], assignees: [], comments: 0, created_at: 'c', updated_at: 'u' },
        { number: 2, title: 'A PR', state: 'open', body: null, html_url: 'u2', user: { login: 'b' }, labels: [], assignees: [], comments: 0, created_at: 'c', updated_at: 'u', pull_request: {} },
      ]);
    });

    const res = await mcp(
      developerToken,
      mcpRequest('tools/call', { name: 'github_list_issues', arguments: { owner: 'acme', repo: 'web' } }),
    ).expect(200);
    expect(res.body.result.isError).toBeFalsy();
    const issues = JSON.parse(res.body.result.content[0].text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ number: 1, labels: ['bug'], author: 'a' });

    const activity = await admin.get('/api/admin/activity').expect(200);
    expect(activity.body.calls[0]).toMatchObject({ tool: 'github_list_issues', ok: true, userEmail: 'dev@example.com' });
  });

  it('rejects invalid tool arguments before calling GitHub', async () => {
    const res = await mcp(
      developerToken,
      mcpRequest('tools/call', { name: 'github_get_issue', arguments: { owner: 'acme', repo: 'web', issue_number: 'one' } }),
    ).expect(200);
    const failed = res.body.error ?? res.body.result;
    expect(JSON.stringify(failed)).toMatch(/issue_number/);
    expect(t.upstream.requests).toHaveLength(0);
  });

  it('tells developers who have not connected where to go', async () => {
    const other = await signedInUser(t.app, t.deps, { email: 'new@example.com', name: 'New', role: 'developer' });
    const token = (await other.agent.post('/api/me/tokens').send({ name: 'cli' }).expect(201)).body.token;
    const res = await mcp(
      token,
      mcpRequest('tools/call', { name: 'github_list_issues', arguments: { owner: 'acme', repo: 'web' } }),
    ).expect(200);
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain(`${BASE_URL}/connections`);
  });

  it('marks the connection invalid when GitHub rejects the token', async () => {
    t.upstream.on((url) => (url.pathname === '/repos/acme/web/pulls' ? json({ message: 'Bad credentials' }, 401) : undefined));
    const res = await mcp(
      developerToken,
      mcpRequest('tools/call', { name: 'github_list_pull_requests', arguments: { owner: 'acme', repo: 'web' } }),
    ).expect(200);
    expect(res.body.result.isError).toBe(true);
    const connections = await developer.get('/api/me/connections').expect(200);
    expect(connections.body.connections[0]).toMatchObject({ id: 'github', connected: false, status: 'invalid' });
  });
});

describe('connecting Trello', () => {
  beforeAll(async () => {
    await admin.put('/api/admin/integrations/trello').send({ enabled: true, values: { apiKey: 'trello-key' } }).expect(200);
  });

  it('completes the fragment flow and exposes Trello tools', async () => {
    const start = await developer.get('/api/connect/trello/start').expect(302);
    const authorize = new URL(start.headers.location!);
    expect(authorize.origin + authorize.pathname).toBe('https://trello.com/1/authorize');
    const returnUrl = new URL(authorize.searchParams.get('return_url')!);
    expect(returnUrl.origin + returnUrl.pathname).toBe(`${BASE_URL}/connect/trello`);
    const state = returnUrl.searchParams.get('state')!;

    t.upstream.on((url, init) => {
      if (url.pathname !== '/1/members/me') return;
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `OAuth oauth_consumer_key="trello-key", oauth_token="${TRELLO_TOKEN}"`,
      );
      return json({ username: 'trellodev' });
    });

    await developer.post('/api/connect/trello/complete').send({ state, token: 'short' }).expect(400);
    const start2 = await developer.get('/api/connect/trello/start').expect(302);
    const state2 = new URL(new URL(start2.headers.location!).searchParams.get('return_url')!).searchParams.get('state')!;
    const done = await developer.post('/api/connect/trello/complete').send({ state: state2, token: TRELLO_TOKEN }).expect(200);
    expect(done.body).toEqual({ integrationId: 'trello', accountName: 'trellodev' });

    t.upstream.on((url) =>
      url.pathname === '/1/members/me/boards'
        ? json([{ id: 'b1', name: 'Roadmap', closed: false, url: 'https://trello.com/b/b1', dateLastActivity: null }])
        : undefined,
    );
    const res = await mcp(developerToken, mcpRequest('tools/call', { name: 'trello_list_boards', arguments: {} })).expect(200);
    expect(JSON.parse(res.body.result.content[0].text)).toEqual([
      { id: 'b1', name: 'Roadmap', closed: false, lastActivity: null, url: 'https://trello.com/b/b1' },
    ]);
  });

  it('lists the developer repositories with what is still missing', async () => {
    const res = await developer.get('/api/me/repositories').expect(200);
    // GitHub was invalidated in an earlier test; Trello is connected.
    expect(res.body.repositories[0]).toMatchObject({ name: 'acme/web', missingIntegrations: ['github'] });
  });
});

describe('access tokens', () => {
  it('stop working once revoked', async () => {
    const created = await developer.post('/api/me/tokens').send({ name: 'temp' }).expect(201);
    await supertest(t.app).get('/api/v1/me').set('Authorization', `Bearer ${created.body.token}`).expect(200);
    await developer.delete(`/api/me/tokens/${created.body.accessToken.id}`).expect(204);
    await supertest(t.app).get('/api/v1/me').set('Authorization', `Bearer ${created.body.token}`).expect(401);
  });
});
