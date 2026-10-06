import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { clearSessionCookie, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth.js';
import { hashPassword, verifyPassword } from '../crypto.js';
import type { AppDeps } from '../deps.js';
import { HttpError } from '../http.js';
import type { User } from '../store/users.js';

const loginSchema = z.object({ email: z.email(), password: z.string().min(1) });
const inviteParams = z.object({ token: z.string().min(1) });
const passwordSchema = z.object({ password: z.string().min(12, 'Password must be at least 12 characters').max(256) });

export function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export function authRoutes({ config, stores }: AppDeps): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

  router.post('/auth/login', limiter, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const found = await stores.users.findCredentials(email);
    const valid = found?.passwordHash ? await verifyPassword(password, found.passwordHash) : false;
    if (!found || !valid || found.user.disabled) throw new HttpError(401, 'Incorrect email or password');

    const session = await stores.sessions.create(found.user.id, config.sessionTtlMs);
    setSessionCookie(res, config, session.token, session.expiresAt);
    res.json({ user: publicUser(found.user) });
  });

  router.post('/auth/logout', async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await stores.sessions.delete(token);
    clearSessionCookie(res, config);
    res.status(204).end();
  });

  router.get('/auth/me', requireUser, (req, res) => {
    res.json({ user: publicUser(req.user!) });
  });

  router.get('/invites/:token', limiter, async (req, res) => {
    const { token } = inviteParams.parse(req.params);
    const user = await stores.users.findByInvite(token);
    if (!user) throw new HttpError(404, 'This invite link is invalid or has expired. Ask an admin for a new one.');
    res.json({ email: user.email, name: user.name });
  });

  router.post('/invites/:token', limiter, async (req, res) => {
    const { token } = inviteParams.parse(req.params);
    const { password } = passwordSchema.parse(req.body);
    const user = await stores.users.findByInvite(token);
    if (!user) throw new HttpError(404, 'This invite link is invalid or has expired. Ask an admin for a new one.');

    await stores.users.setPassword(user.id, await hashPassword(password));
    await stores.users.consumeInvite(token);
    // Any sessions from before a password reset should not survive it.
    await stores.sessions.deleteForUser(user.id);
    const session = await stores.sessions.create(user.id, config.sessionTtlMs);
    setSessionCookie(res, config, session.token, session.expiresAt);
    res.json({ user: publicUser(user) });
  });

  return router;
}
