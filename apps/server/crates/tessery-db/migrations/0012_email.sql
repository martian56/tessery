ALTER TABLE instance_settings
    ADD COLUMN smtp jsonb,
    ADD COLUMN smtp_password bytea;

CREATE TABLE password_tokens (
    hash        bytea PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose     text NOT NULL CHECK (purpose IN ('reset', 'invite')),
    expires_at  timestamptz NOT NULL,
    used_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_tokens_user_idx ON password_tokens (user_id);
