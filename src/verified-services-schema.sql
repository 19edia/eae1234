ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_idrkc VARCHAR(16);
ALTER TABLE reports ADD COLUMN IF NOT EXISTS card_version INTEGER;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS interaction_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS reports_interaction_unique ON reports(interaction_id) WHERE interaction_id IS NOT NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS member_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS idrkc VARCHAR(16);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS card_version INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS notification_job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS service_deliveries (
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
 recipient_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,recipient_id)
);
ALTER TABLE service_deliveries ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS idrkc_deliveries (
 id SERIAL PRIMARY KEY,
 member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 discord_id TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 identity_version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','absent','superseded')),
 job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
 message_id TEXT,
 delivered_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(member_id,guild_id,identity_version)
);
ALTER TABLE idrkc_deliveries ENABLE ROW LEVEL SECURITY;
