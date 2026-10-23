CREATE TABLE IF NOT EXISTS embed_publications (
 id SERIAL PRIMARY KEY,
 request_id UUID UNIQUE NOT NULL,
 payload JSONB NOT NULL,
 payload_hash TEXT NOT NULL,
 guild_id TEXT NOT NULL,
 channel_id TEXT NOT NULL,
 message_id TEXT,
 job_id INTEGER UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
 created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 published_at TIMESTAMPTZ,
 CHECK(jsonb_typeof(payload)='object')
);
CREATE INDEX IF NOT EXISTS embed_publications_feed ON embed_publications(published_at DESC,id DESC) WHERE published_at IS NOT NULL;
ALTER TABLE embed_publications ENABLE ROW LEVEL SECURITY;
