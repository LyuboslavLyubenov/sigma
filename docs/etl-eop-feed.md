# EOP daily bucket feed

storage.eop.bg is the single procurement source for Sigma.

## Bucket shape

Daily bucket URL:

```text
https://storage.eop.bg/open-data-YYYY-MM-DD/
```

The bucket is probed with a ListBucket XML request. `200` means the day is published. `403` or `404`
means the day is skipped.

A published day has four JSON objects:

| File kind | Role | Staging source prefix |
| --- | --- | --- |
| plain contracts JSON | base contracts | `eop:contracts:YYYY-MM-DD` |
| plain tenders JSON | base tenders and lots | `eop:tenders:YYYY-MM-DD` |
| plain annexes JSON | base amendments | `eop:annexes:YYYY-MM-DD` |
| OCDS release package | enrichment and OCDS-only rows | `ocds:YYYY-MM-DD` |

Object names are discovered from the bucket listing and classified with `classifyBucketKey`. The
loader does not reconstruct filenames.

## Base and enrichment

The plain JSON files are the base. They carry the flat camelCase EOP model and load into the existing
raw staging tables.

The OCDS file enriches the base with data that is naturally nested in OCDS:

- party address and contact email/phone
- all suppliers per award
- contract amendments in OCDS releases
- per-lot value amount and currency

OCDS lots are joined defensively. The trusted bridge is OCDS `tender.id` to base `tenderId`, then to
UNP and domain lot id. `ocid` is never treated as UNP.

## CLI flow

`scripts/load-eop.mjs` handles both base and OCDS files for a requested date window. It writes SQL
files by default and applies them only with `--apply`.

Useful modes:

```text
node scripts/load-eop.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD
node scripts/load-eop.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --apply
node scripts/load-eop.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --ocds-only
node scripts/load-eop.mjs --from=YYYY-MM-DD --to=YYYY-MM-DD --no-ocds
```

`scripts/import.mjs --catchup` detects the loaded bucket boundary and computes the catch-up window.
Use `--plan-only` to print the plan without loading.

Large gaps use full derive. Small gaps use slice derive.

## Worker flow

`apps/etl` is the steady-state Worker refresh. It is storage.eop.bg-only and has
`EOP_OPEN_DATA_BASE_URL = "https://storage.eop.bg"` in Wrangler config.

The Worker is intentionally capped to a small recent window. If the database is far behind, the Worker
logs that the window was capped and leaves the large catch-up to the CLI.

Current Worker limitation: only the in-bucket OCDS file is staged by the Worker. Base plain-JSON
staging remains CLI-only until the EOP plain-JSON coercion map is extracted from `load-eop.mjs` into a
shared package.

## Retired source

The procurement ETL no longer discovers or fetches procurement data from data.egov.bg. Any old OCDS
entrypoint is compatibility-only and delegates to the storage.eop.bg bucket loader.
