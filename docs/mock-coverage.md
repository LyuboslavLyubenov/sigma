# Mock v1 — data coverage against the current D1

> What of the rendered mockups in [`mocks/v1/`](../mocks/v1/) can be built from the **data we
> actually hold** in the domain today, and what cannot. Companion to
> [core-scope.md](core-scope.md) (the intended scope) — this is the **as-built check** of the
> HTML mocks against the populated tables.
>
> Design prose in English; user-facing copy in **Bulgarian**.

**Assessed 2026-05-24 (verified against a live local build).** Verdict: the eight core explorer pages
are **largely buildable today** — all the analytics (leaderboards, breakdowns, flows, value timelines,
search) and ~90 % of the visible fields map to populated columns. Of the gaps, **only per-bidder bid
amounts are genuinely unavailable**; the rest (location, owners, EU-programme names, geo) are
**sourceable from open, ЕИК-joinable data on data.egov.bg** — they are simply not ingested yet (see
[Gaps](#gaps--most-are-sourceable-from-open-data)).

## Basis & caveats

- **Verified against a freshly built local D1** (`pnpm import` of the admin ЦАИС ЕОП export, May
  2026): 4,868 authorities · 139,718 tenders · 195,220 lots · 17,354 bidders · 190,427 contracts ·
  **50.83 bn EUR** clean total (`SUM(amount_eur)`), data current to 2026-05-22 — matching the
  documented counts exactly. Schema: [0000_init.sql](../packages/db/migrations/0000_init.sql);
  transform: [normalize-egov.sql](../scripts/normalize-egov.sql). Live spot-checks confirmed
  `bids`/`risk_scores`/`bidder_members` = 0 rows and `authorities.region` = 0/4,868 populated.
- **Figures differ from the mocks, in our favour.** The mocks use placeholder numbers from a
  narrower slice — 2 sectors (строителство/храни), 2020–2024, 129,134 contracts, 47.8 bn лв. The
  live domain is the **full corpus**: all sectors, 2020–2026, **190,427 contracts · 4,868
  authorities · 17,354 companies · ≈50.8 bn EUR**. Every count/total KPI is coverable; the real
  numbers are simply larger and broader.

## Ground rules

Refined 2026-05-24: **no heuristics, no manual classification steps.** Only what the **admin export
and the open data (OCDS)** carry directly is "data we have." Deterministic **config** is allowed and
encouraged where the source value is real but needs labelling — e.g. mapping CPV prefixes to a
sector, or naming which `procedure_type` values count as non-competitive. Name/ЕИК pattern-matching,
region-from-name, and hand-curated taxonomies are **out**.

## Coverable now — per page

| Page | Coverable as drawn | Gaps on this page (see tables below) |
| --- | --- | --- |
| [index.html](../mocks/v1/index.html) | KPI cards, Top-10 companies, freshness date | "ministries vs municipalities" split needs `type` bucketing |
| [search.html](../mocks/v1/search.html) | Institutions, companies (name+ЕИК), contracts (предмет+УНП), lots | city/location matching |
| [companies.html](../mocks/v1/companies.html) | Leaderboard; sort by spend/count/#authorities/name; total won (BGN+EUR); contract & authority counts | city column; entity-type filter (only обединение vs дружество); **"3 участника"** member count |
| [company.html](../mocks/v1/company.html) | "Откъде печели", "Как печели" (procedure mix), non-competitive %, EU share, amendment %, recent contracts, CPV mix | location; bid metrics (`bids_received` 90 % filled); "обособени позиции" sub-count |
| [authorities.html](../mocks/v1/authorities.html) | Leaderboard; sort by spend/count/avg/name; totals; avg contract value | region/city column; clean `type` bucketing |
| [authority.html](../mocks/v1/authority.html) | "Топ изпълнители", "Какво купува" (CPV), "Как купува" (procedure), EU share, distinct suppliers, recent contracts | location; lot sub-count |
| [contracts.html](../mocks/v1/contracts.html) | Filter by year/sector/procedure/value-band/CPV/EU/authority/company; sort date/value; CSV export | none material (sector = derived) |
| [contract.html](../mocks/v1/contract.html) | Value timeline (прогнозна→при сключване→текуща + deltas), party panels with totals + cross-pair links, contract №, УНП, предмет, обект, primary CPV, procedure, bid count, EU flag, signing date, offer deadline | programme name; "Срок за изпълнение"/"Очакван край"; secondary CPV; "Лот 6 от 6" + per-lot table |
| [flows.html](../mocks/v1/flows.html) | Sankey authority→contractor weighted by Σ value + count, node totals, all filters (sector/year/financing/top-N), top-10 table, click-through | none — this is `GROUP BY authority_id, bidder_id` |

## Gaps — most are sourceable from open data

A live survey of **data.egov.bg** and the national registers (May 2026 — hitting the JSON API and
downloading samples) found that **most gaps below are fillable from open, CC0-licensed, ЕИК-joinable
data**; they are just not in the pipeline today. None requires a heuristic — every fill joins on a
stable key (ЕИК / ЕКАТТЕ). Only one is genuinely unavailable.

| Gap (where it appears) | In D1 today | Open-data source (join key) | Verdict |
| --- | --- | --- | --- |
| **Geographic location** — authority/company city & region (lists, headers, search, map) | No (`region` 0/4,868) | OCDS `parties[].address` (city + NUTS, ~100 % of procurement parties, by ЕИК); Trade Register XML seat + ЕКАТТЕ; NSI ЕКАТТЕ classifier | **Sourceable (open)** — needs ingestion |
| **Consortium members / "N участника"** | No (`bidder_members` = 0) | ИСУН dataset (roles incl. „член на обединение", by ЕИК); OCDS `subcontractor` role | **Sourceable (open)** — needs ingestion |
| **Beneficial owners / persons layer** | No | Trade Register CC0 XML — `Partners`, `SoleCapitalOwner`, `Managers`, `ActualOwners` (ЗМИП beneficial owners), personal IDs hashed (by ЕИК) | **Sourceable (open)** — daily deltas, must accumulate; un-masked PII is the only paid part (not needed) |
| **EU-funding programme name** | No (only 0/1 flag) | ИСУН dataset (beneficiary/partner ЕИК + programme + EU/own/total values) | **Sourceable (open)** — join by ЕИК (beneficiary-level, not per-УНП) |
| **Execution timeline** (duration / expected end) | No | Not in the admin export; OCDS `contracts.period` is sparse | **Mostly unavailable** |
| **Price-anomaly / concentration signals** | No (`risk_scores` = 0) | Computable from data already held (CPV price distribution) — **parked by product decision**, not data-blocked | **Computable; parked** |
| **Individual / losing bid amounts** ("who else bid") | No (`bids` = 0) | **None** — OCDS exposes only aggregate bid *statistics* (count / SME / foreign); per-bidder lines are not published openly | **Genuinely unavailable** |

So under the open-data lens the only hard "no" is **per-bidder bid amounts**. Everything else is a
matter of *ingestion effort*, not data availability — all CC0/open and ЕИК-joinable (no heuristics).

## Sourcing the gaps (data.egov.bg + registers)

Open, no API key for reads: `POST https://data.egov.bg/api/<method>`; file resources download at
`https://data.egov.bg/resource/download/<resource_uri>/<ext>`. Org ids: АОП **502**, Агенция по
вписванията **4**, МС / ИСУН **104**, НСИ **143**. (API quirks: `listDatasets` ignores `org_id`, and
`getResourceData` returns content only for Elasticsearch-backed resources like OCDS — resolve file
datasets by known `uri` + `listResources`.)

| Source | Id / location | Licence | Fills | Caveat |
| --- | --- | --- | --- | --- |
| **AOP OCDS feed** (already integrated; we currently drop most of it) | dataset `76d3…` → resource `3ec5…` | CC0 | richer fields: `parties[]` address+NUTS+ЕИК, awards→suppliers, CPV per lot, bid *statistics* | we flatten to contract rows today — a richer parse is low-effort |
| **Trade Register XML** (Агенция по вписванията) | dataset `2df0c2af-…`, daily resources | CC0 | company seat + ЕКАТТЕ, owners, **beneficial owners** | **daily deltas** → accumulate a snapshot; PII hashed |
| **ИСУН (EU funds)** | МС, org 104 | open | EU programme names, consortium/partner roles, EU/own/total values | join by **ЕИК**, periodic refresh |
| **NSI ЕКАТТЕ classifier** | nsi.bg/nrnm/ekatte (Excel/JSON/GIS) | NSI open | област→община→settlement + ЕКАТТЕ (+ geometry) | the geo lookup / NUTS↔ЕКАТТЕ bridge |
| **EU CPV 2008 catalog** | ted.europa.eu (`cpv_2008_xml`, all langs) | EU open | CPV labels + the sector config | one-time reference (BG labels already in-domain) |

**Lowest-effort, highest-value next step:** the OCDS feed we *already* pull carries `parties[].address`
(city + NUTS region, ~100 % coverage, keyed by ЕИК) — extracting that alone closes the **location**
gap for every entity that appears in procurement, with no new source.

## Partially coverable — config or schema work, no new data, no heuristics

- **Sector (all CPV divisions)** — no `sector` column, but it is a **deterministic, catalog-grounded
  mapping**, not a heuristic: a contract's sector is its CPV **division** (first 2 digits of
  `tenders.cpv_code`). The full taxonomy — all **45 divisions present**, each with its official
  Bulgarian label — lives in [`@sigma/config`](../packages/config/src/index.ts) (`CPV_SECTORS` +
  `sectorForCpv()`), grounded in the EU CPV 2008 vocabulary (TED `cpv_2008_xml`). The two featured
  sectors (45 Строителство, 15 Храни) keep a `curated` flag for the price index. Largest divisions:
  **33 медицина (35,187 contracts), 45 строителство (26,899 / 19.0 bn EUR), 71 инженерни услуги
  (14,232), 15 храни (10,959)**; only the 5 contracts with no CPV are unclassified.
- **Lot ↔ contract link** — "обособена позиция Лот 6 от 6", the per-lot contractor/value table, and
  the "N обособени позиции" sub-counts. `lot_id` **exists in staging** (`raw_egov_contracts.lot_id`)
  but [normalize-egov.sql](../scripts/normalize-egov.sql) drops it — the domain `contracts` table has
  no `lot_id`. Listing a tender's lots (titles, estimated values) works; mapping each lot to its
  winning contract does not. This is a **normalize/schema change, not missing data**.
- **Bid-count metrics** (avg/median bids, single-bidder share, distribution) — derivable from
  `bids_received`, which is **90 % populated** (verified), so these carry a small coverage caveat.
- **"Group award" flag** — `contracts.awarded_to_group` is **real data** (the "Възложена на група"
  Да/Не column), so "this award went to an обединение/консорциум" is achievable per contract, and an
  entity can be marked a consortium by aggregating it. Note the current `bidders.is_consortium` /
  `kind` flag is instead computed by **name matching** (`LIKE '%ДЗЗД%'` … in normalize-egov.sql) — a
  heuristic, so under these rules it should be **replaced by `awarded_to_group`** or dropped. The
  finer entity types **ЕТ** and **чуждестранно** have no real source field and are **not achievable**.
- **Authority type** — `authorities.type` is filled for 4,867/4,868 **directly from the source field**
  "Вид на възложителя", so a type filter/badge is achievable from real data. But the verified values
  are the **formal ЗОП categories** — Публичноправна организация (3,204), Регионален или местен орган
  (528), Орган на централната власт (329), Публично предприятие (101), Комунални услуги (61)… — **not**
  the mock's болница/училище/община buckets (hospitals and schools are both "Публичноправна
  организация"). The mock's friendly types would need name-based classification = a heuristic → out.
  (A few raw values are doubled, e.g. "Публичноправна организация; Публичноправна организация" — a
  light dedup, not a reclassification.)

## Reconciliation with declared scope

The gaps and the design agree closely: the **map**, **persons layer**, **signals/price-anomaly** and
**per-offer bids** are all explicitly parked in [core-scope.md → Parked](core-scope.md#parked) and
methodology.html's "not in v1" / "в подготовка" lists. What this check **revises**: the parked owner
layer was framed as blocked on a *credentialed* Търговски регистър ingest — but the survey shows
owners, beneficial owners and seats are in the **open CC0** Trade-Register feed (only un-masked PII is
paid), and consortium members + EU-programme names are in the **open ИСУН** feed, both ЕИК-joinable. So
those layers are an *ingestion* task, not a data-availability blocker. The findings that stand as true
constraints: **no location in the held data** (region NULL — sourceable, not yet ingested), the
**dropped `lot_id`** (real staging data, not carried to the domain), the entity-level
**`is_consortium` name heuristic** (should yield to the real `awarded_to_group`), and the one hard
dead-end — **per-bidder bid amounts**, absent even from open data. Under the no-heuristics rule the
only sanctioned in-DB "derivation" is deterministic config — chiefly the CPV-division sector map.

## Cross-references

- Intended scope & data mapping: [core-scope.md](core-scope.md).
- Pipeline feeding the domain: [etl-pipeline.md](etl-pipeline.md).
- Schema (domain + staging + parked hooks, one file): [0000_init.sql](../packages/db/migrations/0000_init.sql).
- Transform that decides what is populated: [normalize-egov.sql](../scripts/normalize-egov.sql).
- The mocks assessed: [`mocks/v1/`](../mocks/v1/).
