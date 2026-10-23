-- The old IFJ remains internal so existing accounts, history and foreign keys survive.
-- Public IDRKC identifiers are never reused, even after a member is deleted.
CREATE TABLE IF NOT EXISTS used_idrkcs (
 idrkc VARCHAR(16) PRIMARY KEY CHECK(idrkc ~ '^[0-9]{16}$'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE used_idrkcs ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION generate_idrkc() RETURNS VARCHAR(16) LANGUAGE plpgsql AS $$
DECLARE candidate VARCHAR(16); reserved VARCHAR(16);
BEGIN
 FOR attempt IN 1..20 LOOP
  candidate := lpad(((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,15))::bit(60)::bigint) % 10000000000000000)::text,16,'0');
  INSERT INTO used_idrkcs(idrkc) VALUES(candidate) ON CONFLICT DO NOTHING RETURNING idrkc INTO reserved;
  IF reserved IS NOT NULL THEN RETURN reserved; END IF;
 END LOOP;
 RAISE EXCEPTION 'Não foi possível reservar um IDRKC.';
END;
$$;
ALTER TABLE members ADD COLUMN IF NOT EXISTS idrkc VARCHAR(16) NOT NULL DEFAULT generate_idrkc();
ALTER TABLE members ADD COLUMN IF NOT EXISTS card_secret UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE members ADD COLUMN IF NOT EXISTS card_revoked_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS members_idrkc_unique ON members(idrkc);
INSERT INTO used_idrkcs(idrkc) SELECT idrkc FROM members ON CONFLICT DO NOTHING;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='members_idrkc_format' AND conrelid='members'::regclass) THEN
  ALTER TABLE members ADD CONSTRAINT members_idrkc_format CHECK(idrkc ~ '^[0-9]{16}$');
 END IF;
END $$;

-- Bind verification confirmation to the exact signed card that was uploaded.
ALTER TABLE confirmations ADD COLUMN IF NOT EXISTS card_proof_hash TEXT;
