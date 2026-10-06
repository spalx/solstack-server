import type { Config } from './config.js';
import { SecretBox } from './crypto.js';
import { createPool, migrate, type Pool } from './db/pool.js';
import type { AppDeps } from './deps.js';
import { INTEGRATIONS } from './integrations/index.js';
import { Gateway } from './services/gateway.js';
import { IntegrationService } from './services/integrations.js';
import { createStores } from './store/index.js';

export async function bootstrap(
  config: Config,
  options: { fetch?: typeof fetch; pool?: Pool } = {},
): Promise<AppDeps & { pool: Pool }> {
  const pool = options.pool ?? createPool(config.databaseUrl);
  await migrate(pool);
  const stores = createStores(pool, new SecretBox(config.encryptionKey));
  const integrations = new IntegrationService(stores.integrations, INTEGRATIONS, config.baseUrl, options.fetch ?? fetch);
  return { config, pool, stores, integrations, gateway: new Gateway(stores, config.baseUrl) };
}
