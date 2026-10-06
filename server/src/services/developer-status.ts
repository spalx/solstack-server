import type { Stores } from '../store/index.js';
import type { IntegrationService } from './integrations.js';

export interface ConnectionStatusView {
  id: string;
  name: string;
  description: string;
  connected: boolean;
  status: 'active' | 'invalid' | null;
  accountName: string | null;
  connectedAt: Date | null;
}

/** The integrations a developer can use and whether each is connected for them. */
export async function connectionStatuses(
  stores: Stores,
  integrations: IntegrationService,
  userId: string,
): Promise<ConnectionStatusView[]> {
  const [active, connections] = await Promise.all([integrations.active(), stores.connections.listForUser(userId)]);
  return active.map(({ integration }) => {
    const connection = connections.find((c) => c.integrationId === integration.id);
    return {
      id: integration.id,
      name: integration.name,
      description: integration.description,
      connected: connection?.status === 'active',
      status: connection?.status ?? null,
      accountName: connection?.accountName ?? null,
      connectedAt: connection?.updatedAt ?? null,
    };
  });
}
