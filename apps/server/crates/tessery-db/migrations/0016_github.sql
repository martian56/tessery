ALTER TABLE instance_settings
    ADD COLUMN github_app jsonb,
    ADD COLUMN github_app_key bytea,
    ADD COLUMN github_webhook_secret bytea;

ALTER TABLE project_remotes
    ADD COLUMN github_repo text,
    ADD COLUMN github_installation bigint,
    ADD COLUMN linked_by uuid REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN last_import_at timestamptz,
    ADD COLUMN last_import_error text;
CREATE INDEX project_remotes_github_repo_idx ON project_remotes (lower(github_repo)) WHERE github_repo IS NOT NULL;
