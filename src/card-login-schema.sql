CREATE TABLE IF NOT EXISTS card_login_sessions (
 token_hash TEXT PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 last_upload_at TIMESTAMPTZ,
 consumed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS card_login_challenges (
 token_hash TEXT PRIMARY KEY REFERENCES card_login_sessions(token_hash) ON DELETE CASCADE,
 member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 discord_id TEXT NOT NULL,
 identity_version INTEGER NOT NULL,
 proof_hash TEXT NOT NULL CHECK(proof_hash ~ '^[a-f0-9]{64}$'),
 code_hash TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 sent_at TIMESTAMPTZ,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS card_login_sessions_expiry ON card_login_sessions(expires_at);
CREATE INDEX IF NOT EXISTS card_login_challenges_member ON card_login_challenges(member_id,sent_at DESC);
ALTER TABLE card_login_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_login_challenges ENABLE ROW LEVEL SECURITY;

