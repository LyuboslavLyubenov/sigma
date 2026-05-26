import { streamAuthoritySitemap } from '@sigma/db';
import type { Route } from './+types/sitemap-authorities';

export function loader({ request, context }: Route.LoaderArgs) {
  return streamAuthoritySitemap(context.cloudflare.env.DB, new URL(request.url).origin);
}
