import { Router } from 'express';
import { requireDeveloperToken, requireRepositoryKey } from '../auth.js';
import { AGENTS } from '../catalog.js';
import type { AppDeps } from '../deps.js';
import { connectionStatuses } from '../services/developer-status.js';
import { publicUser } from './auth.js';

/** Token-authenticated API for the client app. Versioned so older clients keep working. */
export function clientApiRoutes({ config, stores, integrations }: AppDeps): Router {
  const router = Router();

  /** What `init` needs to set a repository up. Authenticated with the repository API key. */
  router.get('/v1/repository', requireRepositoryKey(stores), async (req, res) => {
    const repository = req.repository!;
    const states = await integrations.states();
    res.json({
      repository: { id: repository.id, name: repository.name, gitUrl: repository.gitUrl },
      agents: AGENTS.filter((agent) => repository.agents.includes(agent.id)),
      requiredIntegrations: repository.requiredIntegrations.map((id) => {
        const state = states.find((s) => s.integration.id === id);
        return { id, name: state?.integration.name ?? id, available: Boolean(state?.enabled && state.configured) };
      }),
      server: { url: config.baseUrl, mcpUrl: `${config.baseUrl}/mcp` },
    });
  });

  /** Who the developer is and what they have connected. Authenticated with a developer access token. */
  router.get('/v1/me', requireDeveloperToken(stores), async (req, res) => {
    res.json({
      user: publicUser(req.user!),
      connections: await connectionStatuses(stores, integrations, req.user!.id),
      connectUrl: `${config.baseUrl}/connections`,
    });
  });

  return router;
}
