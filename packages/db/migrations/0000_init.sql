-- Sigma — initial schema (D1 / SQLite)

CREATE TABLE IF NOT EXISTS authorities (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  bulstat    TEXT,                       -- ЕИК / Булстат
  region     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tenders (
  id              TEXT PRIMARY KEY,
  source_id       TEXT NOT NULL UNIQUE,  -- АОП / ЦАИС ЕОП identifier
  title           TEXT NOT NULL,
  authority_id    TEXT NOT NULL REFERENCES authorities(id),
  cpv_code        TEXT,
  estimated_value REAL,
  currency        TEXT NOT NULL DEFAULT 'BGN',
  procedure_type  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'planned',
  published_at    TEXT,
  deadline_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tenders_authority ON tenders(authority_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);
CREATE INDEX IF NOT EXISTS idx_tenders_published ON tenders(published_at);

CREATE TABLE IF NOT EXISTS lots (
  id              TEXT PRIMARY KEY,
  tender_id       TEXT NOT NULL REFERENCES tenders(id),
  title           TEXT NOT NULL,
  cpv_code        TEXT,
  estimated_value REAL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_lots_tender ON lots(tender_id);

CREATE TABLE IF NOT EXISTS bidders (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  bulstat        TEXT UNIQUE,                 -- raw ЕИК as it appears in the register (kept verbatim)
  eik_normalized TEXT,                        -- digits-only ЕИК when recoverable, else NULL
  eik_valid      INTEGER NOT NULL DEFAULT 0,  -- 1 if eik_normalized is a valid 9/13-digit ЕИК
  is_consortium  INTEGER NOT NULL DEFAULT 0,  -- 1 if the raw field lists several ids (обединение/консорциум)
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bidders_eik_norm ON bidders(eik_normalized);

CREATE TABLE IF NOT EXISTS bids (
  id           TEXT PRIMARY KEY,
  tender_id    TEXT NOT NULL REFERENCES tenders(id),
  lot_id       TEXT REFERENCES lots(id),
  bidder_id    TEXT NOT NULL REFERENCES bidders(id),
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'BGN',
  is_winner    INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bids_tender ON bids(tender_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON bids(bidder_id);

CREATE TABLE IF NOT EXISTS contracts (
  id         TEXT PRIMARY KEY,
  tender_id  TEXT NOT NULL REFERENCES tenders(id),
  bidder_id  TEXT NOT NULL REFERENCES bidders(id),
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL DEFAULT 'BGN',
  signed_at  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contracts_tender ON contracts(tender_id);

CREATE TABLE IF NOT EXISTS risk_scores (
  tender_id   TEXT PRIMARY KEY REFERENCES tenders(id),
  score       REAL NOT NULL,
  band        TEXT NOT NULL,
  signals     TEXT NOT NULL DEFAULT '{}',  -- JSON signal breakdown
  computed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_risk_band ON risk_scores(band);

-- Price-anomaly reference is *derived* from the АОП register (the data has
-- contract values per CPV, not unit prices), so it lives as the `price_benchmark`
-- view in 0001_raw_aop.sql rather than as a stored table here.
