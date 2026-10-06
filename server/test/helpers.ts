import { randomBytes } from 'node:crypto';
import pg from 'pg';
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { bootstrap } from '../src/bootstrap.js';
import type { Config } from '../src/config.js';
import type { AppDeps } from '../src/deps.js';

export const BASE_URL = 'http://solstack.test';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://solstack:solstack@localhost:5432/solstack_test';

export type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response> | undefined;

/** Fake upstream: each test pushes handlers; unmatched requests fail loudly. */
export class FakeUpstream {
  readonly requests: { url: URL; init: RequestInit }[] = [];
  private handlers: FetchHandler[] = [];

  on(handler: FetchHandler): void {
    this.handlers.push(handler);
  }

  reset(): void {
    this.handlers = [];
    this.requests.length = 0;
  }

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    this.requests.push({ url, init });
    for (const handler of this.handlers) {
      const response = await handler(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected upstream request: ${init.method ?? 'GET'} ${url}`);
  };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function createTestApp() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const config: Config = {
    nodeEnv: 'test',
    port: 0,
    baseUrl: BASE_URL,
    databaseUrl: DATABASE_URL,
    encryptionKey: randomBytes(32),
    sessionTtlMs: 60 * 60 * 1000,
    secureCookies: false,
    trustProxy: 0,
    webDistDir: '/nonexistent',
  };
  const upstream = new FakeUpstream();
  const deps = await bootstrap(config, { pool, fetch: upstream.fetch });
  const app = createApp(deps);
  return { app, deps, pool, upstream };
}

/** A browser-like client: keeps cookies and sends our Origin on every request. */
export function browser(app: Parameters<typeof supertest.agent>[0]) {
  const agent = supertest.agent(app);
  agent.set('Origin', BASE_URL);
  return agent;
}

/** Creates a user through the real invite flow and returns a signed-in browser for them. */
export async function signedInUser(
  app: Parameters<typeof supertest.agent>[0],
  deps: AppDeps,
  input: { email: string; name: string; role: 'admin' | 'developer' },
) {
  const user = await deps.stores.users.create(input);
  const invite = await deps.stores.users.createInvite(user.id);
  const agent = browser(app);
  await agent.post(`/api/invites/${invite}`).send({ password: 'a long enough password' }).expect(200);
  return { user, agent };
}

export function mcpRequest(method: string, params: Record<string, unknown> = {}, id = 1) {
  return { jsonrpc: '2.0', id, method, params };
}
