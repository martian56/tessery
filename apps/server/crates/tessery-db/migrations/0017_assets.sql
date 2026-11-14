CREATE TABLE assets (
    id            uuid PRIMARY KEY,
    project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    content_type  text NOT NULL,
    size_bytes    bigint NOT NULL,
    sha256        bytea NOT NULL,
    width         integer,
    height        integer,
    created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_project_idx ON assets (project_id, created_at DESC);
