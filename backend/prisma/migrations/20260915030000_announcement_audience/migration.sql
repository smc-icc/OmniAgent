ALTER TABLE agent_announcements
  ADD COLUMN status TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN audience_mode TEXT NOT NULL DEFAULT 'all',
  ADD COLUMN recipient_ids INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN vdn_id INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN starts_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN ends_at TIMESTAMP(3),
  ADD COLUMN author_id INTEGER;
UPDATE agent_announcements SET starts_at = published_at;
ALTER TABLE agent_announcements ADD CONSTRAINT announcement_audience_check CHECK (audience_mode IN ('all','selected'));
ALTER TABLE agent_announcements ADD CONSTRAINT announcement_status_check CHECK (status IN ('draft','published'));
ALTER TABLE agent_announcements ADD CONSTRAINT announcement_time_check CHECK (ends_at IS NULL OR ends_at > starts_at);
CREATE INDEX announcement_visibility_idx ON agent_announcements(account_id, vdn_id, status, starts_at);
CREATE INDEX announcement_recipients_idx ON agent_announcements USING GIN(recipient_ids);
CREATE TABLE agent_announcement_groups (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL,
  vdn_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  operator_ids INTEGER[] NOT NULL DEFAULT '{}',
  created_by INTEGER NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_id, vdn_id, name)
);
