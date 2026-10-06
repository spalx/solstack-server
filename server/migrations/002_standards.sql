-- Engineering standards: Markdown documents agents follow when working on a repository.
CREATE TABLE standards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  content text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  -- When false, the standard applies only to the repositories in standard_repositories.
  applies_to_all boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE standard_repositories (
  standard_id uuid NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
  repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  PRIMARY KEY (standard_id, repository_id)
);
CREATE INDEX standard_repositories_repository_idx ON standard_repositories (repository_id);
