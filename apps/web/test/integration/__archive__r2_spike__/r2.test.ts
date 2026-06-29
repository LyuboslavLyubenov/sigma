// Round 2 validation spike for P1-T1. Lives under apps/web/workers/__ralph_spike/ so it
// is picked up by the existing unit-test project's include glob (workers/**/*.test.ts).
// Once all 4 assertions pass, the spike is deleted and the production surface lands.
//
// The spike does NOT touch .wrangler/state — it uses persist: false so the dev seed
// is never disturbed. The spike does NOT modify workers/app.ts; it imports the worker
// to verify the polyfill unblocks module init.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import wrangler from 'wrangler';

const WEBROOT = '/Users/lyuboslavlyubenov/Desktop/sigma-web-route-integration';
const WRANGLER_JSONC = `${WEBROOT}/apps/web/wrangler.jsonc`;
const MIG_0000 = `${WEBROOT}/packages/db/migrations/0000_init.sql`;
const MIG_0001 = `${WEBROOT}/packages/db/migrations/0001_flow_pairs_bidder_index.sql`;

// Strip SQL line-comments and collapse whitespace per statement. D1's exec rejects
// inputs that start with `--` AND rejects multi-line CREATE TABLE statements, so the
// migration must be split into single-statement single-line exec calls.
function prepareSql(raw: string): string[] {
  const stripped = raw
    .split('\n')
    .map((l) => {
      const idx = l.indexOf('--');
      return idx === -1 ? l : l.slice(0, idx).trimEnd();
    })
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  const statements: string[] = [];
  let buf = '';
  let inString = false;
  let stringChar: string | null = null;
  for (const ch of stripped) {
    if (inString) {
      buf += ch;
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
    }
    if (ch === ';') {
      const t = buf.trim();
      if (t) statements.push(t.replace(/\s+/g, ' ').trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) statements.push(buf.trim().replace(/\s+/g, ' '));
  return statements;
}

class PolyfillCache {
  private map = new Map<string, Response>();
  async match(req: Request | string): Promise<Response | undefined> {
    return this.map.get(typeof req === 'string' ? req : req.url);
  }
  async put(req: Request | string, res: Response): Promise<void> {
    this.map.set(typeof req === 'string' ? req : req.url, res);
  }
  async delete(req: Request | string): Promise<boolean> {
    return this.map.delete(typeof req === 'string' ? req : req.url);
  }
  async matchAll(): Promise<Response[]> {
    return [...this.map.values()];
  }
  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }
  get default(): PolyfillCache {
    return this;
  }
  static get default(): PolyfillCache {
    return new PolyfillCache();
  }
}

class PolyfillCacheStorage {
  private byName = new Map<string, PolyfillCache>();
  async open(name: string): Promise<PolyfillCache> {
    let c = this.byName.get(name);
    if (!c) {
      c = new PolyfillCache();
      this.byName.set(name, c);
    }
    return c;
  }
  get default(): PolyfillCache {
    let c = this.byName.get('default');
    if (!c) {
      c = new PolyfillCache();
      this.byName.set('default', c);
    }
    return c;
  }
  async match(req: Request | string, opts?: unknown): Promise<Response | undefined> {
    return this.default.match(req);
  }
  async has(name: string): Promise<boolean> {
    return this.byName.has(name);
  }
  async delete(name: string): Promise<boolean> {
    return this.byName.delete(name);
  }
  async keys(): Promise<string[]> {
    return [...this.byName.keys()];
  }
}

// The polyfill must run BEFORE worker/app.ts is evaluated. setupFiles run in declaration
// order before any test module is loaded. The polyfill is installed on first import.
if (typeof globalThis.caches === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).caches = new PolyfillCacheStorage();
}

describe('P1-T1 round-2 spike', () => {
  it('A1-polyfill + A2-migrations + A3-ratelimit-end-to-end + A7-import-meta-env', async () => {
    // A7-import-meta-env
    expect(import.meta.env.PROD).toBe(false);
    expect(import.meta.env.MODE).toBe('test');

    // Boot proxy
    const proxy = await wrangler.getPlatformProxy({
      configPath: WRANGLER_JSONC,
      persist: false,
      remoteBindings: false,
    });

    try {
      // A0-bindings re-verify
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = proxy as any;
      expect(typeof p.env.DB.prepare).toBe('function');
      expect(typeof p.env.CSV_RATE_LIMITER.limit).toBe('function');

      // A2-migrations: apply 0000 + 0001 manually, then fixture
      const stmts0000 = prepareSql(readFileSync(MIG_0000, 'utf8'));
      const stmts0001 = prepareSql(readFileSync(MIG_0001, 'utf8'));
      for (const s of stmts0000) await p.env.DB.exec(s);
      for (const s of stmts0001) await p.env.DB.exec(s);

      const FIXTURE = `
        INSERT OR IGNORE INTO authorities (id, name, bulstat, type)
          VALUES ('auth:BG000000000', 'Authority Test', 'BG000000000', 'Министерство');
        INSERT OR IGNORE INTO bidders (id, name, bulstat, eik_normalized, eik_valid, is_consortium, kind)
          VALUES ('eik:BG000000001', 'Bidder Test', 'BG000000001', '0000000001', 1, 0, 'company');
        INSERT OR IGNORE INTO tenders (id, source_id, title, authority_id, currency, procedure_type)
          VALUES ('t:FIX-1', 'FIX-1', 'Test tender', 'auth:BG000000000', 'BGN', 'открита');
        INSERT OR IGNORE INTO home_totals (id, contracts, value_eur, authorities, bidders, suspect, refreshed_at)
          VALUES (1, 30, 1000000.0, 1, 1, 0, datetime('now'));
        INSERT OR IGNORE INTO data_freshness (source, refreshed_at)
          VALUES ('admin', datetime('now'));
      `;
      for (const s of prepareSql(FIXTURE)) await p.env.DB.exec(s);

      // 30 contracts, strictly decreasing amount_eur
      const cv: string[] = [];
      for (let i = 1; i <= 30; i++) {
        const amount = (30 - i + 1) * 1000 + i;
        const m = ((i - 1) % 12) + 1;
        const y = 2020 + Math.floor((i - 1) / 12);
        const d = ((i - 1) % 28) + 1;
        const signedAt = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        cv.push(
          `('c:${i}', 't:FIX-1', 'eik:BG000000001', ${amount}, 'BGN', '${signedAt}', 'ok', 'ok', ${amount}, 0)`,
        );
      }
      const CONTRACT_INSERT = `INSERT OR IGNORE INTO contracts (id, tender_id, bidder_id, amount, currency, signed_at, value_flag, date_flag, amount_eur, fx_converted) VALUES ${cv.join(', ')}`;
      await p.env.DB.exec(CONTRACT_INSERT);

      const row = await p.env.DB.prepare("SELECT COUNT(*) AS c FROM contracts").first();
      expect(row).toEqual({ c: 30 });

      // A1-polyfill: importing the worker should succeed because globalThis.caches is set
      const app = (await import('../app')) as { default: { fetch: (...args: unknown[]) => Promise<Response> } };
      expect(typeof app.default.fetch).toBe('function');

      // A3-ratelimit-end-to-end: 11x from one IP, 11th = 429
      const outcomes: Array<{ status: number; retryAfter: string | null; body: string }> = [];
      for (let i = 1; i <= 11; i++) {
        try {
          const res = await app.default.fetch(
            new Request('https://sigma.test/contracts.csv', {
              headers: { 'CF-Connecting-IP': '203.0.113.30' },
            }),
            p.env,
            p.ctx,
          );
          const body = await res.text();
          outcomes.push({
            status: res.status,
            retryAfter: res.headers.get('Retry-After'),
            body,
          });
        } catch (e) {
          outcomes.push({ status: 0, retryAfter: null, body: `ERROR: ${(e as Error).message}` });
        }
      }
      console.log('ratelimit outcomes:', outcomes);
      // First 10 should NOT have reached the request handler (i.e. status 200 or 429)
      // The 11th should specifically return 429
      // (Note: the request handler throws because virtual:react-router/server-build is unresolved,
      //  so calls 1-10 will return 500 (the error caught at withRequestLog level); the 11th will
      //  cleanly return 429 before the request handler runs.)
      const eleventh = outcomes[10];
      expect(eleventh.status).toBe(429);
      expect(eleventh.retryAfter).toBe('60');
      expect(eleventh.body).toBe('Too many CSV export requests');
    } finally {
      await proxy.dispose();
    }
  });
});
