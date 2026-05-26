import { streamContractSitemap } from '@sigma/db';
import type { Route } from './+types/sitemap-contracts';

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('p') ?? '1') || 1);
  return streamContractSitemap(context.cloudflare.env.DB, url.origin, page);
}
