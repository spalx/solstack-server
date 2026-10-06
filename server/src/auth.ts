import type { RequestHandler, Response } from 'express';
import type { Config } from './config.js';
import { HttpError } from './http.js';
import type { Stores } from './store/index.js';
import type { Repository } from './store/repositories.js';
import type { User } from './store/users.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      repository?: Repository;
    }
  }
}

export const SESSION_COOKIE = 'solstack_session';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function setSessionCookie(res: Response, config: Config, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, config: Config): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: config.secureCookies, sameSite: 'lax', path: '/' });
}

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

/** Loads the signed-in user from the session cookie, if any. Does not reject anonymous requests. */
export function loadSession(stores: Stores): RequestHandler {
  return async (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) {
      const userId = await stores.sessions.findUserId(token);
      const user = userId ? await stores.users.findById(userId) : null;
      if (user && !user.disabled) req.user = user;
    }
    next();
  };
}

/**
 * Cookie-authenticated requests that change state must come from our own origin. Together with
 * SameSite=Lax cookies this blocks cross-site request forgery without a separate CSRF token.
 */
export function requireSameOrigin(config: Config): RequestHandler {
  return (req, _res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();
    if (requestOrigin(req.get('origin'), req.get('referer')) !== config.baseUrl) {
      throw new HttpError(403, 'Cross-origin request rejected');
    }
    next();
  };
}

function requestOrigin(origin: string | undefined, referer: string | undefined): string | undefined {
  if (origin) return origin;
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Sign in required');
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Sign in required');
  if (req.user.role !== 'admin') throw new HttpError(403, 'Admin access required');
  next();
};

/** Authenticates a developer by personal access token (used by agents and the client app). */
export function requireDeveloperToken(stores: Stores): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get('authorization'));
    const userId = token ? await stores.accessTokens.authenticate(token) : null;
    const user = userId ? await stores.users.findById(userId) : null;
    if (!user || user.disabled) {
      res.set('WWW-Authenticate', 'Bearer realm="solstack"');
      throw new HttpError(401, 'Valid developer access token required');
    }
    req.user = user;
    next();
  };
}

/** Authenticates a repository by its API key (used by the client's `init`). */
export function requireRepositoryKey(stores: Stores): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.get('authorization'));
    const repository = token ? await stores.repositories.authenticate(token) : null;
    if (!repository) {
      res.set('WWW-Authenticate', 'Bearer realm="solstack"');
      throw new HttpError(401, 'Valid repository API key required');
    }
    req.repository = repository;
    next();
  };
}
