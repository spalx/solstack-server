import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Router } from 'express';
import { requireDeveloperToken } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { connectionStatuses } from '../services/developer-status.js';
import type { User } from '../store/users.js';

const SERVER_INFO = { name: 'harness-gateway', version: '0.1.0' };

/**
 * Builds an MCP server for one request. The tool list depends on which integrations the admin has
 * enabled, so it is assembled per request rather than once at startup (stateless Streamable HTTP).
 */
async function buildServer({ config, stores, integrations, gateway }: AppDeps, user: User): Promise<McpServer> {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      'Tools act on GitHub and Trello as the signed-in developer. If a tool reports that an integration is not ' +
      'connected, tell the developer to open the connect link it returns, then retry.',
  });

  server.registerTool(
    'harness_connections',
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

  for (const state of await integrations.active()) {
    for (const tool of state.integration.tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
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
    const server = await buildServer(deps, req.user!);
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
