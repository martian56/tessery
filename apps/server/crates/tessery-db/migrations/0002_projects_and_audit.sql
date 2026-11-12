CREATE TABLE projects (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    team_id     uuid,
    slug        text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 48),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '',
    icon        text NOT NULL DEFAULT '',
    doc         jsonb NOT NULL,
    version     integer NOT NULL DEFAULT 1 CHECK (version > 0),
    node_count  integer GENERATED ALWAYS AS (coalesce(jsonb_array_length(doc -> 'nodes'), 0)) VIRTUAL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE (org_id, slug),
    FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE SET NULL (team_id)
);
CREATE INDEX projects_org_updated_idx ON projects (org_id, updated_at DESC);

CREATE TABLE project_versions (
    project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    version    integer NOT NULL,
    doc        jsonb NOT NULL,
    message    text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES users (id) ON DELETE SET NULL,
    PRIMARY KEY (project_id, version)
);

CREATE TYPE audit_result AS ENUM ('allowed', 'denied', 'bypassed');

CREATE TABLE audit_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at            timestamptz NOT NULL DEFAULT now(),
    org_id        uuid,
    actor_id      uuid,
    actor_email   text,
    action        text NOT NULL,
    resource_type text NOT NULL,
    resource_id   text,
    result        audit_result NOT NULL,
    ip            text,
    user_agent    text,
    details       jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_org_at_idx ON audit_events (org_id, at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, at DESC);

CREATE TYPE export_status AS ENUM ('queued', 'running', 'done', 'failed');

CREATE TABLE audit_exports (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    requested_by uuid REFERENCES users (id) ON DELETE SET NULL,
    format       text NOT NULL CHECK (format IN ('json', 'csv')),
    filters      jsonb NOT NULL DEFAULT '{}',
    status       export_status NOT NULL DEFAULT 'queued',
    row_count    integer,
    content      text,
    error        text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);
CREATE INDEX audit_exports_org_idx ON audit_exports (org_id, created_at DESC);

CREATE TABLE instance_settings (
    id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
    setup_completed_at timestamptz,
    allow_org_creation boolean NOT NULL DEFAULT true
);
INSERT INTO instance_settings DEFAULT VALUES;
