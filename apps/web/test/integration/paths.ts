import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEBROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const WRANGLER_JSONC = path.join(WEBROOT, 'apps/web/wrangler.jsonc');
export const MIG_0000 = path.join(WEBROOT, 'packages/db/migrations/0000_init.sql');
export const MIG_0001 = path.join(
  WEBROOT,
  'packages/db/migrations/0001_flow_pairs_bidder_index.sql',
);
// Migration 0002 adds `current_value_currency` — read by getContract (queries/details.ts) for
// amendment-currency conversions. The prod cloud D1 has it; without it the contract routes 500.
// Future migrations with new NOT NULL or DEFAULT-bearing columns this lane reads must be added
// here in lockstep.
export const MIG_0002 = path.join(
  WEBROOT,
  'packages/db/migrations/0002_current_value_currency.sql',
);
// Migrations 0006 (`amendments.value_restated`) and 0007 (`amendments.value_suspect`) are read by
// the `AMENDMENTS_SQL` amendment-timeline query inside `getContract` (queries/details.ts). Without
// them the contract HTML/JSON sibling routes 500 with `no such column: am.value_restated`. Both
// columns are NOT NULL DEFAULT 0, so the existing fixture seed keeps working unchanged. 0003-0005
// don't add columns this lane reads; 0008-0010 are out of scope for the contract page.
export const MIG_0006 = path.join(WEBROOT, 'packages/db/migrations/0006_amendment_restated.sql');
export const MIG_0007 = path.join(
  WEBROOT,
  'packages/db/migrations/0007_amendment_value_suspect.sql',
);
