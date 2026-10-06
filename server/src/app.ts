import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { loadSession, requireSameOrigin } from './auth.js';
import type { AppDeps } from './deps.js';
import { errorHandler, HttpError } from './http.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { clientApiRoutes } from './routes/client-api.js';
import { connectRoutes } from './routes/connect.js';
import { mcpRoutes } from './routes/mcp.js';
import { meRoutes } from './routes/me.js';
import { standardRoutes } from './routes/standards.js';

export function createApp(deps: AppDeps): express.Express {
  const { config, stores } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // PrimeVue injects its theme as inline <style> tags.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.secureCookies ? [] : null,
        },
      },
      // Lets the OAuth provider pages we redirect to see where developers came from.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(mcpRoutes(deps));

  const api = express.Router();
  // Large enough for a batch of uploaded standards.
  api.use(express.json({ limit: '5mb' }), cookieParser(), loadSession(stores), requireSameOrigin(config));
  api.use(authRoutes(deps), adminRoutes(deps), standardRoutes(deps), meRoutes(deps), connectRoutes(deps));
  app.use('/api', clientApiRoutes(deps), api);
  app.use('/api', () => {
    throw new HttpError(404, 'Not found');
  });

  const webDist = resolve(config.webDistDir ?? join(import.meta.dirname, '../../web/dist'));
  if (existsSync(webDist)) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    // Client-side routes: every other GET serves the single-page app.
    app.get(/.*/, (_req, res) => {
      res.sendFile(join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
