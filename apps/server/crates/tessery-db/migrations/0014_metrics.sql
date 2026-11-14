ALTER TABLE instance_settings
    ADD COLUMN metrics_retention_days integer NOT NULL DEFAULT 7 CHECK (metrics_retention_days BETWEEN 1 AND 90);

CREATE TABLE metric_samples (
    project_id          uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key             text NOT NULL,
    node                text NOT NULL,
    instance            text NOT NULL,
    at                  timestamptz NOT NULL,
    state               text NOT NULL,
    healthy             boolean,
    cpu_percent         double precision,
    memory_bytes        bigint,
    memory_limit_bytes  bigint,
    restarts            bigint
);
CREATE INDEX metric_samples_env_idx ON metric_samples (project_id, env_key, at);
CREATE INDEX metric_samples_at_idx ON metric_samples (at);

CREATE TABLE alert_rules (
    id             uuid PRIMARY KEY,
    project_id     uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key        text NOT NULL,
    node           text NOT NULL DEFAULT '',
    metric         text NOT NULL CHECK (metric IN ('cpu', 'memory', 'restarts', 'unhealthy')),
    threshold      double precision NOT NULL CHECK (threshold >= 0),
    minutes        integer NOT NULL CHECK (minutes BETWEEN 1 AND 1440),
    firing_nodes   text[] NOT NULL DEFAULT '{}',
    fired_at       timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alert_rules_env_idx ON alert_rules (project_id, env_key);
