# Harness

Server for managing AI-assisted development across repositories and coding agents:

- **Admin console**: register repositories (each gets an API key for the client's `init`), choose which agents each one supports, and say which integrations its developers must connect.
- **MCP gateway**: a single MCP endpoint (`/mcp`) every agent can use. It exposes GitHub and Trello tools that act **as the developer**, using the authorization each developer granted individually.
- **Developer portal**: developers connect GitHub and Trello once, here, and create personal access tokens for their agents and the client app.

The client app (`init`, slash commands, writing agent configuration) is not built yet. It will use the `/api/v1` endpoints described below.

## Layout

```
server/   Express + TypeScript API, MCP gateway, Postgres migrations, tests
web/      Vue 3 + PrimeVue + Tailwind admin console and developer portal
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

Tests run against the `harness_test` database the compose file creates:

```bash
npm test
```

## Deploying to a VPS

1. Point a domain at the VPS and put an HTTPS reverse proxy in front of port 3000. OAuth providers require HTTPS callbacks. With [Caddy](https://caddyserver.com/), the whole config is:
   ```
   harness.example.com {
       reverse_proxy localhost:3000
   }
   ```
2. Create `.env` next to `docker-compose.yml`:
   ```
   BASE_URL=https://harness.example.com
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

## How developers use it

1. Open the invite link and set a password.
2. **Connections**: connect GitHub and Trello. Each connection acts as that developer, with their own permissions.
3. **Agent access**: create a token, then add the gateway to the agent with the snippet shown (Claude Code, Cursor, VS Code or Codex). The client app will automate this step.

If a developer hasn't connected an integration, or their authorization expired, tool calls return an error with the link to fix it, and the agent relays it.

## API for the client app

Token-authenticated (`Authorization: Bearer …`). There are no cookies on these routes.

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /api/v1/repository` | Repository API key (`hsr_…`) | Repository, supported agents, required integrations, MCP URL |
| `GET /api/v1/me` | Developer token (`hsd_…`) | User and connection status for each integration |
| `POST /mcp` | Developer token | MCP over Streamable HTTP (stateless) |

## Security notes

- Integration secrets and developer tokens are encrypted at rest (AES-256-GCM). Session, access and repository tokens are stored only as SHA-256 hashes. Passwords use scrypt.
- Cookie-authenticated requests that change state must come from `BASE_URL`'s origin. Session cookies are `HttpOnly` and `SameSite=Lax` (and `Secure` over HTTPS).
- OAuth `state` values are single-use, expire after 10 minutes, and are bound to the user who started the flow.
- The activity log records which tool was called, by whom, and whether it succeeded. Arguments and results are never stored.
