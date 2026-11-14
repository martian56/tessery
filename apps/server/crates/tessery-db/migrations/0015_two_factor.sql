ALTER TABLE users
    ADD COLUMN totp_secret bytea,
    ADD COLUMN two_factor_enabled_at timestamptz,
    ADD COLUMN totp_last_step bigint NOT NULL DEFAULT 0;

CREATE TABLE recovery_codes (
    user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    hash      bytea NOT NULL,
    used_at   timestamptz,
    PRIMARY KEY (user_id, hash)
);

ALTER TABLE organizations ADD COLUMN require_two_factor boolean NOT NULL DEFAULT false;
