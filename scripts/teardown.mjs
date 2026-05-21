#!/usr/bin/env node
// Clear local-only state (miniflare D1/KV/R2 under each worker's .wrangler dir).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  'apps/api/.wrangler',
  'apps/etl/.wrangler',
  'apps/admin/.wrangler',
  'apps/assistant/.wrangler',
];

for (const t of targets) {
  rmSync(resolve(root, t), { recursive: true, force: true });
  console.log(`==> removed ${t}`);
}

console.log('==> Local state cleared.');
