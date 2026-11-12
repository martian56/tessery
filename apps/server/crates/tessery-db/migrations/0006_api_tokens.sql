CREATE TABLE api_tokens (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    prefix       text NOT NULL,
    hash         bytea NOT NULL UNIQUE,
    permissions  text[],
    project_id   uuid REFERENCES projects (id) ON DELETE CASCADE,
    expires_at   timestamptz,
    last_used_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz
);
CREATE INDEX api_tokens_user_idx ON api_tokens (user_id, created_at DESC);
