import { describe, expect, it } from 'vitest';
import { assertCacheable } from './headers';

describe('assertCacheable — s-maxage must be non-zero (ydimitrof review 2026-08-31, thread on headers.ts:179)', () => {
  it('accepts a positive s-maxage with stale-while-revalidate', () => {
    const res = new Response('body', {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    });
    expect(() => assertCacheable(res)).not.toThrow();
  });

  it('rejects `s-maxage=0` (not edge-cacheable — "do not cache")', () => {
    // The previous regex `/s-maxage=\d+/` matched `s-maxage=0`, and the bare
    // `stale-while-revalidate=` check did not exclude the zero case, so a response with
    // `public, s-maxage=0, stale-while-revalidate=60` would have passed the assertion even
    // though it is NOT edge-cacheable. The fix tightens the regex to `[1-9]\d*` so `s-maxage=0`
    // fails — this is the regression the new test pins.
    const res = new Response('body', {
      headers: { 'Cache-Control': 'public, s-maxage=0, stale-while-revalidate=60' },
    });
    expect(() => assertCacheable(res)).toThrow(/s-maxage/);
  });

  it('rejects when s-maxage is missing entirely', () => {
    const res = new Response('body', {
      headers: { 'Cache-Control': 'public, stale-while-revalidate=60' },
    });
    expect(() => assertCacheable(res)).toThrow(/s-maxage/);
  });

  it('rejects when stale-while-revalidate is missing (both directives must appear together)', () => {
    const res = new Response('body', { headers: { 'Cache-Control': 'public, s-maxage=3600' } });
    expect(() => assertCacheable(res)).toThrow(/stale-while-revalidate/);
  });
});