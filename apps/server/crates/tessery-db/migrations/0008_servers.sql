CREATE TABLE servers (
    id            uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id        uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    address       text NOT NULL CHECK (address LIKE 'ssh://%'),
    private_key   bytea NOT NULL,
    public_key    text NOT NULL DEFAULT '',
    known_hosts   text NOT NULL DEFAULT '',
    last_check    jsonb,
    checked_at    timestamptz,
    created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);
CREATE INDEX servers_org_idx ON servers (org_id, name);
