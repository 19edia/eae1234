CREATE TABLE IF NOT EXISTS registration_invites (
 id SERIAL PRIMARY KEY,
 token_hash TEXT UNIQUE NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
 account_kind TEXT NOT NULL CHECK(account_kind IN ('membro','aliado')),
 member_rank TEXT NOT NULL CHECK(length(trim(member_rank)) BETWEEN 1 AND 80),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 revoked_at TIMESTAMPTZ,
 member_id INTEGER REFERENCES members(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS registration_invite_challenges (
 invite_id INTEGER NOT NULL REFERENCES registration_invites(id) ON DELETE CASCADE,
 nonce_hash TEXT NOT NULL CHECK(nonce_hash ~ '^[a-f0-9]{64}$'),
 details JSONB,
 discord_id TEXT,
 discord_profile JSONB,
 code_hash TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 code_expires_at TIMESTAMPTZ,
 code_sent_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(invite_id,nonce_hash)
);
CREATE INDEX IF NOT EXISTS registration_invites_owner ON registration_invites(created_by,created_at DESC);
CREATE INDEX IF NOT EXISTS registration_invites_expiry ON registration_invites(expires_at);
CREATE INDEX IF NOT EXISTS registration_invite_challenges_discord ON registration_invite_challenges(discord_id,code_sent_at DESC);
ALTER TABLE registration_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_invite_challenges ENABLE ROW LEVEL SECURITY;

