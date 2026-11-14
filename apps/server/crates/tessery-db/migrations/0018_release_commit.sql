-- A release can deploy a commit made on top of its checkpoint: the checkpoint's code with the environment settings
-- in force when the release was requested. Empty means the checkpoint's own commit.
ALTER TABLE releases ADD COLUMN commit_sha text;
