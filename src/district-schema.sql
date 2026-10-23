CREATE TABLE IF NOT EXISTS application_migrations (key TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
ALTER TABLE application_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check CHECK(role IN ('admin','sublider','moderador','recrutador'));
ALTER TABLE members ADD COLUMN IF NOT EXISTS migration_required BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE members ADD COLUMN IF NOT EXISTS district_migrated_at TIMESTAMPTZ;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM application_migrations WHERE key='kage-district-v1') THEN
  UPDATE members SET division=1,migration_required=TRUE,identity_version=identity_version+1,updated_at=now();
  DELETE FROM confirmations;
  INSERT INTO application_migrations(key) VALUES('kage-district-v1');
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS district_migration_campaign (
 id INTEGER PRIMARY KEY CHECK(id=1), target_guild TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), stopped_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS district_migration_notices (
 guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS district_migration_requests (
 id SERIAL PRIMARY KEY, member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
 discord_id TEXT NOT NULL, source_guild TEXT NOT NULL, ifj VARCHAR(15) NOT NULL,
 member_version INTEGER NOT NULL, shigaku_name TEXT NOT NULL CHECK(length(shigaku_name) BETWEEN 1 AND 64),
 status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','aprovada','recusada')),
 reason TEXT, reviewed_by INTEGER REFERENCES staff(id), notification_job_id INTEGER REFERENCES jobs(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS district_one_pending ON district_migration_requests(discord_id) WHERE status='pendente';
ALTER TABLE district_migration_campaign ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_migration_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE district_migration_requests ENABLE ROW LEVEL SECURITY;
