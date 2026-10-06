import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';
import { connectionStatuses } from '../services/developer-status.js';

const tokenSchema = z.object({ name: z.string().trim().min(1).max(100) });

export function meRoutes({ config, stores, integrations }: AppDeps): Router {
  const router = Router();
  router.use('/me', requireUser);

  router.get('/me/connections', async (req, res) => {
    res.json({ connections: await connectionStatuses(stores, integrations, req.user!.id) });
  });

  router.delete('/me/connections/:id', async (req, res) => {
    if (!(await stores.connections.delete(req.user!.id, req.params.id))) throw new HttpError(404, 'Not connected');
    res.status(204).end();
  });

  /** Repositories and which of their required integrations this developer still has to connect. */
  router.get('/me/repositories', async (req, res) => {
    const [repositories, connections] = await Promise.all([
      stores.repositories.list(),
      connectionStatuses(stores, integrations, req.user!.id),
    ]);
    const connected = new Set(connections.filter((c) => c.connected).map((c) => c.id));
    res.json({
      repositories: repositories.map((repository) => ({
        id: repository.id,
        name: repository.name,
        gitUrl: repository.gitUrl,
        agents: repository.agents,
        requiredIntegrations: repository.requiredIntegrations,
        missingIntegrations: repository.requiredIntegrations.filter((id) => !connected.has(id)),
      })),
    });
  });

  router.get('/me/tokens', async (req, res) => {
    res.json({ tokens: await stores.accessTokens.listForUser(req.user!.id), mcpUrl: `${config.baseUrl}/mcp` });
  });

  router.post('/me/tokens', async (req, res) => {
    const { name } = tokenSchema.parse(req.body);
    const { token, accessToken } = await stores.accessTokens.create(req.user!.id, name);
    res.status(201).json({ token, accessToken });
  });

  router.delete('/me/tokens/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    if (!(await stores.accessTokens.revoke(req.user!.id, id))) throw new HttpError(404, 'Token not found');
    res.status(204).end();
  });

  return router;
}
