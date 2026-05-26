import { streamCompanySitemap } from '@sigma/db';
import type { Route } from './+types/sitemap-companies';

export function loader({ request, context }: Route.LoaderArgs) {
  return streamCompanySitemap(context.cloudflare.env.DB, new URL(request.url).origin);
}
