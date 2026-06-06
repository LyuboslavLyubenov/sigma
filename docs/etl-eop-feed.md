# Agent Implementation Prompt — EOP MinIO open-data feed (historical ingestion)

> **Status: PLAN (no code yet).** Approved scope (2026-06-05): the per-day EOP MinIO
> open-data feed becomes the **canonical historical/older-data source**, replacing the
> one-off admin ЦАИС ЕОП ZIP (`scripts/load-admin.mjs`). The **OCDS feed stays the live
> go-forward path** (`apps/etl` Cloudflare Workflow — untouched). Extends
> [etl-pipeline.md](etl-pipeline.md). Design prose in English; user-facing copy in Bulgarian.

## Context

Today the ETL has two sources (see [etl-pipeline.md](etl-pipeline.md)): the **admin export**
(per-year `data/open-data/*.json`, loaded by `scripts/load-admin.mjs`) as the authoritative
2020–2026 base, and the **OCDS feed**
(`data.egov.bg`) as the 2026+ delta. The admin ZIP was always a stopgap ("all previous were
temp"). The OCDS feed also **403s from non-BG egress**, which has frozen refreshes.

A new official source has appeared: **ЦАИС ЕОП publishes one public S3/MinIO bucket per day**,
each holding the day's notices/contracts/amendments as JSON. It is reachable from this box
(HTTP 200), structurally identical to the admin export's data model, and is intended to be the
durable, repeatable way to ingest historical data going forward.

**This plan replaces the admin ZIP on the CLI/backfill path with a loader for the EOP feed.**
The OCDS live path, the staging schema, `normalize-egov.sql`, `derive-amendments.sql`, and
`precompute.sql` stay in place; only their `source`-prefix predicates change to recognize the
new feed.

### Prerequisites / known facts (verified 2026-06-05)

- Bucket pattern: `https://<host>/open-data-{YYYY}-{MM}-{DD}/` — ListBucket-enabled, public.
  Test host today is `storage.eop.bg`; **base URL must be config.**
- Each bucket holds exactly **3 objects**, named
  `Автоматично генерирани данни за {resource}, публикувани в ЦАИС ЕОП през периода от {from} до {to}.json`
  where `{resource}` ∈ {`поръчки`, `договори`, `анекси`} and the period is `{day} → {day+1}`.
- Each file is a **flat JSON array** of records with **English camelCase keys** (NOT OCDS, NOT
  the Bulgarian-headed admin JSON). Join key across all three = `uniqueProcurementNumber` (UNP);
  `contractNumber` keys a contract within a UNP.
- Date coverage is probe-based: existing day → `200` + 3 objects; missing day → `403` (MinIO's
  response for a non-existent/non-public bucket), **not** `404`.
- Test data is synthetic (e.g. `Промакс (Тестова) ЕООД`, 16-digit register numbers) — wire to the
  **format**, never assume the figures are real.

## Problem

**P1 — `normalize-egov.sql` would silently drop EOP rows.** Staging is read with a hardcoded
source filter:

```sql
-- scripts/normalize-egov.sql:191
FROM raw_egov_contracts WHERE source LIKE 'admin:%' OR source LIKE 'ocds:%'
-- :298-301 (and :385-388) — "admin wins, OCDS fills genuinely-new" dedup:
WHERE c.source LIKE 'admin:%'
   OR (c.source LIKE 'ocds:%' AND c.contract_number IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM raw_egov_contracts a
        WHERE a.source LIKE 'admin:%' AND a.contract_number = c.contract_number))
-- :351 — data_freshness bucketing:
CASE WHEN source LIKE 'admin:%' THEN 'admin' WHEN source LIKE 'ocds:%' THEN 'ocds' ELSE 'other' END
```

EOP rows (`source = 'eop:%'`) match none of these → excluded from the domain build. The SQL must
learn the new prefix and the new precedence.

**P2 — the new feed's key vocabulary differs.** `load-admin.mjs` maps records **by Bulgarian
header name** (`'Уникален номер на поръчката'`). The EOP feed uses camelCase
(`uniqueProcurementNumber`). The existing loader cannot read EOP files without a new field map.

## Design — EOP loader + minimal SQL precedence swap

A new Node CLI (`scripts/load-eop.mjs`) fetches per-day buckets, maps camelCase → the **existing**
`raw_egov_*` staging columns (reusing `load-admin.mjs`'s coercion helpers), and batch-upserts with
a per-day scoped `source` wipe. Downstream SQL is unchanged except for swapping the
authoritative-historical predicate from `admin:%` to `eop:%`.

#### Decisions (resolved)

- **Idempotency unit = per-day source tag:** `eop:<cat>:<YYYY-MM-DD>` (e.g. `eop:contracts:2020-11-03`).
  Re-fetching one day wipes and reloads only that day's rows (`DELETE … WHERE source = ?`); a full
  rebuild wipes `LIKE 'eop:<cat>:%'`. `<cat>` ∈ {`contracts`, `tenders`, `annexes`}.
- **Precedence = EOP-wins-where-present:** EOP is the historical authority (it inherits admin's
  role). OCDS only contributes contracts **genuinely new** beyond EOP coverage (same
  `contract_number` NOT-EXISTS dedup, with `admin:%` → `eop:%`). A configurable cutover date is
  documented but not required day-one: in practice "EOP wins for any `contract_number` it carries,
  OCDS fills the forward tail."
- **Backfill runs as a local CLI** (`scripts/import.mjs`, as today). The Cloudflare cron stays
  **OCDS-only**. Moving the EOP pull on-platform (Workflow + Queue fan-out over a date range) is a
  documented future option, not in scope.
- **Bucket access via ListBucket, not filename reconstruction:** list the day's container, then
  classify each returned key by the resource word it contains (`поръчки`/`договори`/`анекси`).
  Avoids recomputing the `{from} до {to}` period string.

#### Resource → category → staging table

| Bucket file (`{resource}`) | `<cat>` | Staging table | keep filter (mirror admin) |
|---|---|---|---|
| `поръчки` | `tenders` | `raw_egov_tenders` | keep all rows |
| `договори` | `contracts` | `raw_egov_contracts` | keep only `contractNumber` non-null (signed) |
| `анекси` | `annexes` | `raw_egov_amendments` | keep only `contractNumber` non-null |

#### Coercion (reuse `load-admin.mjs` helpers) + EOP-specific gotchas

Reuse `toInt` / `toReal` (comma decimals `199733,33`) / `toBool` (`Да`/`Не`) / `toISODate`
(`dd.MM.yyyy`). EOP adds four cases the admin helpers don't cover — handle in the loader:

1. **`publicationDate` is ISO with 7-digit fractional seconds** (`2020-11-03T09:41:22.1266667`).
   `toISODate` returns it unchanged (no `dd.MM.yyyy` match). Add an ISO branch that slices to
   `YYYY-MM-DD` so `published_at` is a clean date.
2. **`hasUnsecuredFunding` → `secured_financing` is INVERTED** (`secured = NOT unsecured`). Map with
   negation; empty string → `NULL`.
3. **`hasVariants` is an enum, not Да/Не** (`Разрешено`/`Забранено`/`''`). Map `Разрешено`→1,
   `Забранено`→0, else `NULL`. (`toBool` would return `NULL` for both.)
4. **Register numbers stay text** — `supplierRegisterNumber`/`buyerRegistryNumber` can be 16 digits
   (synthetic test EIK); never coerce to int.

### Field cross-walk

Target columns are the existing staging columns (from `load-admin.mjs` `CATS[*].fields`). `null`
= no source field; leave NULL. **Tentative** rows need a quick semantic confirm against real prod
data before trusting them downstream (flagged ⚠).

#### `договори` → `raw_egov_contracts`

| EOP key | staging column | kind | note |
|---|---|---|---|
| noticeId | document_number | text | |
| publicationDate | published_at | date | ISO→date (gotcha 1) |
| uniqueProcurementNumber | unp | text | join key |
| tenderId | tender_ext_id | text | |
| procedureType | procedure_type | text | |
| tenderName | procurement_subject | text | |
| tenderMainCpv | cpv_code | text | |
| tenderMainCpvDescription | cpv_description | text | |
| typeOfContract | contract_kind | text | |
| estimatedValue | estimated_value | real | |
| currency | procurement_currency | text | |
| legalBasis | legal_basis | text | |
| awardMethod | award_criteria | text | |
| isJointProcurement | joint_procurement | bool | |
| isCentralPurchasingAuthority | central_purchasing | bool | |
| buyerName | authority_name | text | |
| buyerRegistryNumber | authority_eik | text | |
| buyerType | authority_type | text | |
| buyerMainActivity | main_activity | text | |
| noticeType | notice_type | text | |
| lotIdentifier | lot_id | text | |
| contractNumber | contract_number | text | keep filter |
| contractDate | contract_date | date | |
| contractValue | signing_value | real | |
| contractCurrency | currency | text | |
| contractSubject | contract_subject | text | |
| awardedToGroup | awarded_to_group | bool | |
| supplierRegisterNumber | contractor_eik | text | gotcha 4 |
| supplierName | contractor_name | text | |
| supplierNationality | contractor_country | text | |
| supplierCompanySizeCode | winner_size | text | |
| hasSubcontractors | has_subcontractor | bool | |
| subcontractorName | subcontractor_name | text | |
| subcontractorRegistryNumber | subcontractor_eik | text | |
| subcontractingPercent | subcontract_share | text | |
| subcontractingAmount | subcontract_value | real | |
| isEuFunded | eu_funded | bool | |
| europeanProgram | eu_programme | text | |
| isFrameworkAgreement | framework_notice | bool | |
| frameworkAgreementContract | framework_contract | bool | |
| linkedTenders | related_to | text | |
| contractUnderQs | dps_contract | bool | ⚠ QS≈ДСП — confirm |
| isAcceleratedProcedure | accelerated | bool | |
| hasAuctionQuotationMethod | eauction | bool | ⚠ confirm |
| isStrategicTender | strategic | bool | |
| isExceptionContract | outside_zop | bool | |
| directAwardJustification | exemption_legal_basis | text | |
| offersCount | bids_received | int | |
| smeOffersCount | bids_sme | int | |
| disqualifiedOffersCount | bids_rejected | int | |
| noEeaOffersCount | bids_non_eea | int | |
| contractPeriod | duration_days | int | ⚠ confirm unit = days |
| noAwarding | non_award | bool | |
| linkToOjEu | ted_link | text | |
| winner_owner_nationality | — | | null (no EOP source) |
| seq_no, correction_number | — | | null |
| _unmapped:_ supplierNutsCode, changeNoticeDocuments | — | | drop |

#### `поръчки` → `raw_egov_tenders`

| EOP key | staging column | kind | note |
|---|---|---|---|
| noticeId | document_number | text | |
| publicationDate | published_at | date | ISO→date |
| uniqueProcurementNumber | unp | text | |
| tenderId | tender_id | text | |
| procedureType | procedure_type | text | |
| subject | procurement_subject | text | |
| mainCpvCode | cpv_code | text | |
| mainCpvDescription | cpv_description | text | |
| typeOfContract | contract_kind | text | |
| estimatedValue | estimated_value | real | |
| currency | currency | text | |
| legalBasis | legal_basis | text | |
| awardMethod | award_criteria | text | |
| hasJointProcurement | joint_procurement | bool | |
| isCentralPurchasingAuthority | central_purchasing | bool | |
| buyerName | authority_name | text | |
| buyerRegistryNumber | authority_eik | text | |
| buyerType | authority_type | text | |
| buyerMainActivity | main_activity | text | |
| submissionDeadline | deadline | text | |
| noticeType | notice_type | text | |
| lotIdentifier | lot_id | text | |
| isEuFunded | eu_funded | bool | |
| europeanProgram | eu_programme | text | |
| hasUnsecuredFunding | secured_financing | bool | **inverted** (gotcha 2) |
| isFrameworkAgreement | framework_notice | bool | |
| isDpsProcedure | dps_notice | bool | |
| isAcceleratedProcedure | accelerated | bool | |
| hasElectronicAuction | eauction | bool | |
| isStrategicProcurement | strategic | bool | |
| isGreenProcurement | green | bool | |
| isSocialProcurement | social | bool | |
| isInnovationProcurement | innovation | bool | |
| hasOptions | options | bool | |
| hasRenewal | renewable | bool | |
| isReservedProcurement | reserved | bool | |
| hasVariants | variants | enum→bool | `Разрешено/Забранено` (gotcha 3) |
| lotsCount | num_lots | int | |
| executionPlaceNuts | place_of_performance | text | ⚠ NUTS code vs admin's place text |
| lotTenderName | lot_name | text | |
| tenderDuration | duration | text | |
| tenderDurationUnit | duration_unit | text | |
| tenderStartDate | start_date | date | dd.MM.yyyy |
| tenderEndDate | end_date | date | dd.MM.yyyy |
| electronicInvoicing | einvoicing | bool | |
| electronicPayment | epayment | bool | |
| electronicOrdering | eordering | bool | |
| changeNoticeCount | corrections_count | int | |
| isCancelled | cancelled | bool | |
| linkToOjEu | ted_link | text | |
| seq_no, correction_number | — | | null |
| _unmapped:_ changeNoticeDocuments, isLot | — | | drop |

#### `анекси` → `raw_egov_amendments`

| EOP key | staging column | kind | note |
|---|---|---|---|
| noticeId | document_number | text | |
| publicationDate | published_at | date | ISO→date |
| uniqueProcurementNumber | unp | text | |
| tenderId | tender_ext_id | text | |
| procedureType | procedure_type | text | |
| tenderName | procurement_subject | text | |
| tenderMainCpv | cpv_code | text | |
| tenderMainCpvDescription | cpv_description | text | |
| typeOfContract | contract_kind | text | |
| buyerName | authority_name | text | |
| buyerRegistryNumber | authority_eik | text | |
| buyerType | authority_type | text | |
| buyerMainActivity | main_activity | text | |
| lotIdentifier | lot_id | text | |
| contractNumber | contract_number | text | keep filter |
| contractDate | contract_date | date | |
| lastContractValue | value_before | real | |
| currentContractValue | value_after | real | |
| contractValueDifference | value_delta | real | |
| contractCurrency | currency | text | |
| contractSubject | contract_subject | text | |
| awardedToGroup | awarded_to_group | bool | |
| supplierRegisterNumber | contractor_eik | text | |
| supplierName | contractor_name | text | |
| supplierNationality | contractor_country | text | |
| supplierCompanySizeCode | winner_size | text | |
| isEuFunded | eu_funded | bool | |
| europeanProgram | eu_programme | text | |
| changeDescription | description | text | |
| changeReason | reason | text | |
| changeReasonDescription | circumstances | text | |
| isExceptionContract | outside_zop | bool | |
| directAwardJustification | exemption_legal_basis | text | |
| linkToOjEu | ted_link | text | |
| winner_owner_nationality, seq_no, correction_number | — | | null |
| _unmapped:_ supplierNutsCode, changeNoticeDocuments | — | | drop |

## Changes

1. **NEW loader `scripts/load-eop.mjs`**
   (mirrors `scripts/load-admin.mjs` structure; reuse its helpers — see change 2)
   - CLI: `node scripts/load-eop.mjs [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--cat=contracts|tenders|annexes] [--concurrency=N] [--apply] [--remote]`.
     Default range = configured backfill start → today; default cat = all three.
   - Base URL from env `EOP_OPEN_DATA_BASE_URL` (see change 5); never hardcode the host.
   - Per day in range: `GET {base}/open-data-{YYYY}-{MM}-{DD}/` (ListBucket XML). `200` → parse the
     3 `<Key>` entries, classify by resource word, fetch each object; `403`/`404` → skip (log as
     "not published"). Bound concurrency (default ~6) to be polite.
   - Map each record camelCase → staging columns per the cross-walk; apply the keep filter; coerce
     with shared helpers + the 4 EOP gotchas.
   - Fixed columns per row: `source='eop:<cat>:<YYYY-MM-DD>'`, `dataset_year=<year>`,
     `dataset_variant='eop'`, `fetched_at=<iso>`, and (contracts) `needs_enrichment=0`.
   - Emit batched SQL to `data/eop-<cat>-load.sql` (same byte/row batching as load-admin), prefixed
     with the scoped wipe: per-day `DELETE FROM <table> WHERE source = 'eop:<cat>:<date>'`, or a
     single `DELETE … WHERE source LIKE 'eop:<cat>:%'` for a full-range rebuild. `--apply` runs it
     via `wrangler d1 execute sigma --local|--remote --file …`.

2. **REFACTOR shared coercion out of `scripts/load-admin.mjs`** (small, optional-but-recommended)
   - Extract `clean/toInt/toReal/toBool/toISODate/coerce/lit` into `scripts/lib/staging-coerce.mjs`;
     import from both loaders. Extend `toISODate` with the ISO-with-fractional-seconds branch
     (gotcha 1) — benign for admin (admin dates are `dd.MM.yyyy`).
   - If a refactor is judged too invasive, duplicate the few helpers inside `load-eop.mjs` instead;
     do not edit the admin field maps.

3. **UPDATE `scripts/normalize-egov.sql`** — teach it `eop:%` and make EOP the historical authority
   (file: `scripts/normalize-egov.sql`)
   - Line ~191 staging select: `source LIKE 'admin:%' OR source LIKE 'ocds:%'`
     → add `OR source LIKE 'eop:%'`.
   - Lines ~298-301 and ~385-388 dedup: change the authoritative predicate from `admin:%` to
     `eop:%` (EOP wins; OCDS contributes only `contract_number` not present in EOP). Keep admin in
     the predicate only if a transition window needs both loaded simultaneously; default is to
     **replace** admin with eop.
   - Line ~351 `data_freshness` CASE: add `WHEN source LIKE 'eop:%' THEN 'eop'`.

4. **UPDATE `scripts/import.mjs`** — swap the historical staging step
   (file: `scripts/import.mjs:52`)
   - Replace `node scripts/load-admin.mjs --apply` with
     `node scripts/load-eop.mjs --apply [range flags]`.
   - Keep steps 3–6 (`derive-amendments.sql`, `load-fx.mjs`, `load-nuts.sql`, `normalize-egov.sql`,
     `precompute.sql`) as-is. Update the header comment block to describe the EOP source.

5. **ADD config** — base URL
   - `EOP_OPEN_DATA_BASE_URL` (e.g. test `https://storage.eop.bg`). Read by `load-eop.mjs`
     with a sane default + override. Document in `.dev.vars.example` and the README ETL section.
   - Not a secret (public buckets), but keep it config so the prod host swap is one env change.

6. **RETIRE the admin ZIP path (docs + pipeline, keep the script for history)**
   - `load-admin.mjs` drops off the `import.mjs` path; note it "retired — superseded by load-eop"
     in its header and in [etl-pipeline.md](etl-pipeline.md) Source history. Do not delete it.
   - Add a pointer to this doc from `etl-pipeline.md` and update its "two sources" framing to
     "EOP historical + OCDS go-forward."

## Key files

- NEW: `scripts/load-eop.mjs` — fetch per-day EOP buckets, map camelCase → staging, batched upsert.
- NEW: `scripts/lib/staging-coerce.mjs` — shared coercion helpers (extracted from load-admin).
- MODIFY: `scripts/normalize-egov.sql` — add `eop:%` to staging filter; EOP-wins dedup; freshness bucket.
- MODIFY: `scripts/import.mjs` — swap load-admin → load-eop on the backfill path.
- MODIFY: `.dev.vars.example`, `README.md` — document `EOP_OPEN_DATA_BASE_URL`.
- MODIFY: `docs/etl-pipeline.md` — reframe sources; link this doc.
- EXISTING (reused as-is): `packages/db/schema.sql` (`raw_egov_*` staging),
  `scripts/derive-amendments.sql`, `scripts/load-fx.mjs`, `scripts/load-nuts.sql`,
  `scripts/precompute.sql`, `apps/etl/*` (OCDS live path — untouched).
- RETIRED (kept for history): `scripts/load-admin.mjs` once the EOP feed replaces the admin JSON base.

## Verification

1. **Loader unit** — feed a saved single-day bucket fixture (the 3 sample files) to `load-eop.mjs`;
   assert generated row counts (contracts/tenders/annexes), the keep filter (no null-`contract_number`
   contracts/annexes), and the four gotchas: `published_at` is a clean date; `secured_financing`
   is the inverse of `hasUnsecuredFunding`; `variants` maps `Разрешено/Забранено`; 16-digit register
   numbers survive as text.
2. **Idempotency** — run a 2-day range twice; row counts identical; re-running one day rewrites only
   `source = 'eop:<cat>:<that-day>'`.
3. **Domain build** — `node scripts/import.mjs --reset` (local) over a small date range; assert
   `authorities/tenders/contracts` populate from `eop:%` rows (not zero), `data_freshness` shows an
   `eop` bucket, and OCDS-only contracts still appear for the forward tail.
4. **Precedence** — stage an overlapping `contract_number` in both `eop:%` and `ocds:%`; assert the
   EOP row wins in `contracts` and the OCDS duplicate is dropped.
5. **Spot-check ⚠ mappings** — once a real prod bucket exists, confirm `contractUnderQs→dps_contract`,
   `hasAuctionQuotationMethod→eauction`, `contractPeriod` unit, and `executionPlaceNuts` semantics
   against a known notice before relying on those columns.
6. **Config swap** — point `EOP_OPEN_DATA_BASE_URL` at the prod host (when available) and re-run a
   single day; no code change required.
