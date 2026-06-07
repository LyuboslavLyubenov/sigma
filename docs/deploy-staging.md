# Staging deployment plan (multi-environment CD)

Status: **plan / agreed design** — not yet implemented. This document extends
[deploy.md](deploy.md) (the current single-target production guide) to a multi-environment
model: the existing **production** worker, a new **staging** copy, and — later — a second
production on a separate Cloudflare account. It is the source of truth for that rollout.

## Goal

Add a **staging** deployment of Sigma on Cloudflare, shipped by a GitHub Actions pipeline, that:

- lives at **`https://sigma-stage.obecto.workers.dev/`**,
- is **fully target-configurable** from the same source tree (no per-environment code fork),
- **never touches** the existing production deployment at `https://sigma.obecto.workers.dev/`, and
- leaves room for a **third production** on a **separate Cloudflare account** later, with no code change.

## Hard constraints

1. The production `sigma` / `sigma-etl` workers and the production `sigma` D1 stay **byte-for-byte
   unchanged** by any staging activity.
2. Production must continue to deploy exactly as it does today (cut a `v*` tag → ship).
3. No production resource identifiers in the repo (the existing zero-UUID-sentinel rule holds).

## Decisions

| Area | Decision | Notes |
|---|---|---|
| Config mechanism | **Env-var rendering** via [scripts/wrangler-render.mjs](../scripts/wrangler-render.mjs), extended with a single `SIGMA_NAME_SUFFIX` knob | Keeps the repo's "any account via env vars" model; prod default (empty) renders identically to today. See *Why a suffix* below. |
| Secrets / targets | **GitHub Environments** `staging` + `production`, each holding its own credentials | Ready-made home for the future separate-account production. |
| Production trigger | `v*` tag (unchanged) + manual `workflow_dispatch` | Identical release flow to today. |
| Staging trigger | Manual `workflow_dispatch` (default) | No second tag convention, no surprise auto-deploys. *Opt-in later:* also fire on push to `main` for continuous staging. |
| Staging ETL | Deploy `sigma-etl-stage` **with its cron on** | Knowingly **idles on errors** until the `data.egov.bg` egress path is unblocked — see *Data & the ETL cron caveat*. |
| Staging data seed | One-time **local** load from the open `storage.eop.bg` feed into the `sigma-stage` D1 | Uses the existing through-2025 corpus; see *One-time setup*. |
| Account | Staging shares the **current (obecto)** account; production-v2 later on a **separate** account | Only env-var/secret values change. |

## Target topology

| | Production (today, untouched) | **Staging (new)** | Production-v2 (future) |
|---|---|---|---|
| Web worker | `sigma` → sigma.obecto.workers.dev | **`sigma-stage`** → sigma-stage.obecto.workers.dev | new name, 3rd URL |
| ETL worker | `sigma-etl` (cron) | **`sigma-etl-stage`** (cron) | — |
| Workflow name (account-global) | `sigma-refresh` | **`sigma-refresh-stage`** | — |
| D1 | `sigma` (prod id) | **`sigma-stage`** (own id) | own DB |
| CF account | obecto | obecto (shared, for now) | **separate account** |
| GitHub Environment | `production` | `staging` | `production` (repointed) |

The `workers.dev` hostname follows the worker name automatically, so naming the worker
`sigma-stage` is all it takes to serve `sigma-stage.obecto.workers.dev` — no routes or custom
domains to configure.

## How it works — the rendering model

There is **one** set of committed `wrangler.*` files holding safe local-dev defaults (worker
name `sigma`/`sigma-etl`, workflow `sigma-refresh`, `database_name = "sigma"`, and a zero-UUID
`database_id`). A deploy never edits them — it renders a throwaway `wrangler.deploy.*` with
environment-specific values injected from env vars, then ships that. The only difference between
a staging deploy and a production deploy is **which env-var values are in scope**:

| env var | production | staging | consumed by |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | prod token | staging token | wrangler (auth) |
| `CLOUDFLARE_ACCOUNT_ID` | obecto | obecto (same, for now) | wrangler (auth) |
| `SIGMA_D1_ID` | prod D1 id | **staging D1 id** | render → `database_id` |
| `SIGMA_NAME_SUFFIX` | *(empty → defaults)* | `-stage` | render → worker / workflow / db names |

`pnpm --filter @sigma/web run deploy` is unchanged — its three steps already are
`build → render → deploy`:

```
react-router build                                              # name:"sigma", id: 0000…0000
node scripts/wrangler-render.mjs build/server/wrangler.json     # read env vars → wrangler.deploy.json
wrangler deploy --config build/server/wrangler.deploy.json      # ship the rendered file
```

With **staging** env vars in scope the render produces:

```diff
- "name": "sigma",
+ "name": "sigma-stage",
- "database_name": "sigma",
+ "database_name": "sigma-stage",
- "database_id": "00000000-0000-0000-0000-000000000000"
+ "database_id": "<staging D1 id>"
```

The ETL package renders identically, additionally suffixing the worker name
(`sigma-etl-stage`) and the **account-global** Workflow name (`sigma-refresh-stage`). With
**production** env vars (`SIGMA_NAME_SUFFIX` empty), only `database_id` changes and everything
else stays `sigma` — i.e. **identical to today**. No `--env` flag and **no per-package script
changes**.

### Why a suffix (and not explicit per-resource names)

A single `SIGMA_NAME_SUFFIX` collapses all the renamed resources into one knob, and — crucially —
keeps the render script **generic and unambiguous**. The literal value `"sigma"` appears as *both*
the web worker `name` and the `database_name`, so a "replace the name `sigma` with `SIGMA_WEB_NAME`"
scheme can't tell the two apart without full structural parsing plus per-app env-var wiring
(`SIGMA_WEB_NAME` vs `SIGMA_D1_NAME` vs `SIGMA_ETL_NAME` …). Appending one suffix to every
name-like field sidesteps the ambiguity, guarantees the names can't drift out of sync, and reduces
the per-environment CI configuration to a **single** non-secret variable. Production = empty suffix
= byte-identical config.

> Render implementation note: the script becomes lightly format-aware — `JSON.parse → mutate the
> known fields → stringify` for the web build's `wrangler.json`, and targeted line-anchored regex
> for the ETL `wrangler.toml` (`name`, `[[workflows]] name`, `database_name`; never `class_name`
> or `binding`). `database_id` continues to come from the `SIGMA_D1_ID` sentinel substitution.

## GitHub Environments

Create two Environments; the deploy job's `environment:` field selects which one's
secrets/variables resolve.

**`production`** (mirror of today's repo secrets, so prod behaviour is unchanged):
- secret `CLOUDFLARE_API_TOKEN`, secret `CLOUDFLARE_ACCOUNT_ID`, secret `SIGMA_D1_ID` (prod)
- variable `SIGMA_NAME_SUFFIX` = *(empty / unset)*

**`staging`**:
- secret `CLOUDFLARE_API_TOKEN` (same account token is fine for now), secret
  `CLOUDFLARE_ACCOUNT_ID` (= obecto), secret `SIGMA_D1_ID` (the new `sigma-stage` D1)
- variable `SIGMA_NAME_SUFFIX` = `-stage`

> `SIGMA_D1_NAME` is **not** needed in CI — it is only used by the local seed/provision scripts
> (below). At deploy time the staging database name comes from the suffix and the binding comes
> from `SIGMA_D1_ID`.

> Optional hardening: give `production` **required reviewers** so a prod deploy waits for a manual
> "Review deployments" click.

## The CI workflow

A single workflow [.github/workflows/deploy.yml](../.github/workflows/deploy.yml), reworked from
today's tag-only version. Illustrative shape:

```yaml
on:
  push:
    tags: ['v*']            # → production
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        options: [staging, production]
        default: staging
  # opt-in later for continuous staging:
  # push: { branches: [main] }   # → staging

jobs:
  detect:                    # map the git event → an environment name
    runs-on: ubuntu-latest
    outputs:
      env: ${{ steps.pick.outputs.env }}
    steps:
      - id: pick
        run: |
          if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            echo "env=${{ inputs.environment }}" >> "$GITHUB_OUTPUT"
          elif [[ "${{ github.ref }}" == refs/tags/v* ]]; then
            echo "env=production" >> "$GITHUB_OUTPUT"
          else
            echo "env=staging" >> "$GITHUB_OUTPUT"   # only reached if push:main is enabled
          fi

  deploy:
    needs: detect
    runs-on: ubuntu-latest
    environment: ${{ needs.detect.outputs.env }}      # ← selects the GitHub Environment
    concurrency:
      group: deploy-${{ needs.detect.outputs.env }}   # per-env lane; staging never blocks prod
      cancel-in-progress: false
    env:
      CLOUDFLARE_API_TOKEN:  ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      SIGMA_D1_ID:           ${{ secrets.SIGMA_D1_ID }}
      SIGMA_NAME_SUFFIX:     ${{ vars.SIGMA_NAME_SUFFIX }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - name: Guard — require deploy credentials   # same guard as today (token, account, D1 id)
        run: |
          missing=()
          [ -z "$CLOUDFLARE_API_TOKEN" ]  && missing+=(CLOUDFLARE_API_TOKEN)
          [ -z "$CLOUDFLARE_ACCOUNT_ID" ] && missing+=(CLOUDFLARE_ACCOUNT_ID)
          [ -z "$SIGMA_D1_ID" ]           && missing+=(SIGMA_D1_ID)
          [ ${#missing[@]} -gt 0 ] && { echo "::error::Missing: ${missing[*]}"; exit 1; } || true
      - run: pnpm typecheck
      - run: pnpm --filter @sigma/web run deploy
      - run: pnpm --filter @sigma/etl run deploy
```

The `environment:` line is the linchpin: it is what makes `${{ secrets.* }}` and `${{ vars.* }}`
resolve from the *correct* Environment, so the same steps ship to staging or production purely on
which credentials and suffix are in scope.

## The recurring procedure

### Staging deploy

```
Actions tab → Run workflow → environment: staging        (or `gh workflow run deploy.yml -f environment=staging`)
```
1. `detect` → `env = staging`.
2. `deploy` runs with `environment: staging` → staging credentials + `SIGMA_NAME_SUFFIX=-stage`.
3. Guard → `pnpm typecheck`.
4. Web deploy renders `sigma-stage` + staging D1 id → ships **`sigma-stage`** → live at
   **sigma-stage.obecto.workers.dev**.
5. ETL deploy ships **`sigma-etl-stage`**, registering the **`sigma-refresh-stage`** Workflow +
   cron against the **`sigma-stage`** D1.

### Production deploy (unchanged from today)

```
git tag v1.3.0 && git push origin v1.3.0
```
1. `detect` → `env = production`.
2. `deploy` runs with `environment: production` → prod credentials, empty suffix.
3. Guard → typecheck.
4. Web deploy renders `name:"sigma"` + prod D1 id → ships the **`sigma`** worker (same bytes as
   today) at sigma.obecto.workers.dev.
5. ETL deploy ships **`sigma-etl`** / **`sigma-refresh`** against the prod D1.

## Isolation guarantees — why staging can't touch production

Three independent walls; any one is sufficient:

1. **Different worker names.** A staging render produces `sigma-stage` / `sigma-etl-stage`;
   `wrangler deploy` only overwrites the worker named in its config. It cannot write to `sigma`.
2. **Different D1.** Staging binds the `sigma-stage` id; prod's `sigma` DB is never named or
   referenced in a staging render. The seed/provision scripts target `sigma-stage` **by name** via
   `SIGMA_D1_NAME` — without it they default to `sigma`, so that flag is the guard that keeps a
   seed off production.
3. **Different credentials / lane.** Staging uses the `staging` Environment's secrets and the
   `deploy-staging` concurrency group. When production-v2 moves to its own account, the **account
   boundary** becomes a fourth wall: a staging token has no access to the prod account at all.

## One-time setup (runbook)

Run locally, against the obecto account (the seed source `storage.eop.bg` is open / not
IP-restricted, so this works from the dev box):

```bash
# 1. Provision the staging D1 (SIGMA_D1_NAME keeps it OFF production)
SIGMA_D1_NAME=sigma-stage node scripts/bootstrap.mjs --apply
#    → capture the printed database_id

# 2. Seed it from storage.eop.bg (uses the existing through-2025 corpus / EOP_OPEN_DATA_BASE_URL)
SIGMA_D1_NAME=sigma-stage node scripts/import.mjs --remote      # migrate → load → fx → normalize → precompute (~20 min)
```

Then, in GitHub:

3. Create the `staging` and `production` Environments with the secrets/variables in *GitHub
   Environments* above. Put the new `database_id` into `staging.SIGMA_D1_ID`; mirror today's repo
   secrets into `production`.
4. (Optional but recommended) verify by dispatching a **staging** deploy first, confirm
   `sigma-stage.obecto.workers.dev` is live and `sigma` is untouched, *then* trust the next real
   `v*` tag through the `production` Environment.

> Schema changes are applied out-of-band, per environment, e.g.
> `SIGMA_D1_NAME=sigma-stage wrangler d1 migrations apply sigma-stage --remote`. Deploys do not
> migrate or reload data (matches current production behaviour).

## Data & the ETL cron caveat

There are **two** ETL sources with opposite reachability:

- **Historical bulk** ([scripts/load-eop.mjs](../scripts/load-eop.mjs)) → `https://storage.eop.bg`
  (overridable via `EOP_OPEN_DATA_BASE_URL`). **Open** → the staging seed above just works.
- **Go-forward 2026+ delta** ([scripts/load-ocds.mjs](../scripts/load-ocds.mjs) and the on-platform
  ingest in [packages/ingest](../packages/ingest)) → `https://data.egov.bg/api`. **IP-restricted**
  (403 from non-BG egress).

The deployed cron `RefreshWorkflow` ([apps/etl/src/index.ts](../apps/etl/src/index.ts)) pulls the
**OCDS / `data.egov.bg`** delta — *not* storage.eop.bg. So `sigma-etl-stage`'s cron will **idle on
errors** from Cloudflare egress exactly like production, until either the planned **BG egress
proxy** for `data.egov.bg` lands, or the Worker's ingester is repointed at the open
`storage.eop.bg` feed (a separate ETL change, out of scope here). Staging still shows full
through-2025 data the whole time; deploying the cron now is harmless. Consider staggering the
staging schedule (e.g. `30 */6 * * *`) so it doesn't hit the source at the same minute as prod.

## Production-v2 (future, separate account)

No code change: fill the `production` Environment with the new account's
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `SIGMA_D1_ID`, set its `SIGMA_NAME_SUFFIX`
(empty keeps `sigma`, or a suffix for a distinct name), provision + seed its D1 the same way, and
deploy. The env-var rendering already supports N targets.

## Implementation checklist

Code (delegated edits; prod path stays functionally identical):

- [ ] [scripts/wrangler-render.mjs](../scripts/wrangler-render.mjs) — append `SIGMA_NAME_SUFFIX`
      (empty default) to worker `name`, `[[workflows]] name`, and `database_name`; keep the
      `SIGMA_D1_ID` substitution; format-aware per the render note above.
- [ ] [scripts/bootstrap.mjs](../scripts/bootstrap.mjs) — `SIGMA_D1_NAME` (default `sigma`) for
      `wrangler d1 create`.
- [ ] [scripts/import.mjs](../scripts/import.mjs) — `SIGMA_D1_NAME` (default `sigma`) for every
      `wrangler d1 …` call (`migrations apply`, `execute`).
- [ ] [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) — `detect` job + dynamic
      `environment:` + `workflow_dispatch` input + per-env `concurrency` + export
      `SIGMA_NAME_SUFFIX`.
- [ ] [.env.example](../.env.example) — document `SIGMA_NAME_SUFFIX` and `SIGMA_D1_NAME`.
- [ ] [deploy.md](deploy.md) — cross-link this plan / add a short "environments" pointer.

One-time / manual (not code): provision + seed the `sigma-stage` D1; create the two GitHub
Environments.

## Open items

- **Staging trigger** is set to manual `workflow_dispatch`; flip to push-to-`main` if continuous
  staging is wanted.
- **Cron freshness** on staging depends on the `data.egov.bg` egress fix (BG proxy or EOP-repoint)
  — tracked separately from this deploy work.
- Whether to add a **required-reviewers** gate on the `production` Environment.
