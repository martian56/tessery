CREATE TABLE checkpoints (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    seq         integer NOT NULL,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    message     text NOT NULL DEFAULT '',
    version     integer NOT NULL,
    commit_sha  text NOT NULL,
    file_count  integer NOT NULL,
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, seq)
);
CREATE INDEX checkpoints_project_idx ON checkpoints (project_id, seq DESC);

CREATE TYPE release_status AS ENUM ('pending', 'released', 'rejected', 'cancelled', 'failed');

CREATE TABLE releases (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key       text NOT NULL,
    checkpoint_id uuid NOT NULL REFERENCES checkpoints (id) ON DELETE CASCADE,
    from_env      text,
    status        release_status NOT NULL,
    note          text NOT NULL DEFAULT '',
    requested_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    decided_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    decided_at    timestamptz,
    decision_note text NOT NULL DEFAULT '',
    error         text
);
CREATE INDEX releases_project_idx ON releases (project_id, requested_at DESC);
CREATE UNIQUE INDEX releases_one_pending_per_env ON releases (project_id, env_key) WHERE status = 'pending';

CREATE TABLE environment_heads (
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key       text NOT NULL,
    checkpoint_id uuid NOT NULL REFERENCES checkpoints (id) ON DELETE CASCADE,
    release_id    uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, env_key)
);

CREATE TABLE project_remotes (
    project_id       uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
    url              text NOT NULL,
    username         text NOT NULL DEFAULT '',
    token_cipher     bytea,
    auto_push        boolean NOT NULL DEFAULT true,
    last_push_at     timestamptz,
    last_push_ok     boolean,
    last_push_error  text,
    updated_by       uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
