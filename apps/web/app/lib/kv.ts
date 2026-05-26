// Memoise hot aggregate reads in the CACHE KV. Keys carry a version tag; values use a short TTL so a
// daily data refresh naturally supersedes them. Falls back to computing directly if KV is absent
// (e.g. a misconfigured local env) or on any KV error — caching must never break a page.
export async function cachedJson<T>(
  cache: KVNamespace | undefined,
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> {
  if (!cache) return compute();
  try {
    const hit = await cache.get<T>(key, 'json');
    if (hit != null) return hit;
  } catch {
    // ignore read error — fall through to compute
  }
  const value = await compute();
  try {
    await cache.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
  } catch {
    // ignore write error
  }
  return value;
}
