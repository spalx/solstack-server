import type { SecretBox } from '../crypto.js';
import type { Pool } from '../db/pool.js';
import { AccessTokenStore } from './access-tokens.js';
import { ActivityStore } from './activity.js';
import { ConnectionStore } from './connections.js';
import { IntegrationStore } from './integrations.js';
import { RepositoryStore } from './repositories.js';
import { SessionStore } from './sessions.js';
import { UserStore } from './users.js';

export interface Stores {
  users: UserStore;
  sessions: SessionStore;
  accessTokens: AccessTokenStore;
  integrations: IntegrationStore;
  connections: ConnectionStore;
  repositories: RepositoryStore;
  activity: ActivityStore;
}

export function createStores(pool: Pool, box: SecretBox): Stores {
  return {
    users: new UserStore(pool),
    sessions: new SessionStore(pool),
    accessTokens: new AccessTokenStore(pool),
    integrations: new IntegrationStore(pool, box),
    connections: new ConnectionStore(pool, box),
    repositories: new RepositoryStore(pool),
    activity: new ActivityStore(pool),
  };
}
