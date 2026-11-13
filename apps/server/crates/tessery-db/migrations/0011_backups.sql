CREATE TABLE backups (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key     text NOT NULL,
    node        text NOT NULL,
    kind        text NOT NULL CHECK (kind IN ('scheduled', 'manual', 'release')),
    status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'restoring', 'restored')),
    bucket      text NOT NULL DEFAULT '',
    object_key  text NOT NULL DEFAULT '',
    size_bytes  bigint NOT NULL DEFAULT 0,
    error       text NOT NULL DEFAULT '',
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX backups_env_idx ON backups (project_id, env_key, created_at DESC);
