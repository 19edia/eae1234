CREATE TABLE IF NOT EXISTS member_accounts (
 id SERIAL PRIMARY KEY,
 member_id INTEGER UNIQUE NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 discord_id TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Older portals used an additional username; IFJ login preserves their passwords.
ALTER TABLE member_accounts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='member_accounts' AND table_schema=current_schema() AND column_name='username') THEN
  ALTER TABLE member_accounts ALTER COLUMN username DROP NOT NULL;
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS member_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id INTEGER NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
 csrf TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS member_signup_challenges (
 member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 discord_id TEXT NOT NULL,
 token_hash TEXT UNIQUE NOT NULL,
 code_hash TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS official_notices (
 id SERIAL PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 140),
 content TEXT NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 6000),
 pinned BOOLEAN NOT NULL DEFAULT FALSE,
 published BOOLEAN NOT NULL DEFAULT FALSE,
 created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS member_sessions_expiry ON member_sessions(expires_at);
CREATE INDEX IF NOT EXISTS official_notices_feed ON official_notices(published,pinned,published_at DESC);
ALTER TABLE member_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_signup_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE official_notices ENABLE ROW LEVEL SECURITY;
