DROP INDEX releases_one_pending_per_env;
CREATE UNIQUE INDEX releases_one_active_per_env ON releases (project_id, env_key) WHERE status IN ('pending', 'queued', 'deploying');
