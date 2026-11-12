CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT uuidv7(),
    email             text NOT NULL CHECK (email = lower(email) AND position('@' in email) > 1),
    name              text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    password_hash     text,
    is_instance_admin boolean NOT NULL DEFAULT false,
    disabled_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_login_at     timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE organizations (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 48),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE org_members (
    org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON org_members (user_id);

CREATE TABLE teams (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    slug        text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 48),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug),
    UNIQUE (org_id, id)
);

CREATE TABLE team_members (
    org_id   uuid NOT NULL,
    team_id  uuid NOT NULL,
    user_id  uuid NOT NULL,
    added_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (org_id, team_id) REFERENCES teams (org_id, id) ON DELETE CASCADE,
    FOREIGN KEY (org_id, user_id) REFERENCES org_members (org_id, user_id) ON DELETE CASCADE
);
CREATE INDEX team_members_user_idx ON team_members (user_id);

CREATE TABLE roles (
    id          uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id      uuid REFERENCES organizations (id) ON DELETE CASCADE,
    key         text NOT NULL CHECK (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(key) <= 48),
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
    description text NOT NULL DEFAULT '',
    permissions text[] NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_builtin_key ON roles (key) WHERE org_id IS NULL;
CREATE UNIQUE INDEX roles_org_key ON roles (org_id, key) WHERE org_id IS NOT NULL;

INSERT INTO roles (key, name, description) VALUES
    ('owner',    'Owner',    'Full control, including deleting the organization.'),
    ('admin',    'Admin',    'Manage members, teams, access, projects and deployments.'),
    ('editor',   'Editor',   'Create and edit projects. Cannot deploy or manage access.'),
    ('deployer', 'Deployer', 'View projects and run deployments.'),
    ('viewer',   'Viewer',   'Read-only access.');

CREATE TYPE subject_kind AS ENUM ('user', 'team');
CREATE TYPE scope_kind AS ENUM ('org', 'team', 'project', 'environment');

CREATE TABLE role_bindings (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    org_id       uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    role_id      uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    subject_kind subject_kind NOT NULL,
    subject_id   uuid NOT NULL,
    scope_kind   scope_kind NOT NULL,
    scope_id     uuid,
    env_key      text,
    expires_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    CHECK ((scope_kind = 'org') = (scope_id IS NULL)),
    CHECK ((scope_kind = 'environment') = (env_key IS NOT NULL))
);
CREATE INDEX role_bindings_subject_idx ON role_bindings (org_id, subject_kind, subject_id);
CREATE INDEX role_bindings_expiry_idx ON role_bindings (expires_at) WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX role_bindings_unique ON role_bindings
    (org_id, role_id, subject_kind, subject_id, scope_kind, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'), coalesce(env_key, ''));
