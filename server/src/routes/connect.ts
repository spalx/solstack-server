import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';

const completeSchema = z.object({ state: z.string().min(1) }).catchall(z.string());

/**
 * Developer authorization flows. `start` sends the browser to the provider. Providers that redirect back
 * with a code hit `callback`; providers that return the token in the URL fragment (Trello) land on a web
 * page that posts it to `complete`.
 */
export function connectRoutes({ stores, integrations }: AppDeps): Router {
  const router = Router();

  const backToConnections = (res: Response, params: Record<string, string>) =>
    res.redirect(`/connections?${new URLSearchParams(params).toString()}`);

  async function finish(userId: string, integrationId: string, state: string, params: Record<string, string>) {
    if (!(await stores.connections.consumeState(state, userId, integrationId))) {
      throw new HttpError(400, 'This authorization link has expired or was already used. Start again.');
    }
    const { integration, context } = await integrations.state(integrationId);
    const result = await integration.completeAuthorization(context, params);
    await stores.connections.upsert({
      userId,
      integrationId,
      credentials: result.credentials,
      accountName: result.accountName,
      scopes: result.scopes,
    });
    return result;
  }

  router.get('/connect/:id/start', async (req, res) => {
    // Signing in first returns the developer here, so the flow continues where it started.
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    const { integration, enabled, configured, context } = await integrations.state(req.params.id);
    if (!enabled || !configured) {
      return backToConnections(res, { error: `${integration.name} is not enabled on this server.` });
    }
    const state = await stores.connections.createState(req.user.id, integration.id);
    res.redirect(integration.authorizeUrl(context, state));
  });

  router.get('/connect/:id/callback', async (req, res) => {
    if (!req.user) return res.redirect('/login?next=/connections');
    const query = Object.fromEntries(
      Object.entries(req.query).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    if (query.error) {
      return backToConnections(res, { error: query.error_description ?? 'Authorization was cancelled.' });
    }
    try {
      await finish(req.user.id, req.params.id, query.state ?? '', query);
      backToConnections(res, { connected: req.params.id });
    } catch (error) {
      backToConnections(res, { error: error instanceof Error ? error.message : 'Authorization failed.' });
    }
  });

  router.post('/connect/:id/complete', requireUser, async (req, res) => {
    const integrationId = String(req.params.id);
    const { state, ...params } = completeSchema.parse(req.body);
    const result = await finish(req.user!.id, integrationId, state, params).catch((error: unknown) => {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, error instanceof Error ? error.message : 'Authorization failed.');
    });
    res.json({ integrationId, accountName: result.accountName });
  });

  return router;
}
