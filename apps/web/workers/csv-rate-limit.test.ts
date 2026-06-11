import { describe, expect, it, vi } from 'vitest';
import { rateLimitCsvExport } from './csv-rate-limit';

function rateLimiter(success: boolean): { limiter: RateLimit; limit: ReturnType<typeof vi.fn> } {
  const limit = vi.fn(async () => ({ success }));
  return { limiter: { limit } as RateLimit, limit };
}

describe('rateLimitCsvExport', () => {
  it('allows CSV requests when the limiter allows the key', async () => {
    const { limiter, limit } = rateLimiter(true);

    const response = await rateLimitCsvExport(
      new Request('http://local/contracts.csv', {
        headers: { 'CF-Connecting-IP': '203.0.113.10' },
      }),
      { CSV_RATE_LIMITER: limiter },
      false,
    );

    expect(response).toBeNull();
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.10' });
  });

  it('returns a hardened 429 when the limiter rejects the key', async () => {
    const { limiter, limit } = rateLimiter(false);

    const response = await rateLimitCsvExport(
      new Request('http://local/contracts.csv', {
        headers: { 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' },
      }),
      { CSV_RATE_LIMITER: limiter },
      true,
    );

    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.9' });
    expect(response?.status).toBe(429);
    expect(response?.headers.get('Retry-After')).toBe('60');
    expect(response?.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response?.headers.get('Strict-Transport-Security')).toContain('max-age=31536000');
  });

  it('fails open when the binding is missing', async () => {
    await expect(
      rateLimitCsvExport(new Request('http://local/contracts.csv'), {}, false),
    ).resolves.toBeNull();
  });

  it('fails open when the binding throws', async () => {
    const limit = vi.fn(async () => {
      throw new Error('rate limit unavailable');
    });

    await expect(
      rateLimitCsvExport(
        new Request('http://local/contracts.csv'),
        { CSV_RATE_LIMITER: { limit } as RateLimit },
        false,
      ),
    ).resolves.toBeNull();
  });

  it('does not call the limiter for non-CSV requests', async () => {
    const { limiter, limit } = rateLimiter(false);

    const response = await rateLimitCsvExport(
      new Request('http://local/'),
      { CSV_RATE_LIMITER: limiter },
      false,
    );

    expect(response).toBeNull();
    expect(limit).not.toHaveBeenCalled();
  });
});
