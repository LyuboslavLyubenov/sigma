-- Sigma — normalise raw_aop_contracts into the domain tables (authorities,
-- tenders, lots, bidders, contracts). Run AFTER scripts/load-aop.mjs has
-- populated staging:
--   (cd apps/api && wrangler d1 execute sigma --local --file ../../scripts/normalize-aop.sql)
--
-- Re-runnable: every INSERT is OR IGNORE with a deterministic key. It does NOT
-- delete rows, so it coexists with the demo rows from scripts/seed.sql — start
-- from a clean DB (pnpm setup) if you want only АОП data.
--
-- Cleaning policy — staging stays 100% raw; cleaning happens only here:
--   * Values are in EUR (workbook columns say "(евро)") → currency = 'EUR'.
--   * Authorities are deduped on a normalised key (UPPER + collapsed whitespace),
--     merging ~33 case/spacing-only variants; a canonical display name is kept.
--   * Contractor ЕИК is kept VERBATIM in bidders.bulstat. We additionally derive
--     quality flags so the messy ~685 values ("ЕИК 1234…" prefixes, "не се
--     публикува", name-in-field, обединения) stay visible to the cartel /
--     related-party module WITHOUT altering the source. Downstream can join clean
--     identities on eik_normalized.
--   * Tender grain: several top-level rows can share one internal id, but the
--     audit shows unp+authority never diverge, so the OR IGNORE collapse is lossless.
--   * Bids: we have only a *count* (column M), not individual bids → bids stays empty.

-- 1) Authorities — dedup on normalised key, keep a canonical display name
INSERT OR IGNORE INTO authorities (id, name)
SELECT
  'auth:' || UPPER(TRIM(REPLACE(REPLACE(authority_name, '  ', ' '), '  ', ' '))),
  MIN(authority_name)
FROM raw_aop_contracts
WHERE authority_name IS NOT NULL
GROUP BY UPPER(TRIM(REPLACE(REPLACE(authority_name, '  ', ' '), '  ', ' ')));

-- 2) Bidders — winning contractors, deduped by raw ЕИК, with quality flags.
--    eik_clean strips a leading "ЕИК " label; validity = digits-only, length 9 or 13.
INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium)
SELECT
  'eik:' || raw_eik,
  MIN(contractor_name),
  raw_eik,
  CASE WHEN eik_clean NOT GLOB '*[^0-9]*' AND LENGTH(eik_clean) IN (9, 13) THEN eik_clean END,
  CASE WHEN eik_clean NOT GLOB '*[^0-9]*' AND LENGTH(eik_clean) IN (9, 13) THEN 1 ELSE 0 END,
  CASE
    WHEN raw_eik LIKE '%/%' OR raw_eik LIKE '%;%' OR raw_eik LIKE '%,%' OR raw_eik LIKE '%+%'
    THEN 1 ELSE 0
  END
FROM (
  SELECT
    contractor_eik AS raw_eik,
    contractor_name,
    TRIM(CASE WHEN contractor_eik LIKE 'ЕИК %' THEN SUBSTR(contractor_eik, 5) ELSE contractor_eik END) AS eik_clean
  FROM raw_aop_contracts
  WHERE contractor_eik IS NOT NULL
)
GROUP BY raw_eik, eik_clean;

-- 3) Tenders — top-level rows (no parent), one per internal id
INSERT OR IGNORE INTO tenders
  (id, source_id, title, authority_id, cpv_code, estimated_value, currency,
   procedure_type, status, deadline_at)
SELECT
  tender_internal_id,
  COALESCE(unp, 'aop:' || tender_internal_id),     -- source_id is NOT NULL UNIQUE
  COALESCE(subject, '(без предмет)'),               -- title is NOT NULL
  'auth:' || UPPER(TRIM(REPLACE(REPLACE(authority_name, '  ', ' '), '  ', ' '))),
  cpv_code,
  estimated_value_eur,
  'EUR',
  COALESCE(procedure_type, 'неизвестна'),           -- procedure_type is NOT NULL
  CASE WHEN contractor_eik IS NOT NULL THEN 'awarded' ELSE 'published' END,
  submission_deadline
FROM raw_aop_contracts
WHERE parent_tender_id IS NULL
  AND authority_name IS NOT NULL;

-- 4) Lots — child rows (parent set), linked to an existing tender; 1:1 with rows
INSERT OR IGNORE INTO lots (id, tender_id, title, cpv_code, estimated_value)
SELECT 'lot:' || id, parent_tender_id, COALESCE(subject, '(без предмет)'), cpv_code, estimated_value_eur
FROM raw_aop_contracts
WHERE parent_tender_id IS NOT NULL
  AND parent_tender_id IN (SELECT id FROM tenders);

-- 5) Contracts — awarded lines (1:1 with rows), linked to tender + winning bidder
INSERT OR IGNORE INTO contracts (id, tender_id, bidder_id, amount, currency, signed_at)
SELECT
  'c:' || id,
  COALESCE(parent_tender_id, tender_internal_id),
  'eik:' || contractor_eik,
  COALESCE(signing_value_eur, current_value_eur),   -- amount is NOT NULL
  'EUR',
  contract_start_date
FROM raw_aop_contracts
WHERE contractor_eik IS NOT NULL
  AND COALESCE(signing_value_eur, current_value_eur) IS NOT NULL
  AND COALESCE(parent_tender_id, tender_internal_id) IN (SELECT id FROM tenders);

-- Summary (last result set printed by `wrangler d1 execute`)
SELECT
  (SELECT COUNT(*) FROM authorities)                     AS authorities,
  (SELECT COUNT(*) FROM tenders)                         AS tenders,
  (SELECT COUNT(*) FROM lots)                            AS lots,
  (SELECT COUNT(*) FROM bidders)                         AS bidders,
  (SELECT COUNT(*) FROM bidders WHERE eik_valid = 1)     AS bidders_valid_eik,
  (SELECT COUNT(*) FROM bidders WHERE is_consortium = 1) AS bidders_consortium,
  (SELECT COUNT(*) FROM contracts)                       AS contracts,
  (SELECT COUNT(*) FROM price_benchmark)                 AS benchmark_categories;
