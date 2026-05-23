import { getTenderById, listRecentTenders, type TenderRow } from '@sigma/db';
import {
  type SearchTendersResponse,
  type TenderDetail,
  type TenderSummary,
} from '@sigma/api-contract';

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

function toSummary(t: TenderRow): TenderSummary {
  return {
    id: t.id,
    title: t.title,
    authorityName: t.authority_id,
    estimatedValue: t.estimated_value != null ? { amount: t.estimated_value, currency: 'BGN' } : null,
    status: t.status,
    riskScore: null,
    riskBand: null,
    publishedAt: t.published_at,
  };
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'sigma-api' });
    }

    if (url.pathname === '/api/tenders' && request.method === 'GET') {
      const rawLimit = Number(url.searchParams.get('limit') ?? '50');
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
      const rows = await listRecentTenders(env.DB, limit);
      const body: SearchTendersResponse = { results: rows.map(toSummary), cursor: null };
      return json(body);
    }

    const detailMatch = url.pathname.match(/^\/api\/tenders\/([^/]+)$/);
    if (detailMatch && request.method === 'GET') {
      const tender = await getTenderById(env.DB, decodeURIComponent(detailMatch[1]!));
      if (!tender) {
        return json({ error: 'not_found', message: 'Tender not found' }, { status: 404 });
      }
      const detail: TenderDetail = {
        ...toSummary(tender),
        cpvCode: tender.cpv_code,
        procedureType: tender.procedure_type,
        deadlineAt: tender.deadline_at,
        signals: null,
      };
      return json(detail);
    }

    return json({ error: 'not_found', message: 'Route not found' }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
