CREATE TABLE integrations (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    provider    text NOT NULL,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    secret      bytea NOT NULL,
    summary     jsonb NOT NULL DEFAULT '{}',
    last_check  jsonb,
    checked_at  timestamptz,
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);
CREATE INDEX integrations_org_idx ON integrations (org_id, provider);
