-- Sigma — raw АОП contract-register staging (loaded from data/*.xlsx)
--
-- Lossless landing table for the АОП procurement/contract-register workbooks
-- (Храни, Строителство). One row = one contract / lot line; columns mirror the
-- workbook columns A–W 1:1 so nothing is dropped on ingest. The domain tables
-- (authorities/tenders/lots/bidders/contracts) are populated from here by
-- scripts/normalize-aop.sql — re-runnable without re-importing the workbooks.

CREATE TABLE IF NOT EXISTS raw_aop_contracts (
  id                  INTEGER PRIMARY KEY,
  dataset             TEXT NOT NULL,          -- 'храни' | 'строителство'
  tender_internal_id  TEXT,                   -- A: Идентификатор на поръчка (АОП internal id)
  parent_tender_id    TEXT,                   -- B: Идентификатор на главна поръчка
  lot_number          TEXT,                   -- C: Номер на обособена позиция
  unp                 TEXT,                   -- D: УНП (e.g. 00097-2020-0001) — public reg id
  subject             TEXT,                   -- E: Предмет на поръчката/обособена позиция
  authority_name      TEXT,                   -- F: Възложител
  procedure_type      TEXT,                   -- G: Вид на процедурата
  contract_kind       TEXT,                   -- H: Обект (Услуги | Доставки | Строителство)
  cpv_code            TEXT,                   -- I: CPV код
  estimated_value_eur REAL,                   -- J: Прогнозна стойност (евро)
  eu_funded           INTEGER,                -- K: Наличие на европейско финансиране (0/1)
  published_ojeu      INTEGER,                -- L: Публикация в ОВ на ЕС (0/1)
  bids_received       INTEGER,                -- M: Брой получени оферти
  submission_deadline TEXT,                   -- N: Краен срок за подаване (UTC, ISO 8601)
  annex               TEXT,                   -- O: Анекс
  contract_number     TEXT,                   -- P: Номер на договор
  contract_subject    TEXT,                   -- Q: Предмет на договора
  contract_start_date TEXT,                   -- R: Начална дата (ISO 8601 date)
  contract_end_date   TEXT,                   -- S: Крайна дата (ISO 8601 date)
  signing_value_eur   REAL,                   -- T: Стойност при сключване (евро)
  current_value_eur   REAL,                   -- U: Текуща стойност (евро)
  contractor_name     TEXT,                   -- V: Изпълнител
  contractor_eik      TEXT                    -- W: ЕИК
);

CREATE INDEX IF NOT EXISTS idx_raw_aop_unp ON raw_aop_contracts(unp);
CREATE INDEX IF NOT EXISTS idx_raw_aop_cpv ON raw_aop_contracts(cpv_code);
CREATE INDEX IF NOT EXISTS idx_raw_aop_eik ON raw_aop_contracts(contractor_eik);
CREATE INDEX IF NOT EXISTS idx_raw_aop_dataset ON raw_aop_contracts(dataset);

-- Price-anomaly reference, DERIVED from the register: the distribution of actual
-- signing values per CPV code + kind. The register has no quantities/units, so
-- these are contract-value benchmarks, not unit prices. The analysis package uses
-- it to flag contracts sitting far above the norm for their category. (Median is
-- robust to the few huge framework contracts; avg is kept for comparison.)
CREATE VIEW IF NOT EXISTS price_benchmark AS
WITH ranked AS (
  SELECT
    cpv_code,
    contract_kind,
    signing_value_eur AS v,
    ROW_NUMBER() OVER (PARTITION BY cpv_code, contract_kind ORDER BY signing_value_eur) AS rn,
    COUNT(*)     OVER (PARTITION BY cpv_code, contract_kind)                            AS cnt
  FROM raw_aop_contracts
  WHERE cpv_code IS NOT NULL
    AND signing_value_eur IS NOT NULL
    AND signing_value_eur > 0
)
SELECT
  cpv_code,
  contract_kind,
  cnt              AS n,
  ROUND(AVG(v), 2) AS avg_value,
  MIN(v)           AS min_value,
  MAX(v)           AS max_value,
  -- median: average of the middle one (odd cnt) or two (even cnt) ranked rows
  ROUND(AVG(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN v END), 2) AS median_value
FROM ranked
GROUP BY cpv_code, contract_kind;
