ALTER TABLE servers
    ADD COLUMN integration_id uuid REFERENCES integrations (id) ON DELETE SET NULL,
    ADD COLUMN provider text,
    ADD COLUMN region text,
    ADD COLUMN size text,
    ADD COLUMN resource_id text,
    ADD COLUMN status text NOT NULL DEFAULT 'ready' CHECK (status IN ('creating', 'configuring', 'ready', 'failed')),
    ADD COLUMN status_detail text NOT NULL DEFAULT '';
