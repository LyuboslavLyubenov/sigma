#!/usr/bin/env node
// Create the Cloudflare resources Sigma needs (one-time per CF account).
// Dry-run by default; pass --apply to actually create them.
import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');

const resources = [
  { kind: 'D1', cmd: ['d1', 'create', 'sigma'] },
  { kind: 'KV', cmd: ['kv', 'namespace', 'create', 'CACHE'] },
  { kind: 'R2', cmd: ['r2', 'bucket', 'create', 'sigma-raw'] },
];

console.log(apply ? '==> Creating Cloudflare resources' : '==> Dry run (pass --apply to create)');

for (const r of resources) {
  const line = `wrangler ${r.cmd.join(' ')}`;
  if (apply) {
    console.log(`==> ${line}`);
    try {
      execFileSync('wrangler', r.cmd, { stdio: 'inherit' });
    } catch {
      console.error(`!! ${r.kind} creation failed (it may already exist) — continuing`);
    }
  } else {
    console.log(`  ${line}`);
  }
}

if (!apply) {
  console.log('\nAfter creating, copy the printed IDs into each apps/*/wrangler.toml.');
}
