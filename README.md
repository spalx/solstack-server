# Solstack

Spec-driven development with coding agents, managed from one server. Solstack has two parts.

The **server**:

- **Admin console**: register repositories (each gets an API key for the client's `init`), choose which agents each one supports, and say which integrations its developers must connect.
- **MCP gateway**: a single MCP endpoint (`/mcp`) every agent can use. It exposes GitHub and Trello tools that act **as the developer**, using the authorization each developer granted individually.
- **Developer portal**: developers connect GitHub and Trello once, here, and create personal access tokens for their agents and the client app.

The **client** (`solstack` CLI):

- `solstack init` sets a repository up for its agents: OpenSpec in `.solstack/openspec/`, the `/ss-propose`, `/ss-apply` and `/ss-archive` commands, `AGENTS.md`, and each agent's MCP configuration.
- `solstack setup` gets a developer going: signs in, opens the GitHub and Trello authorizations the repository requires, and registers agents that keep their MCP config per user.
- `solstack mcp` is the local MCP server every agent starts. It forwards to the gateway with the developer's own token, so the committed configuration holds no secrets.

## Layout

```
server/   Express + TypeScript API, MCP gateway, Postgres migrations, tests
web/      Vue 3 + PrimeVue + Tailwind admin console and developer portal
client/   The solstack CLI: repository setup, agent files, MCP bridge, OpenSpec wrapper
docker/   Postgres init scripts
```

## Local development

Requirements: Node 24+, Docker.

```bash
cp .env.example .env                    # then set ENCRYPTION_KEY (openssl rand -base64 32)
docker compose up -d db                 # Postgres on localhost:5432
npm install
npm run dev                             # API on :3000, web on :5173 (proxies /api and /mcp)
npm run admin:create -- you@example.com "Your Name"   # prints an invite link to set your password
```

Open the invite link, set a password, and you land in the admin console. In development `BASE_URL` must be `http://localhost:5173` so OAuth callbacks and links go through Vite.

To try the CLI from this checkout, link it once (`npm link -w client`) so `solstack` is on your PATH. Agents start `solstack mcp` by name.

Tests run against the `solstack_test` database the compose file creates (the client tests need no database):

```bash
npm test
```

## Deploying to a VPS

1. Point a domain at the VPS and put an HTTPS reverse proxy in front of port 3000. OAuth providers require HTTPS callbacks. With [Caddy](https://caddyserver.com/), the whole config is:
   ```
   solstack.example.com {
       reverse_proxy localhost:3000
   }
   ```
2. Create `.env` next to `docker-compose.yml`:
   ```
   BASE_URL=https://solstack.example.com
   ENCRYPTION_KEY=<openssl rand -base64 32>
   POSTGRES_PASSWORD=<a strong password>
   TRUST_PROXY=1
   ```
3. Start everything and create the first admin:
   ```bash
   docker compose --profile app up -d --build
   docker compose exec app node server/dist/cli.js create-admin you@example.com "Your Name"
   ```

The server runs database migrations on startup. **Back up `ENCRYPTION_KEY`.** It encrypts integration secrets and every developer's GitHub and Trello tokens, so losing it means everyone has to reconnect.

If a user loses their password, an admin can issue a reset link from the Users page. From the shell: `node server/dist/cli.js reset-link <email>`.

## Setting up the integrations

Each integration's page under **Administration → Integrations** shows the exact values to copy.

**GitHub**: create an OAuth App (organization settings → Developer settings → OAuth Apps). Set the callback URL to `<BASE_URL>/api/connect/github/callback`. Paste the client ID and secret, then enable. A GitHub App also works: its expiring user tokens are refreshed automatically. If your organization restricts third-party access, an owner must approve the app.

**Trello**: create a Power-Up at <https://trello.com/power-ups/admin>, generate its API key, and add `BASE_URL` to the key's **Allowed origins**. Paste the API key, then enable. Trello returns the developer's token in the URL fragment, so the web app's `/connect/trello` page reads it and posts it to the server.

## The developer portal

1. Developers open their invite link and set a password.
2. **Connections**: connect GitHub and Trello. Each connection acts as that developer, with their own permissions. `solstack setup` and `solstack connect` open these same pages.
3. **Agent access**: create a token for `solstack login`. The page also shows how to add the gateway to an agent by hand, for agents outside a Solstack repository.

If a developer hasn't connected an integration, or their authorization expired, tool calls return an error with the link to fix it, and the agent relays it.

## Using the client

### Setting up a repository (once, by whoever owns it)

An admin adds the repository under **Administration → Repositories**, picks its agents and required integrations, and copies its API key. Then, in the repository:

```bash
solstack init --key ssr_… --server https://solstack.example.com
git add -A && git commit -m "Set up Solstack"
```

`init` writes:

| Path | What it is |
|---|---|
| `.solstack/config.json` | Server, repository, agents, command prefix |
| `.solstack/commands/*.md` | The full propose, apply and archive instructions, shared by every agent |
| `.solstack/openspec/` | OpenSpec specs and changes |
| `AGENTS.md`, `CLAUDE.md` | A marked section explaining the workflow; anything outside the markers is left alone |
| `.claude/commands/`, `.cursor/commands/`, `.github/prompts/`, `.agents/skills/`, `.devin/workflows/`, `.gemini/commands/` | Short command files for each selected agent, pointing at `.solstack/commands/` |
| `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json` | A `solstack` MCP server entry, merged with any servers already there |

It also installs the repository's **engineering standards** as agent skills: one `SKILL.md` per standard in each agent's skills folder (`.claude/skills/`, `.cursor/skills/`, `.github/skills/`, `.agents/skills/`, `.devin/skills/`, `.gemini/skills/`). Agents read each skill's description and load the full standard only when the task matches it, so write descriptions that say when a standard applies.

Admins manage standards under **Administration → Standards**: upload Markdown files (frontmatter `name` and `description` are used, so existing `SKILL.md` files keep their identity) or write them in the editor, and apply each one to all repositories or selected ones. Skills a team wrote themselves are never overwritten.

When the admin changes the repository's agents or standards, run `solstack update` and commit the result. `solstack status` says when the installed standards are out of date. Files belonging to agents that were removed are deleted. Use `--prefix` on `init` for a command prefix other than `ss`.

### Setting up as a developer (once per machine)

```bash
npm install -g @solstack/cli
solstack setup     # in the repository
```

`setup` asks for a personal access token (created under **Agent access**), opens the authorization page for each integration the repository requires and waits until it is connected, and adds the MCP server to Codex. Devin Desktop needs it added by hand (`solstack setup` says how). Claude Code asks once to approve the project's `solstack` MCP server.

### Day to day

| Command | Does |
|---|---|
| `/ss-propose <idea, GitHub issue or Trello card>` | Plans the change in `.solstack/openspec/changes/` without touching code |
| `/ss-apply [change]` | Implements the plan task by task |
| `/ss-archive [change]` | Merges the change's specs into the main specs and archives it |
| `solstack status` | Shows sign-in, integrations and open changes; exits 1 if something required is missing |
| `solstack connect [github\|trello]` | Reconnects an integration |
| `solstack spec <args>` | Runs the bundled OpenSpec CLI against `.solstack/openspec` |

In Codex the commands are skills: `$ss-propose`, `$ss-apply` and `$ss-archive`.

For CI, `SOLSTACK_SERVER` and `SOLSTACK_TOKEN` override the stored sign-in.

## Client API

Token-authenticated (`Authorization: Bearer …`). There are no cookies on these routes.

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/v1/repository` | Repository API key (`ssr_…`) | Repository, supported agents, required integrations, MCP URL |
| `GET /api/v1/repositories/:id` | Developer token | The same, for `solstack update` |
| `GET /api/v1/repository/standards` | Repository API key | Enabled standards that apply to the repository |
| `GET /api/v1/repositories/:id/standards` | Developer token | The same, for `solstack update` |
| `GET /api/v1/me` | Developer token (`ssd_…`) | User and connection status for each integration |
| `POST /mcp` | Developer token | MCP over Streamable HTTP (stateless) |

## Security notes

- Integration secrets and developer tokens are encrypted at rest (AES-256-GCM). Session, access and repository tokens are stored only as SHA-256 hashes. Passwords use scrypt.
- Cookie-authenticated requests that change state must come from `BASE_URL`'s origin. Session cookies are `HttpOnly` and `SameSite=Lax` (and `Secure` over HTTPS).
- OAuth `state` values are single-use, expire after 10 minutes, and are bound to the user who started the flow.
- The activity log records which tool was called, by whom, and whether it succeeded. Arguments and results are never stored.
