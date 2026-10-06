import type { IntegrationStore, IntegrationRecord } from '../store/integrations.js';
import type { Integration, IntegrationContext } from '../integrations/types.js';
import { HttpError } from '../http.js';

export interface IntegrationState {
  integration: Integration;
  enabled: boolean;
  /** All required fields have a value. */
  configured: boolean;
  context: IntegrationContext;
  record: IntegrationRecord;
}

/** Admin-facing view of an integration. Secret values are reported only as set or not set. */
export interface IntegrationView {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  fields: Integration['fields'];
  values: Record<string, string>;
  secretsSet: Record<string, boolean>;
  setup: ReturnType<Integration['setupSteps']>;
}

export class IntegrationService {
  private readonly byId: Map<string, Integration>;

  constructor(
    private readonly store: IntegrationStore,
    integrations: Integration[],
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.byId = new Map(integrations.map((integration) => [integration.id, integration]));
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }

  definition(id: string): Integration | undefined {
    return this.byId.get(id);
  }

  async states(): Promise<IntegrationState[]> {
    const records = await this.store.getAll();
    return [...this.byId.values()].map((integration) =>
      this.toState(integration, records.get(integration.id) ?? { enabled: false, settings: {}, secrets: {} }),
    );
  }

  /** Integrations developers can use right now. */
  async active(): Promise<IntegrationState[]> {
    return (await this.states()).filter((state) => state.enabled && state.configured);
  }

  async state(id: string): Promise<IntegrationState> {
    const integration = this.byId.get(id);
    if (!integration) throw new HttpError(404, `Unknown integration: ${id}`);
    return this.toState(integration, await this.store.get(id));
  }

  async views(): Promise<IntegrationView[]> {
    return (await this.states()).map((state) => this.toView(state));
  }

  /**
   * Saves admin configuration. Secret fields left empty keep their stored value, so the admin
   * never has to re-enter a secret just to change another field.
   */
  async configure(id: string, input: { enabled: boolean; values: Record<string, string> }): Promise<IntegrationView> {
    const { integration, record } = await this.state(id);
    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = { ...record.secrets };

    for (const field of integration.fields) {
      const value = input.values[field.key]?.trim() ?? '';
      if (field.type === 'secret') {
        if (value) secrets[field.key] = value;
      } else if (value) {
        if (field.options && !field.options.some((option) => option.value === value)) {
          throw new HttpError(400, `${field.label} must be one of: ${field.options.map((o) => o.value).join(', ')}`);
        }
        settings[field.key] = value;
      }
    }

    const next = this.toState(integration, { enabled: input.enabled, settings, secrets });
    if (input.enabled && !next.configured) {
      const missing = integration.fields.filter((field) => field.required && !next.context.config[field.key]);
      throw new HttpError(400, `Fill in ${missing.map((field) => field.label).join(', ')} before enabling ${integration.name}.`);
    }
    await this.store.save(id, next.record);
    return this.toView(next);
  }

  private toState(integration: Integration, record: IntegrationRecord): IntegrationState {
    const config: Record<string, string> = {};
    for (const field of integration.fields) {
      const value = (field.type === 'secret' ? record.secrets[field.key] : record.settings[field.key]) || field.default;
      if (value) config[field.key] = value;
    }
    const configured = integration.fields.every((field) => !field.required || Boolean(config[field.key]));
    return {
      integration,
      enabled: record.enabled,
      configured,
      record,
      context: { baseUrl: this.baseUrl, config, fetch: this.fetchImpl },
    };
  }

  private toView(state: IntegrationState): IntegrationView {
    const { integration, record } = state;
    const values: Record<string, string> = {};
    const secretsSet: Record<string, boolean> = {};
    for (const field of integration.fields) {
      if (field.type === 'secret') secretsSet[field.key] = Boolean(record.secrets[field.key]);
      else values[field.key] = record.settings[field.key] ?? field.default ?? '';
    }
    return {
      id: integration.id,
      name: integration.name,
      description: integration.description,
      enabled: state.enabled,
      configured: state.configured,
      fields: integration.fields,
      values,
      secretsSet,
      setup: integration.setupSteps(this.baseUrl),
    };
  }
}
