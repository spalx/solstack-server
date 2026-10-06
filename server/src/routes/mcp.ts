import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Router, type Request } from 'express';
import { z } from 'zod';
import { requireDeveloperToken } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { INTAKE_TARGETS, intakeSection } from '../intake.js';
import type { Tool } from '../integrations/types.js';
import { connectionStatuses } from '../services/developer-status.js';
import type { Standard } from '../store/standards.js';
import type { User } from '../store/users.js';

const SERVER_INFO = { name: 'solstack-gateway', version: '0.1.0' };

/** Sent by `solstack mcp` so rules scoped to a repository reach agents working in it. */
export const REPOSITORY_HEADER = 'x-solstack-repository';

/** Rules up to this size go into the tool description in full; longer ones are summarized with a pointer. */
const INLINE_RULE_LIMIT = 3_000;

function formatRule(rule: Standard): string {
  const content = rule.content.trim();
  // Most rules already start with their own title; add one only when they don't.
  return /^#\s/.test(content) ? content : `# ${rule.name}\n\n${content}`;
}

/**
 * Appends the team's intake rules to the tools that write tasks, comments and pull requests, so every agent
 * sees them at the moment it writes, in or outside the Solstack commands.
 */
function describe(tool: Tool, rules: Map<string, Standard>): string {
  const rule = tool.intakeTarget ? rules.get(tool.intakeTarget) : undefined;
  if (!rule || !tool.intakeTarget) return tool.description;
  const what = intakeSection(tool.intakeTarget).name.toLowerCase();
  if (rule.content.length <= INLINE_RULE_LIMIT) {
    return `${tool.description}\n\nFollow the team's rules for ${what} when writing it:\n\n${rule.content.trim()}`;
  }
  return (
    `${tool.description}\n\nThe team has rules for ${what}: ${rule.description} ` +
    `Before calling this tool, read them with the \`intake_rules\` tool (target "${tool.intakeTarget}") and follow them.`
  );
}

async function repositoryFromHeader(req: Request, deps: AppDeps): Promise<string | null> {
  const parsed = z.uuid().safeParse(req.get(REPOSITORY_HEADER));
  if (!parsed.success) return null;
  return (await deps.stores.repositories.findById(parsed.data))?.id ?? null;
}

/**
 * Builds an MCP server for one request. The tool list depends on which integrations the admin has
 * enabled, so it is assembled per request rather than once at startup (stateless Streamable HTTP).
 */
async function buildServer(
  { config, stores, integrations, gateway }: AppDeps,
  user: User,
  repositoryId: string | null,
): Promise<McpServer> {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Tools act on GitHub and Trello as the signed-in developer. If a tool reports that an integration is not ' +
      'connected, tell the developer to open the connect link it returns, then retry.',
  });

  server.registerTool(
    'solstack_connections',
    {
      title: 'Integration connections',
      description: 'Show which integrations are available and whether the developer has connected each one.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const connections = await connectionStatuses(stores, integrations, user.id);
      const summary = {
        user: user.email,
        connectUrl: `${config.baseUrl}/connections`,
        integrations: connections.map((c) => ({ id: c.id, name: c.name, connected: c.connected, account: c.accountName })),
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
    },
  );

  const intakeRules = await stores.standards.listForRepository(repositoryId, 'intake');
  const sectionRules = new Map(intakeRules.filter((rule) => rule.target).map((rule) => [rule.target!, rule]));

  server.registerTool(
    'intake_rules',
    {
      title: 'Intake rules',
      description:
        "The team's rules for writing things that are not code: opening tasks, comments, pull requests, commit " +
        'messages and more. Pass a target for one section, or nothing for all of them.',
      inputSchema: { target: z.enum(INTAKE_TARGETS).optional().describe('tasks, comments, pull_requests or commits') },
      annotations: { readOnlyHint: true },
    },
    async ({ target }) => {
      const rules = target ? intakeRules.filter((rule) => rule.target === target) : intakeRules;
      const text = rules.length
        ? rules.map(formatRule).join('\n\n---\n\n')
        : target
          ? `The team has no rules for ${intakeSection(target).name.toLowerCase()}. Use the conventions already visible in the project.`
          : 'The team has no intake rules.';
      return { content: [{ type: 'text', text }] };
    },
  );

  for (const state of await integrations.active()) {
    for (const tool of state.integration.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: describe(tool, sectionRules),
          inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, openWorldHint: true },
        },
        (args) => gateway.callTool(user, state, tool, args as Record<string, unknown>),
      );
    }
  }
  return server;
}

export function mcpRoutes(deps: AppDeps): Router {
  const router = Router();

  router.post('/mcp', express.json({ limit: '4mb' }), requireDeveloperToken(deps.stores), async (req, res) => {
    const server = await buildServer(deps, req.user!, await repositoryFromHeader(req, deps));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless mode has no server-initiated stream and no sessions to delete.
  router.all('/mcp', (_req, res) => {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed' },
      id: null,
    });
  });

  return router;
}
