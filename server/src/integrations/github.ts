import { z } from 'zod';
import {
  defineTool,
  readErrorMessage,
  UpstreamError,
  type Credentials,
  type Integration,
  type IntegrationContext,
  type ToolContext,
} from './types.js';

const PROVIDER = 'GitHub';
const MAX_FILE_BYTES = 200_000;

interface GitHubTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  login: string;
}

interface GitHubLabel {
  name: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  body: string | null;
  html_url: string;
  user: GitHubUser | null;
  labels: (GitHubLabel | string)[];
  assignees: GitHubUser[] | null;
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  body: string | null;
  html_url: string;
  user: GitHubUser | null;
  head: { ref: string };
  base: { ref: string };
  merged_at: string | null;
  mergeable?: boolean | null;
  created_at: string;
  updated_at: string;
}

const owner = z.string().min(1).describe('Repository owner (user or organization)');
const repo = z.string().min(1).describe('Repository name');
const perPage = z.number().int().min(1).max(100).default(30).describe('Results per page (max 100)');
const page = z.number().int().min(1).default(1).describe('Page number');

function webUrl(context: IntegrationContext): string {
  return (context.config.webUrl || 'https://github.com').replace(/\/+$/, '');
}

function apiUrl(context: IntegrationContext): string {
  return (context.config.apiUrl || 'https://api.github.com').replace(/\/+$/, '');
}

function path(...segments: (string | number)[]): string {
  return segments.map((segment) => encodeURIComponent(String(segment))).join('/');
}

async function github<T>(
  context: ToolContext,
  method: string,
  resource: string,
  options: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${apiUrl(context)}/${resource}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }
  const response = await context.fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${context.credentials.accessToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'solstack-gateway',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new UpstreamError(PROVIDER, response.status, `GitHub ${response.status}: ${await readErrorMessage(response)}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

function summarizeIssue(issue: GitHubIssue, includeBody = false) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login ?? null,
    labels: issue.labels.map((label) => (typeof label === 'string' ? label : label.name)),
    assignees: (issue.assignees ?? []).map((user) => user.login),
    comments: issue.comments,
    isPullRequest: issue.pull_request !== undefined,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    ...(includeBody ? { body: issue.body ?? '' } : {}),
  };
}

function summarizePullRequest(pr: GitHubPullRequest, includeBody = false) {
  return {
    number: pr.number,
    title: pr.title,
    state: pr.state,
    draft: pr.draft ?? false,
    merged: pr.merged_at !== null,
    author: pr.user?.login ?? null,
    head: pr.head.ref,
    base: pr.base.ref,
    createdAt: pr.created_at,
    updatedAt: pr.updated_at,
    url: pr.html_url,
    ...(includeBody ? { body: pr.body ?? '', mergeable: pr.mergeable ?? null } : {}),
  };
}

async function exchangeToken(context: IntegrationContext, params: Record<string, string>): Promise<Credentials & { scope?: string }> {
  const response = await context.fetch(`${webUrl(context)}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: context.config.clientId, client_secret: context.config.clientSecret, ...params }),
  });
  const body = (await response.json().catch(() => ({}))) as GitHubTokenResponse;
  if (!response.ok || !body.access_token) {
    throw new UpstreamError(PROVIDER, response.status, body.error_description ?? body.error ?? 'GitHub did not return an access token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : undefined,
    scope: body.scope,
  };
}

export const githubIntegration: Integration = {
  id: 'github',
  name: 'GitHub',
  description: 'Issues, pull requests and repository contents, acting as each developer.',
  fields: [
    { key: 'clientId', label: 'Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Client secret', type: 'secret', required: true },
    {
      key: 'scopes',
      label: 'Scopes',
      type: 'text',
      required: false,
      default: 'repo read:org',
      help: 'Space-separated OAuth scopes. Ignored by GitHub Apps, which use the app\'s permissions instead.',
    },
    {
      key: 'webUrl',
      label: 'GitHub URL',
      type: 'text',
      required: false,
      default: 'https://github.com',
      help: 'Change only for GitHub Enterprise Server.',
    },
    {
      key: 'apiUrl',
      label: 'API URL',
      type: 'text',
      required: false,
      default: 'https://api.github.com',
      help: 'For GitHub Enterprise Server: https://<host>/api/v3',
    },
  ],

  setupSteps(baseUrl) {
    return [
      {
        label: 'Authorization callback URL',
        value: `${baseUrl}/api/connect/github/callback`,
        help: 'Create an OAuth App (or GitHub App) under your organization\'s Developer settings and use this as the callback URL.',
      },
      { label: 'Homepage URL', value: baseUrl },
    ];
  },

  authorizeUrl(context, state) {
    const url = new URL(`${webUrl(context)}/login/oauth/authorize`);
    url.searchParams.set('client_id', context.config.clientId ?? '');
    url.searchParams.set('redirect_uri', `${context.baseUrl}/api/connect/github/callback`);
    url.searchParams.set('scope', context.config.scopes ?? '');
    url.searchParams.set('state', state);
    url.searchParams.set('allow_signup', 'false');
    return url.toString();
  },

  async completeAuthorization(context, params) {
    if (!params.code) throw new UpstreamError(PROVIDER, 400, 'GitHub did not return an authorization code');
    const { scope, ...credentials } = await exchangeToken(context, {
      code: params.code,
      redirect_uri: `${context.baseUrl}/api/connect/github/callback`,
    });
    const user = await github<GitHubUser>({ ...context, credentials }, 'GET', 'user');
    return { credentials, accountName: user.login, scopes: scope };
  },

  async refresh(context, credentials) {
    if (!credentials.refreshToken) throw new UpstreamError(PROVIDER, 401, 'GitHub token expired and cannot be refreshed');
    const { scope: _scope, ...refreshed } = await exchangeToken(context, {
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    });
    return refreshed;
  },

  tools: [
    defineTool({
      name: 'github_list_repositories',
      title: 'List repositories',
      description: 'List repositories the developer can access, most recently updated first.',
      readOnly: true,
      inputSchema: { per_page: perPage, page },
      async run(args, context) {
        const repos = await github<
          { full_name: string; private: boolean; default_branch: string; description: string | null; html_url: string; updated_at: string }[]
        >(context, 'GET', 'user/repos', { query: { sort: 'updated', per_page: args.per_page, page: args.page } });
        return repos.map((r) => ({
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          description: r.description,
          updatedAt: r.updated_at,
          url: r.html_url,
        }));
      },
    }),

    defineTool({
      name: 'github_list_issues',
      title: 'List issues',
      description: 'List issues in a repository (pull requests are excluded).',
      readOnly: true,
      inputSchema: {
        owner,
        repo,
        state: z.enum(['open', 'closed', 'all']).default('open'),
        labels: z.string().optional().describe('Comma-separated label names'),
        assignee: z.string().optional().describe('Username, "none" or "*"'),
        per_page: perPage,
        page,
      },
      async run(args, context) {
        const issues = await github<GitHubIssue[]>(context, 'GET', `repos/${path(args.owner, args.repo)}/issues`, {
          query: { state: args.state, labels: args.labels, assignee: args.assignee, per_page: args.per_page, page: args.page },
        });
        return issues.filter((issue) => issue.pull_request === undefined).map((issue) => summarizeIssue(issue));
      },
    }),

    defineTool({
      name: 'github_get_issue',
      title: 'Get issue',
      description: 'Get an issue or pull request conversation, including its body and comments.',
      readOnly: true,
      inputSchema: {
        owner,
        repo,
        issue_number: z.number().int().positive(),
        include_comments: z.boolean().default(true),
      },
      async run(args, context) {
        const base = `repos/${path(args.owner, args.repo)}/issues/${args.issue_number}`;
        const issue = await github<GitHubIssue>(context, 'GET', base);
        const comments = args.include_comments
          ? await github<{ user: GitHubUser | null; body: string; created_at: string }[]>(context, 'GET', `${base}/comments`, {
              query: { per_page: 100 },
            })
          : [];
        return {
          ...summarizeIssue(issue, true),
          commentList: comments.map((c) => ({ author: c.user?.login ?? null, body: c.body, createdAt: c.created_at })),
        };
      },
    }),

    defineTool({
      name: 'github_create_issue',
      title: 'Create issue',
      description: 'Create an issue in a repository.',
      readOnly: false,
      intakeTarget: 'tasks',
      inputSchema: {
        owner,
        repo,
        title: z.string().min(1),
        body: z.string().optional(),
        labels: z.array(z.string()).optional(),
        assignees: z.array(z.string()).optional(),
      },
      async run(args, context) {
        const issue = await github<GitHubIssue>(context, 'POST', `repos/${path(args.owner, args.repo)}/issues`, {
          body: { title: args.title, body: args.body, labels: args.labels, assignees: args.assignees },
        });
        return summarizeIssue(issue, true);
      },
    }),

    defineTool({
      name: 'github_add_comment',
      title: 'Comment on issue or pull request',
      description: 'Add a comment to an issue or pull request.',
      readOnly: false,
      intakeTarget: 'comments',
      inputSchema: { owner, repo, issue_number: z.number().int().positive(), body: z.string().min(1) },
      async run(args, context) {
        const comment = await github<{ id: number; html_url: string }>(
          context,
          'POST',
          `repos/${path(args.owner, args.repo)}/issues/${args.issue_number}/comments`,
          { body: { body: args.body } },
        );
        return { id: comment.id, url: comment.html_url };
      },
    }),

    defineTool({
      name: 'github_list_pull_requests',
      title: 'List pull requests',
      description: 'List pull requests in a repository.',
      readOnly: true,
      inputSchema: {
        owner,
        repo,
        state: z.enum(['open', 'closed', 'all']).default('open'),
        base: z.string().optional().describe('Filter by base branch'),
        head: z.string().optional().describe('Filter by head, as "user:branch"'),
        per_page: perPage,
        page,
      },
      async run(args, context) {
        const prs = await github<GitHubPullRequest[]>(context, 'GET', `repos/${path(args.owner, args.repo)}/pulls`, {
          query: { state: args.state, base: args.base, head: args.head, per_page: args.per_page, page: args.page },
        });
        return prs.map((pr) => summarizePullRequest(pr));
      },
    }),

    defineTool({
      name: 'github_get_pull_request',
      title: 'Get pull request',
      description: 'Get a pull request, optionally with the list of changed files.',
      readOnly: true,
      inputSchema: {
        owner,
        repo,
        pull_number: z.number().int().positive(),
        include_files: z.boolean().default(false),
      },
      async run(args, context) {
        const base = `repos/${path(args.owner, args.repo)}/pulls/${args.pull_number}`;
        const pr = await github<GitHubPullRequest>(context, 'GET', base);
        const files = args.include_files
          ? await github<{ filename: string; status: string; additions: number; deletions: number }[]>(
              context,
              'GET',
              `${base}/files`,
              { query: { per_page: 100 } },
            )
          : undefined;
        return {
          ...summarizePullRequest(pr, true),
          ...(files ? { files: files.map((f) => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions })) } : {}),
        };
      },
    }),

    defineTool({
      name: 'github_create_pull_request',
      title: 'Create pull request',
      description: 'Open a pull request from an already-pushed branch.',
      readOnly: false,
      intakeTarget: 'pull_requests',
      inputSchema: {
        owner,
        repo,
        title: z.string().min(1),
        head: z.string().min(1).describe('Branch with the changes'),
        base: z.string().min(1).describe('Branch to merge into'),
        body: z.string().optional(),
        draft: z.boolean().default(false),
      },
      async run(args, context) {
        const pr = await github<GitHubPullRequest>(context, 'POST', `repos/${path(args.owner, args.repo)}/pulls`, {
          body: { title: args.title, head: args.head, base: args.base, body: args.body, draft: args.draft },
        });
        return summarizePullRequest(pr, true);
      },
    }),

    defineTool({
      name: 'github_get_file_contents',
      title: 'Get file or directory',
      description: 'Read a file (decoded text) or list a directory from a repository.',
      readOnly: true,
      inputSchema: {
        owner,
        repo,
        path: z.string().default('').describe('Path inside the repository; empty for the root'),
        ref: z.string().optional().describe('Branch, tag or commit; defaults to the default branch'),
      },
      async run(args, context) {
        const filePath = args.path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
        const result = await github<
          | { type: string; name: string; path: string; size: number }[]
          | { type: string; path: string; size: number; encoding?: string; content?: string; sha: string }
        >(context, 'GET', `repos/${path(args.owner, args.repo)}/contents/${filePath}`, { query: { ref: args.ref } });
        if (Array.isArray(result)) {
          return { type: 'directory', entries: result.map((e) => ({ name: e.name, path: e.path, type: e.type, size: e.size })) };
        }
        if (result.type !== 'file' || result.encoding !== 'base64' || result.content === undefined) {
          return { type: result.type, path: result.path, size: result.size, note: 'Content not available through this tool.' };
        }
        const content = Buffer.from(result.content, 'base64');
        return {
          type: 'file',
          path: result.path,
          sha: result.sha,
          size: result.size,
          truncated: content.length > MAX_FILE_BYTES,
          content: content.subarray(0, MAX_FILE_BYTES).toString('utf8'),
        };
      },
    }),

    defineTool({
      name: 'github_search_issues',
      title: 'Search issues and pull requests',
      description: 'Search issues and pull requests using GitHub search syntax, e.g. "repo:owner/name is:open label:bug".',
      readOnly: true,
      inputSchema: { query: z.string().min(1), per_page: perPage, page },
      async run(args, context) {
        const result = await github<{ total_count: number; items: GitHubIssue[] }>(context, 'GET', 'search/issues', {
          query: { q: args.query, per_page: args.per_page, page: args.page },
        });
        return {
          total: result.total_count,
          items: result.items.map((item) => ({ ...summarizeIssue(item), repository: item.html_url.split('/').slice(3, 5).join('/') })),
        };
      },
    }),
  ],
};
