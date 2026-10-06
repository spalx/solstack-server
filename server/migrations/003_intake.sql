-- The standards table now holds every kind of guidance agents receive as skills:
--   standard  engineering standards (how to write code)
--   intake    intake rules (how to write tasks, comments, pull requests, commit messages…)
--   context   product context (what the business and product are, users, domain terms)
-- They share one table because they become skills in the same folders, so their names must be unique.
ALTER TABLE standards
  ADD COLUMN kind text NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'intake', 'context')),
  -- Built-in intake sections. NULL for everything else.
  ADD COLUMN target text CHECK (target IN ('tasks', 'comments', 'pull_requests', 'commits')),
  ADD CONSTRAINT standards_target_is_intake CHECK (target IS NULL OR kind = 'intake');

CREATE UNIQUE INDEX standards_target_idx ON standards (target) WHERE target IS NOT NULL;
CREATE INDEX standards_kind_idx ON standards (kind);
