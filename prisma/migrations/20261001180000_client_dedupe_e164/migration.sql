-- One customer per person per company.
--
-- Phone numbers were stored as the caller sent them: the WhatsApp bot wrote
-- digits ("243812345678"), the dashboard whatever was typed ("+243 81 234 5678",
-- "0812345678"), so one person could get several customer rows in a company,
-- each with part of their claims. From now on every write stores E.164
-- ("+243812345678") and finds the customer by (company_id, phone_number).
--
-- This migration:
--  1. merges existing duplicates (same company, same normalised number): the
--     oldest record is kept; claims, conversations (with their messages),
--     feedback and every other row pointing at a duplicate move to it (claim
--     documents and notes belong to the claims and move with them); empty
--     fields of the kept record are filled from the duplicates; each merge is
--     logged in customer_merges; the duplicates are deleted;
--  2. rewrites every number to E.164 (numbers that cannot be read are left as
--     they are and reported);
--  3. adds the approximate incident date columns on claims.

CREATE TABLE IF NOT EXISTS "customer_merges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "kept_customer_id" UUID NOT NULL,
  "merged_customer_id" UUID NOT NULL,
  "phone_number" TEXT NOT NULL,
  "merged_fields" JSONB,
  "moved_rows" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_merges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "customer_merges_company_id_idx" ON "customer_merges"("company_id");
CREATE INDEX IF NOT EXISTS "customer_merges_kept_customer_id_idx" ON "customer_merges"("kept_customer_id");

ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "incidentDateApproximate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "incidentDateText" TEXT;

-- Calling code of a company: its country, else its own international contact number.
CREATE OR REPLACE FUNCTION rapidos_calling_code(country TEXT, contact_phone TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  key TEXT := lower(btrim(translate(coalesce(country, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ',
    'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')));
  cc TEXT;
  d TEXT;
BEGIN
  SELECT m.cc INTO cc FROM (VALUES
      ('cd','243'),
      ('cod','243'),
      ('drc','243'),
      ('rdc','243'),
      ('dr congo','243'),
      ('rd congo','243'),
      ('congo-kinshasa','243'),
      ('congo kinshasa','243'),
      ('democratic republic of the congo','243'),
      ('republique democratique du congo','243'),
      ('cg','242'),
      ('cog','242'),
      ('congo','242'),
      ('congo-brazzaville','242'),
      ('republic of the congo','242'),
      ('republique du congo','242'),
      ('ke','254'),
      ('ken','254'),
      ('kenya','254'),
      ('ug','256'),
      ('uga','256'),
      ('uganda','256'),
      ('ouganda','256'),
      ('tz','255'),
      ('tza','255'),
      ('tanzania','255'),
      ('tanzanie','255'),
      ('rw','250'),
      ('rwa','250'),
      ('rwanda','250'),
      ('bi','257'),
      ('bdi','257'),
      ('burundi','257'),
      ('ao','244'),
      ('ago','244'),
      ('angola','244'),
      ('zm','260'),
      ('zmb','260'),
      ('zambia','260'),
      ('zambie','260'),
      ('ng','234'),
      ('nga','234'),
      ('nigeria','234'),
      ('gh','233'),
      ('gha','233'),
      ('ghana','233'),
      ('sn','221'),
      ('sen','221'),
      ('senegal','221'),
      ('ci','225'),
      ('civ','225'),
      ('cote d''ivoire','225'),
      ('ivory coast','225'),
      ('cm','237'),
      ('cmr','237'),
      ('cameroon','237'),
      ('cameroun','237'),
      ('za','27'),
      ('zaf','27'),
      ('south africa','27'),
      ('afrique du sud','27'),
      ('et','251'),
      ('eth','251'),
      ('ethiopia','251'),
      ('ethiopie','251'),
      ('ma','212'),
      ('mar','212'),
      ('morocco','212'),
      ('maroc','212'),
      ('eg','20'),
      ('egy','20'),
      ('egypt','20'),
      ('egypte','20'),
      ('fr','33'),
      ('fra','33'),
      ('france','33'),
      ('be','32'),
      ('bel','32'),
      ('belgium','32'),
      ('belgique','32'),
      ('gb','44'),
      ('uk','44'),
      ('gbr','44'),
      ('united kingdom','44'),
      ('us','1'),
      ('usa','1'),
      ('united states','1'),
      ('ca','1'),
      ('canada','1'),
      ('in','91'),
      ('ind','91'),
      ('india','91'),
      ('ph','63'),
      ('phl','63'),
      ('philippines','63'),
      ('id','62'),
      ('idn','62'),
      ('indonesia','62'),
      ('indonesie','62'),
      ('vn','84'),
      ('vnm','84'),
      ('vietnam','84'),
      ('viet nam','84'),
      ('bd','880'),
      ('bgd','880'),
      ('bangladesh','880'),
      ('br','55'),
      ('bra','55'),
      ('brazil','55'),
      ('bresil','55'),
      ('pt','351'),
      ('prt','351'),
      ('portugal','351'),
      ('es','34'),
      ('esp','34'),
      ('spain','34'),
      ('espagne','34'),
      ('mx','52'),
      ('mex','52'),
      ('mexico','52')
    ) AS m(name, cc) WHERE m.name = key;
  IF cc IS NOT NULL THEN RETURN cc; END IF;
  IF contact_phone ~ '^\s*(\+|00)' THEN
    d := regexp_replace(regexp_replace(contact_phone, '\D', '', 'g'), '^00', '');
    SELECT c INTO cc FROM unnest(ARRAY['880','351','260','257','256','255','254','251','250','244','243','242','237','234','233','225','221','212','91','84','63','62','55','52','44','34','33','32','27','20','1']) AS c
      WHERE d LIKE c || '%' LIMIT 1;
    RETURN cc;
  END IF;
  RETURN NULL;
END $$;

-- E.164 form of a stored number (same rules as lib/phone.ts and the Go bot);
-- NULL when it cannot be read as an international number.
CREATE OR REPLACE FUNCTION rapidos_normalize_phone(raw TEXT, cc TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s TEXT := regexp_replace(btrim(coalesce(raw, '')), '[[:space:]\u00a0().\-/]', '', 'g');
  plus BOOLEAN;
  d TEXT;
BEGIN
  IF s = '' THEN RETURN NULL; END IF;
  IF s LIKE '00%' THEN s := '+' || substr(s, 3); END IF;
  plus := s LIKE '+%';
  d := ltrim(s, '+');
  IF d !~ '^[0-9]+$' OR (plus AND length(s) - length(d) > 1) THEN RETURN NULL; END IF;
  IF NOT plus THEN
    IF d LIKE '0%' THEN
      IF cc IS NULL OR cc = '' THEN RETURN NULL; END IF;
      d := cc || ltrim(d, '0');
    ELSIF length(d) <= 9 AND coalesce(cc, '') <> '' AND d NOT LIKE cc || '%' THEN
      d := cc || d;
    ELSIF length(d) < 10 AND coalesce(cc, '') = '' THEN
      RETURN NULL;
    END IF;
  END IF;
  IF length(d) < 8 OR length(d) > 15 OR d LIKE '0%' THEN RETURN NULL; END IF;
  RETURN '+' || d;
END $$;

DO $$
DECLARE
  grp RECORD;
  keep RECORD;
  dup RECORD;
  fk RECORD;
  moved JSONB;
  filled JSONB;
  n BIGINT;
  groups_merged INT := 0;
  rows_merged INT := 0;
  renumbered INT := 0;
  unreadable INT := 0;
BEGIN
  CREATE TEMP TABLE _cust_norm ON COMMIT DROP AS
    SELECT cu.id, cu.company_id, cu.created_at,
           coalesce(rapidos_normalize_phone(cu.phone_number, rapidos_calling_code(co.country, co.contact_phone)), cu.phone_number) AS e164
    FROM customers cu JOIN companies co ON co.id = cu.company_id;

  FOR grp IN
    SELECT company_id, e164 FROM _cust_norm GROUP BY company_id, e164 HAVING count(*) > 1
  LOOP
    groups_merged := groups_merged + 1;
    SELECT cu.* INTO keep FROM customers cu JOIN _cust_norm n ON n.id = cu.id
      WHERE n.company_id = grp.company_id AND n.e164 = grp.e164
      ORDER BY cu.created_at ASC NULLS LAST, cu.id ASC LIMIT 1;

    FOR dup IN
      SELECT cu.* FROM customers cu JOIN _cust_norm n ON n.id = cu.id
      WHERE n.company_id = grp.company_id AND n.e164 = grp.e164 AND cu.id <> keep.id
      ORDER BY cu.created_at ASC NULLS LAST, cu.id ASC
    LOOP
      -- Every row pointing at the duplicate moves to the kept customer.
      moved := '{}'::jsonb;
      FOR fk IN
        SELECT c.conrelid::regclass AS tbl, a.attname AS col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND c.confrelid = 'customers'::regclass AND array_length(c.conkey, 1) = 1
        GROUP BY 1, 2
      LOOP
        EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col) USING keep.id, dup.id;
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN moved := moved || jsonb_build_object(fk.tbl::text, n); END IF;
      END LOOP;

      -- Empty fields of the kept customer are completed (the name as a unit).
      filled := '{}'::jsonb;
      IF nullif(btrim(keep.first_name), '') IS NULL AND nullif(btrim(dup.first_name), '') IS NOT NULL THEN
        keep.first_name := dup.first_name; filled := filled || jsonb_build_object('first_name', dup.first_name);
        IF nullif(btrim(keep.last_name), '') IS NULL AND nullif(btrim(dup.last_name), '') IS NOT NULL THEN
          keep.last_name := dup.last_name; filled := filled || jsonb_build_object('last_name', dup.last_name);
        END IF;
      ELSIF nullif(btrim(keep.last_name), '') IS NULL AND nullif(btrim(dup.last_name), '') IS NOT NULL
            AND lower(btrim(keep.first_name)) = lower(btrim(dup.first_name)) THEN
        keep.last_name := dup.last_name; filled := filled || jsonb_build_object('last_name', dup.last_name);
      END IF;
      IF nullif(btrim(keep.email), '') IS NULL AND nullif(btrim(dup.email), '') IS NOT NULL THEN
        keep.email := dup.email; filled := filled || jsonb_build_object('email', dup.email);
      END IF;
      IF nullif(btrim(keep.policy_number), '') IS NULL AND nullif(btrim(dup.policy_number), '') IS NOT NULL THEN
        keep.policy_number := dup.policy_number; filled := filled || jsonb_build_object('policy_number', dup.policy_number);
      END IF;
      IF nullif(btrim(keep.address), '') IS NULL AND nullif(btrim(dup.address), '') IS NOT NULL THEN
        keep.address := dup.address; filled := filled || jsonb_build_object('address', dup.address);
      END IF;
      IF keep.birth_date IS NULL AND dup.birth_date IS NOT NULL THEN
        keep.birth_date := dup.birth_date; filled := filled || jsonb_build_object('birth_date', dup.birth_date);
      END IF;
      IF nullif(btrim(keep.license_number), '') IS NULL AND nullif(btrim(dup.license_number), '') IS NOT NULL THEN
        keep.license_number := dup.license_number; filled := filled || jsonb_build_object('license_number', dup.license_number);
      END IF;
      IF NOT keep.is_active AND dup.is_active THEN
        keep.is_active := true; filled := filled || jsonb_build_object('is_active', true);
      END IF;

      INSERT INTO customer_merges (company_id, kept_customer_id, merged_customer_id, phone_number, merged_fields, moved_rows)
        VALUES (grp.company_id, keep.id, dup.id, dup.phone_number,
                filled || jsonb_build_object('_merged_record', jsonb_build_object(
                  'first_name', dup.first_name, 'last_name', dup.last_name, 'email', dup.email,
                  'policy_number', dup.policy_number, 'address', dup.address, 'created_at', dup.created_at)),
                moved);
      DELETE FROM customers WHERE id = dup.id;
      rows_merged := rows_merged + 1;
      RAISE NOTICE 'customer merge: company % kept % (%), merged % (%), moved %, filled %',
        grp.company_id, keep.id, grp.e164, dup.id, dup.phone_number, moved, filled;
    END LOOP;

    UPDATE customers SET first_name = keep.first_name, last_name = keep.last_name, email = keep.email,
      policy_number = keep.policy_number, address = keep.address, birth_date = keep.birth_date,
      license_number = keep.license_number, is_active = keep.is_active, updated_at = now()
    WHERE id = keep.id;
  END LOOP;

  -- Every remaining number in E.164.
  UPDATE customers cu SET phone_number = n.e164
    FROM _cust_norm n
    WHERE n.id = cu.id AND n.e164 LIKE '+%' AND cu.phone_number <> n.e164;
  GET DIAGNOSTICS renumbered = ROW_COUNT;
  SELECT count(*) INTO unreadable FROM customers WHERE phone_number !~ '^\+[1-9][0-9]{6,14}$';

  -- Phone copies on the claim data follow the customer.
  UPDATE auto_claim_data a SET "phoneNumber" = cu.phone_number
    FROM claims c JOIN customers cu ON cu.id = c."customerId"
    WHERE a."claimId" = c.id AND a."phoneNumber" IS DISTINCT FROM cu.phone_number
      AND regexp_replace(coalesce(a."phoneNumber", ''), '\D', '', 'g') = regexp_replace(cu.phone_number, '\D', '', 'g');

  RAISE NOTICE 'customer dedupe: % duplicate group(s), % record(s) merged, % number(s) rewritten to E.164, % number(s) left unreadable',
    groups_merged, rows_merged, renumbered, unreadable;
END $$;
