import { z } from 'zod';
import { defineTool, readErrorMessage, UpstreamError, type Integration, type IntegrationContext, type ToolContext } from './types.js';

const PROVIDER = 'Trello';
const API = 'https://api.trello.com/1';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;

interface TrelloLabel {
  id: string;
  name: string;
  color: string | null;
}

interface TrelloCard {
  id: string;
  name: string;
  desc?: string;
  idList: string;
  idBoard?: string;
  due: string | null;
  dueComplete: boolean;
  closed?: boolean;
  labels: TrelloLabel[];
  url: string;
  dateLastActivity?: string;
}

const id = (what: string) => z.string().min(1).describe(`${what} ID`);

/** Trello accepts the API key and user token in an OAuth-style header, which keeps them out of URLs and logs. */
function authorizationHeader(apiKey: string, token: string): string {
  return `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"`;
}

async function trelloRequest<T>(
  context: IntegrationContext,
  token: string,
  method: string,
  resource: string,
  options: { query?: Record<string, string | number | boolean | undefined>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const url = new URL(`${API}/${resource}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  const response = await context.fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: authorizationHeader(context.config.apiKey ?? '', token),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new UpstreamError(PROVIDER, response.status, `Trello ${response.status}: ${await readErrorMessage(response)}`);
  }
  return (await response.json()) as T;
}

function trello<T>(context: ToolContext, method: string, resource: string, options?: Parameters<typeof trelloRequest>[4]) {
  return trelloRequest<T>(context, context.credentials.accessToken, method, resource, options);
}

function summarizeCard(card: TrelloCard, includeDescription = false) {
  return {
    id: card.id,
    name: card.name,
    listId: card.idList,
    ...(card.idBoard ? { boardId: card.idBoard } : {}),
    labels: card.labels.map((label) => label.name || label.color),
    due: card.due,
    dueComplete: card.dueComplete,
    ...(card.closed !== undefined ? { archived: card.closed } : {}),
    url: card.url,
    ...(includeDescription ? { description: card.desc ?? '' } : {}),
  };
}

const CARD_FIELDS = 'name,desc,idList,idBoard,due,dueComplete,closed,labels,url,dateLastActivity';

export const trelloIntegration: Integration = {
  id: 'trello',
  name: 'Trello',
  description: 'Boards, lists and cards, acting as each developer.',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'text',
      required: true,
      help: 'From the Trello Power-Up admin portal (trello.com/power-ups/admin) → your Power-Up → API key.',
    },
    {
      key: 'appName',
      label: 'App name',
      type: 'text',
      required: false,
      default: 'Harness',
      help: 'Shown to developers on Trello\'s authorization screen.',
    },
    {
      key: 'scope',
      label: 'Access',
      type: 'select',
      required: false,
      default: 'read,write',
      options: [
        { label: 'Read and write', value: 'read,write' },
        { label: 'Read only', value: 'read' },
      ],
    },
    {
      key: 'expiration',
      label: 'Token lifetime',
      type: 'select',
      required: false,
      default: 'never',
      options: [
        { label: 'Never expires', value: 'never' },
        { label: '30 days', value: '30days' },
        { label: '1 day', value: '1day' },
      ],
      help: 'Developers must reconnect when their token expires.',
    },
  ],

  setupSteps(baseUrl) {
    return [
      {
        label: 'Allowed origin',
        value: baseUrl,
        help: 'Add this to your Power-Up\'s API key "Allowed origins" so Trello can return developers to this server.',
      },
    ];
  },

  authorizeUrl(context, state) {
    const url = new URL('https://trello.com/1/authorize');
    url.searchParams.set('key', context.config.apiKey ?? '');
    url.searchParams.set('name', context.config.appName ?? 'Harness');
    url.searchParams.set('scope', context.config.scope ?? 'read,write');
    url.searchParams.set('expiration', context.config.expiration ?? 'never');
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('callback_method', 'fragment');
    // Trello returns the token in the URL fragment, which only the browser can read; the web app posts it back.
    url.searchParams.set('return_url', `${context.baseUrl}/connect/trello?state=${encodeURIComponent(state)}`);
    return url.toString();
  },

  async completeAuthorization(context, params) {
    const token = params.token ?? '';
    if (!TOKEN_PATTERN.test(token)) throw new UpstreamError(PROVIDER, 400, 'Trello did not return a valid token');
    const member = await trelloRequest<{ username: string }>(context, token, 'GET', 'members/me', {
      query: { fields: 'username' },
    });
    const expiration = context.config.expiration ?? 'never';
    const lifetimeDays = expiration === '30days' ? 30 : expiration === '1day' ? 1 : undefined;
    return {
      credentials: {
        accessToken: token,
        expiresAt: lifetimeDays ? new Date(Date.now() + lifetimeDays * 86_400_000).toISOString() : undefined,
      },
      accountName: member.username,
      scopes: context.config.scope,
    };
  },

  tools: [
    defineTool({
      name: 'trello_list_boards',
      title: 'List boards',
      description: 'List the Trello boards the developer is a member of.',
      readOnly: true,
      inputSchema: { include_closed: z.boolean().default(false) },
      async run(args, context) {
        const boards = await trello<{ id: string; name: string; closed: boolean; url: string; dateLastActivity: string | null }[]>(
          context,
          'GET',
          'members/me/boards',
          { query: { filter: args.include_closed ? 'all' : 'open', fields: 'name,closed,url,dateLastActivity' } },
        );
        return boards.map((b) => ({ id: b.id, name: b.name, closed: b.closed, lastActivity: b.dateLastActivity, url: b.url }));
      },
    }),

    defineTool({
      name: 'trello_get_board',
      title: 'Get board',
      description: 'Get a board with its open lists and labels.',
      readOnly: true,
      inputSchema: { board_id: id('Board') },
      async run(args, context) {
        const board = await trello<{
          id: string;
          name: string;
          desc: string;
          url: string;
          lists: { id: string; name: string }[];
          labels: TrelloLabel[];
        }>(context, 'GET', `boards/${encodeURIComponent(args.board_id)}`, {
          query: { fields: 'name,desc,url', lists: 'open', list_fields: 'name', labels: 'all', label_fields: 'name,color' },
        });
        return {
          id: board.id,
          name: board.name,
          description: board.desc,
          url: board.url,
          lists: board.lists.map((l) => ({ id: l.id, name: l.name })),
          labels: board.labels.map((l) => ({ id: l.id, name: l.name, color: l.color })),
        };
      },
    }),

    defineTool({
      name: 'trello_list_cards',
      title: 'List cards',
      description: 'List open cards on a board or in a single list. Provide exactly one of board_id or list_id.',
      readOnly: true,
      inputSchema: { board_id: id('Board').optional(), list_id: id('List').optional() },
      async run(args, context) {
        if (Boolean(args.board_id) === Boolean(args.list_id)) {
          throw new UpstreamError(PROVIDER, 400, 'Provide exactly one of board_id or list_id');
        }
        const resource = args.list_id
          ? `lists/${encodeURIComponent(args.list_id)}/cards`
          : `boards/${encodeURIComponent(args.board_id!)}/cards/open`;
        const cards = await trello<TrelloCard[]>(context, 'GET', resource, { query: { fields: CARD_FIELDS } });
        return cards.map((card) => summarizeCard(card));
      },
    }),

    defineTool({
      name: 'trello_get_card',
      title: 'Get card',
      description: 'Get a card with its description, checklists and comments.',
      readOnly: true,
      inputSchema: { card_id: id('Card') },
      async run(args, context) {
        const card = await trello<
          TrelloCard & {
            checklists?: { name: string; checkItems: { name: string; state: string }[] }[];
            actions?: { type: string; date: string; data: { text?: string }; memberCreator?: { username: string } }[];
          }
        >(context, 'GET', `cards/${encodeURIComponent(args.card_id)}`, {
          query: { fields: CARD_FIELDS, checklists: 'all', actions: 'commentCard', actions_limit: 50 },
        });
        return {
          ...summarizeCard(card, true),
          checklists: (card.checklists ?? []).map((c) => ({
            name: c.name,
            items: c.checkItems.map((item) => ({ name: item.name, done: item.state === 'complete' })),
          })),
          comments: (card.actions ?? []).map((a) => ({ author: a.memberCreator?.username ?? null, text: a.data.text ?? '', date: a.date })),
        };
      },
    }),

    defineTool({
      name: 'trello_create_card',
      title: 'Create card',
      description: 'Create a card in a list.',
      readOnly: false,
      inputSchema: {
        list_id: id('List'),
        name: z.string().min(1),
        description: z.string().optional(),
        due: z.string().optional().describe('ISO 8601 date'),
        label_ids: z.array(z.string()).optional(),
        position: z.enum(['top', 'bottom']).default('bottom'),
      },
      async run(args, context) {
        const card = await trello<TrelloCard>(context, 'POST', 'cards', {
          body: {
            idList: args.list_id,
            name: args.name,
            desc: args.description,
            due: args.due,
            idLabels: args.label_ids?.join(','),
            pos: args.position,
          },
        });
        return summarizeCard(card, true);
      },
    }),

    defineTool({
      name: 'trello_update_card',
      title: 'Update card',
      description: 'Rename, edit, move to another list, set the due date, or archive a card.',
      readOnly: false,
      inputSchema: {
        card_id: id('Card'),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        list_id: id('Destination list').optional(),
        due: z.string().nullable().optional().describe('ISO 8601 date, or null to clear'),
        due_complete: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
      async run(args, context) {
        const card = await trello<TrelloCard>(context, 'PUT', `cards/${encodeURIComponent(args.card_id)}`, {
          body: {
            name: args.name,
            desc: args.description,
            idList: args.list_id,
            due: args.due,
            dueComplete: args.due_complete,
            closed: args.archived,
          },
        });
        return summarizeCard(card, true);
      },
    }),

    defineTool({
      name: 'trello_add_comment',
      title: 'Comment on card',
      description: 'Add a comment to a card.',
      readOnly: false,
      inputSchema: { card_id: id('Card'), text: z.string().min(1) },
      async run(args, context) {
        const action = await trello<{ id: string; date: string }>(
          context,
          'POST',
          `cards/${encodeURIComponent(args.card_id)}/actions/comments`,
          { body: { text: args.text } },
        );
        return { id: action.id, date: action.date };
      },
    }),
  ],
};
