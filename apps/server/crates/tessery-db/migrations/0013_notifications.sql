CREATE TABLE notification_channels (
    id            uuid PRIMARY KEY,
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    kind          text NOT NULL CHECK (kind IN ('email', 'slack', 'discord', 'telegram', 'webhook')),
    target        bytea NOT NULL,
    target_hint   text NOT NULL DEFAULT '',
    events        text[] NOT NULL,
    envs          text[] NOT NULL DEFAULT '{}',
    enabled       boolean NOT NULL DEFAULT true,
    last_sent_at  timestamptz,
    last_error    text,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_channels_project_idx ON notification_channels (project_id);
