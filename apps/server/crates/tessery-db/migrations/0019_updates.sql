-- Automatic updates run inside a daily window of whole UTC hours, from auto_update_from up to auto_update_to.
ALTER TABLE instance_settings
    ADD COLUMN auto_update      boolean  NOT NULL DEFAULT false,
    ADD COLUMN auto_update_from smallint NOT NULL DEFAULT 3 CHECK (auto_update_from BETWEEN 0 AND 23),
    ADD COLUMN auto_update_to   smallint NOT NULL DEFAULT 5 CHECK (auto_update_to BETWEEN 0 AND 23);

-- Every update and rollback this instance started, newest last. A rollback goes back to the version the last update
-- came from.
CREATE TABLE system_updates (
    id           uuid PRIMARY KEY DEFAULT uuidv7(),
    from_version text NOT NULL,
    to_version   text NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('update', 'rollback')),
    automatic    boolean NOT NULL DEFAULT false,
    started_by   uuid REFERENCES users (id) ON DELETE SET NULL,
    started_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX system_updates_started_idx ON system_updates (started_at DESC);
