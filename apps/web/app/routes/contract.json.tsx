import { contractIdFromSlug, getContract } from '@sigma/db';
import type { Route } from './+types/contract.json';
import { publicCache } from '../lib/cache';

// Resource route: the assembled contract record as machine-readable JSON (/contracts/:id.json).
export async function loader({ params, context }: Route.LoaderArgs) {
  const id = (params.id ?? '').replace(/\.json$/, '');
  const record = await getContract(context.cloudflare.env.DB, contractIdFromSlug(id));
  if (!record) throw new Response('Not Found', { status: 404 });
  return Response.json(record, {
    headers: { 'Cache-Control': publicCache(3600) },
  });
}
