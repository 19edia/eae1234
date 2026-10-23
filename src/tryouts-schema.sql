CREATE TABLE IF NOT EXISTS tryout_sessions (
 id SERIAL PRIMARY KEY,
 guild_id TEXT NOT NULL,
 participant_id TEXT NOT NULL CHECK(participant_id ~ '^[0-9]{17,20}$'),
 evaluator_id TEXT NOT NULL CHECK(evaluator_id ~ '^[0-9]{17,20}$'),
 participant_nick TEXT NOT NULL,
 evaluator_nick TEXT NOT NULL,
 channel_id TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','passed','failed','registered','expired','cancelled')),
 threshold NUMERIC(5,2) NOT NULL CHECK(threshold BETWEEN 0 AND 100),
 damage_percent NUMERIC(5,2) CHECK(damage_percent BETWEEN 0 AND 100),
 registration_hours INTEGER NOT NULL DEFAULT 48 CHECK(registration_hours BETWEEN 1 AND 720),
 link_nonce TEXT NOT NULL,
 link_expires_at TIMESTAMPTZ NOT NULL,
 registration_deadline TIMESTAMPTZ,
 registration_invite_id INTEGER REFERENCES registration_invites(id) ON DELETE SET NULL,
 member_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
 evaluated_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
 evaluated_at TIMESTAMPTZ,
 registered_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(participant_id<>evaluator_id)
);
-- Existing single-game tryouts keep their original Deepwoken identity.
ALTER TABLE tryout_sessions ADD COLUMN IF NOT EXISTS game_id TEXT NOT NULL DEFAULT 'deepwoken' CONSTRAINT tryout_game_valid CHECK(game_id IN ('westbound','deepwoken','klase'));
CREATE UNIQUE INDEX IF NOT EXISTS one_active_tryout ON tryout_sessions(guild_id,participant_id) WHERE status IN ('pending','passed');
CREATE INDEX IF NOT EXISTS tryout_deadlines ON tryout_sessions(status,registration_deadline);
CREATE INDEX IF NOT EXISTS tryout_participants ON tryout_sessions(guild_id,participant_id,id DESC);
ALTER TABLE registration_invites ADD COLUMN IF NOT EXISTS bound_discord_id TEXT;
ALTER TABLE registration_invites ADD COLUMN IF NOT EXISTS tryout_id INTEGER REFERENCES tryout_sessions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_tryout_invitation ON registration_invites(tryout_id) WHERE tryout_id IS NOT NULL;
ALTER TABLE tryout_sessions ENABLE ROW LEVEL SECURITY;

-- Preserve only the members who had already proved their Discord and completed
-- their portal account before the rebrand. This snapshot never grows on reboot.
CREATE TABLE IF NOT EXISTS application_migrations (key TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS tryout_legacy_members (
 member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 discord_id TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM application_migrations WHERE key='hriste-tryout-existing-accounts-v1') THEN
  INSERT INTO tryout_legacy_members(member_id,discord_id,guild_id)
  SELECT m.id,m.discord_id,d.guild_id FROM members m
  JOIN member_accounts a ON a.member_id=m.id AND a.discord_id=m.discord_id AND a.active=TRUE
  CROSS JOIN sbi_district d
  WHERE m.verified=TRUE AND m.card_revoked_at IS NULL AND d.guild_id IS NOT NULL AND d.status='ready'
  ON CONFLICT DO NOTHING;
  INSERT INTO application_migrations(key) VALUES('hriste-tryout-existing-accounts-v1');
 END IF;
END $$;
ALTER TABLE application_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tryout_legacy_members ENABLE ROW LEVEL SECURITY;

