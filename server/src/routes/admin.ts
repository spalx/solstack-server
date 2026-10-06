import { Router } from 'express';
import { z } from 'zod';
import { requireAdmin } from '../auth.js';
import { AGENT_IDS, AGENTS } from '../catalog.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';

const uuid = z.uuid();

const integrationSchema = z.object({
  enabled: z.boolean(),
  values: z.record(z.string(), z.string()).default({}),
});

const userCreateSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(['admin', 'developer']).default('developer'),
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(['admin', 'developer']).optional(),
  disabled: z.boolean().optional(),
});

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

export function adminRoutes({ config, stores, integrations }: AppDeps): Router {
  const router = Router();
  router.use('/admin', requireAdmin);

  const repositorySchema = z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .regex(/^[\w.\-/]+$/, 'Use letters, numbers, ".", "-", "_" and "/" only'),
    gitUrl: z.string().trim().max(500).nullable().default(null),
    agents: z.array(z.enum(AGENT_IDS)).default([]),
    requiredIntegrations: z
      .array(z.string())
      .default([])
      .refine((ids) => ids.every((id) => integrations.definition(id)), 'Unknown integration'),
  });

  const inviteUrl = (token: string) => `${config.baseUrl}/invite/${token}`;

  router.get('/admin/overview', async (_req, res) => {
    const [users, connections, repositories, states, calls] = await Promise.all([
      stores.users.list(),
      stores.connections.listAll(),
      stores.repositories.list(),
      integrations.states(),
      stores.activity.countSince(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    ]);
    const activeUsers = users.filter((user) => !user.disabled);
    res.json({
      users: { total: activeUsers.length, pendingInvites: activeUsers.filter((user) => !user.active).length },
      repositories: repositories.length,
      toolCallsLast24h: calls,
      integrations: states.map((state) => ({
        id: state.integration.id,
        name: state.integration.name,
        enabled: state.enabled,
        configured: state.configured,
        connectedUsers: connections.filter((c) => c.integrationId === state.integration.id && c.status === 'active').length,
      })),
    });
  });

  // Integrations

  router.get('/admin/integrations', async (_req, res) => {
    res.json({ integrations: await integrations.views() });
  });

  router.put('/admin/integrations/:id', async (req, res) => {
    const input = integrationSchema.parse(req.body);
    res.json({ integration: await integrations.configure(req.params.id, input) });
  });

  // Repositories

  router.get('/admin/catalog', (_req, res) => {
    res.json({
      agents: AGENTS,
      integrations: integrations.ids().map((id) => ({ id, name: integrations.definition(id)!.name })),
    });
  });

  router.get('/admin/repositories', async (_req, res) => {
    res.json({ repositories: await stores.repositories.list() });
  });

  router.post('/admin/repositories', async (req, res) => {
    const input = repositorySchema.parse(req.body);
    try {
      const { repository, apiKey } = await stores.repositories.create({ ...input, gitUrl: input.gitUrl || null });
      res.status(201).json({ repository: repository, apiKey });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `A repository named "${input.name}" already exists`);
      throw error;
    }
  });

  router.put('/admin/repositories/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const input = repositorySchema.parse(req.body);
    try {
      const repository = await stores.repositories.update(id, { ...input, gitUrl: input.gitUrl || null });
      if (!repository) throw new HttpError(404, 'Repository not found');
      res.json({ repository: repository });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `A repository named "${input.name}" already exists`);
      throw error;
    }
  });

  router.post('/admin/repositories/:id/rotate-key', async (req, res) => {
    const apiKey = await stores.repositories.rotateKey(uuid.parse(req.params.id));
    if (!apiKey) throw new HttpError(404, 'Repository not found');
    res.json({ apiKey });
  });

  router.delete('/admin/repositories/:id', async (req, res) => {
    if (!(await stores.repositories.delete(uuid.parse(req.params.id)))) throw new HttpError(404, 'Repository not found');
    res.status(204).end();
  });

  // Users

  router.get('/admin/users', async (_req, res) => {
    const [users, connections] = await Promise.all([stores.users.list(), stores.connections.listAll()]);
    res.json({
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        disabled: user.disabled,
        active: user.active,
        createdAt: user.createdAt,
        connections: connections
          .filter((c) => c.userId === user.id)
          .map((c) => ({ integrationId: c.integrationId, accountName: c.accountName, status: c.status })),
      })),
    });
  });

  router.post('/admin/users', async (req, res) => {
    const input = userCreateSchema.parse(req.body);
    try {
      const user = await stores.users.create(input);
      const token = await stores.users.createInvite(user.id);
      res.status(201).json({ user, inviteUrl: inviteUrl(token) });
    } catch (error) {
      if (isUniqueViolation(error)) throw new HttpError(409, `${input.email} already has an account`);
      throw error;
    }
  });

  /** Issues a fresh invite link. For an existing user this works as a password reset link. */
  router.post('/admin/users/:id/invite', async (req, res) => {
    const user = await stores.users.findById(uuid.parse(req.params.id));
    if (!user) throw new HttpError(404, 'User not found');
    res.json({ inviteUrl: inviteUrl(await stores.users.createInvite(user.id)) });
  });

  router.patch('/admin/users/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const changes = userUpdateSchema.parse(req.body);
    const target = await stores.users.findById(id);
    if (!target) throw new HttpError(404, 'User not found');
    const losesAdmin = target.role === 'admin' && !target.disabled && (changes.role === 'developer' || changes.disabled === true);
    if (losesAdmin && id === req.user!.id) throw new HttpError(400, 'You cannot remove your own admin access');
    if (losesAdmin && (await stores.users.countAdmins()) <= 1) throw new HttpError(400, 'At least one admin must remain');

    const user = await stores.users.update(id, changes);
    if (changes.disabled) await stores.sessions.deleteForUser(id);
    res.json({ user });
  });

  router.delete('/admin/users/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    if (id === req.user!.id) throw new HttpError(400, 'You cannot delete your own account');
    const target = await stores.users.findById(id);
    if (!target) throw new HttpError(404, 'User not found');
    if (target.role === 'admin' && !target.disabled && (await stores.users.countAdmins()) <= 1) {
      throw new HttpError(400, 'At least one admin must remain');
    }
    await stores.users.delete(id);
    res.status(204).end();
  });

  // Activity

  router.get('/admin/activity', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit);
    res.json({ calls: await stores.activity.recent(limit) });
  });

  return router;
}
