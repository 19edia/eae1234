CREATE TABLE IF NOT EXISTS sbi_district (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
 guild_id TEXT,
 source_guilds JSONB NOT NULL DEFAULT '[]'::jsonb,
 state JSONB NOT NULL DEFAULT '{}'::jsonb,
 status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','configuring','ready')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
