import { baseSecurityHeaders } from '../app/lib/security';

const CSV_RATE_LIMIT_PERIOD_SECONDS = 60;
const CSV_RATE_LIMIT_FALLBACK_KEY = 'unknown-client';

interface CsvRateLimitEnv {
  CSV_RATE_LIMITER?: RateLimit;
}

export async function rateLimitCsvExport(
  request: Request,
  env: CsvRateLimitEnv,
  isProd: boolean,
): Promise<Response | null> {
  if (!isCsvRequest(request)) return null;

  const limiter = env.CSV_RATE_LIMITER;
  if (!limiter) return null;

  try {
    const outcome = await limiter.limit({ key: csvRateLimitKey(request) });
    if (outcome.success) return null;
  } catch {
    return null;
  }

  return rateLimitExceededResponse(request, isProd);
}

function isCsvRequest(request: Request): boolean {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    new URL(request.url).pathname.endsWith('.csv')
  );
}

function csvRateLimitKey(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP')?.trim() ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    CSV_RATE_LIMIT_FALLBACK_KEY
  );
}

function rateLimitExceededResponse(request: Request, isProd: boolean): Response {
  const headers = new Headers({
    'Retry-After': String(CSV_RATE_LIMIT_PERIOD_SECONDS),
  });

  if (request.method !== 'HEAD') {
    headers.set('Content-Type', 'text/plain; charset=utf-8');
  }

  for (const [key, value] of baseSecurityHeaders(isProd)) headers.set(key, value);

  return new Response(request.method === 'HEAD' ? null : 'Too many CSV export requests', {
    status: 429,
    headers,
  });
}
