CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'developer')),
  password_hash text,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One-time links that let a new user set their password.
CREATE TABLE invites (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Personal tokens developers use from their agents (MCP) and the client app.
CREATE TABLE access_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX access_tokens_user_idx ON access_tokens (user_id);

-- Admin configuration per integration. `secrets` is an encrypted JSON object.
CREATE TABLE integrations (
  id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A developer's authorization with an integration. `credentials` is an encrypted JSON object.
CREATE TABLE connections (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  credentials text NOT NULL,
  account_name text NOT NULL,
  scopes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invalid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, integration_id)
);

CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  integration_id text NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE repositories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  git_url text,
  agents text[] NOT NULL DEFAULT '{}',
  required_integrations text[] NOT NULL DEFAULT '{}',
  api_key_hash text NOT NULL UNIQUE,
  api_key_prefix text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Audit trail of gateway tool calls. Arguments are deliberately not stored.
CREATE TABLE tool_calls (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  integration_id text,
  tool text NOT NULL,
  ok boolean NOT NULL,
  duration_ms integer NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_calls_created_idx ON tool_calls (created_at DESC);
