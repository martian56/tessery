ALTER TYPE release_status ADD VALUE IF NOT EXISTS 'queued' BEFORE 'released';
ALTER TYPE release_status ADD VALUE IF NOT EXISTS 'deploying' BEFORE 'released';

ALTER TABLE releases
    ADD COLUMN started_at  timestamptz,
    ADD COLUMN finished_at timestamptz,
    ADD COLUMN endpoints   jsonb NOT NULL DEFAULT '[]';

CREATE TABLE release_logs (
    release_id uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
    seq        bigint GENERATED ALWAYS AS IDENTITY,
    at         timestamptz NOT NULL DEFAULT now(),
    line       text NOT NULL,
    PRIMARY KEY (release_id, seq)
);

CREATE TABLE environment_secrets (
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key     text NOT NULL,
    name        text NOT NULL CHECK (name ~ '^[A-Z_][A-Z0-9_]{0,127}$'),
    cipher      bytea NOT NULL,
    generated   boolean NOT NULL DEFAULT false,
    updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, env_key, name)
);
