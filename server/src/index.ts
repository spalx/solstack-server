import { createApp } from './app.js';
import { bootstrap } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const deps = await bootstrap(config);
const app = createApp(deps);

const server = app.listen(config.port, () => {
  console.log(`Harness server listening on port ${config.port} (public URL ${config.baseUrl})`);
});

const purge = setInterval(
  () => void deps.stores.sessions.purgeExpired().catch((error) => console.error('Purge failed', error)),
  60 * 60 * 1000,
);
purge.unref();

function shutdown() {
  server.close(() => void deps.pool.end().then(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
