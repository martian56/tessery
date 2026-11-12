CREATE TABLE spans (
    project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    env_key     text NOT NULL,
    trace_id    text NOT NULL,
    span_id     text NOT NULL,
    parent_id   text,
    service     text NOT NULL,
    name        text NOT NULL,
    kind        smallint NOT NULL,
    start_at    timestamptz NOT NULL,
    duration_us bigint NOT NULL,
    error       boolean NOT NULL,
    attributes  jsonb NOT NULL DEFAULT '{}',
    PRIMARY KEY (project_id, env_key, trace_id, span_id)
);
CREATE INDEX spans_recent_idx ON spans (project_id, env_key, start_at DESC);
