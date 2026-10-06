import type { Config } from './config.js';
import type { Gateway } from './services/gateway.js';
import type { IntegrationService } from './services/integrations.js';
import type { Stores } from './store/index.js';

export interface AppDeps {
  config: Config;
  stores: Stores;
  integrations: IntegrationService;
  gateway: Gateway;
}
