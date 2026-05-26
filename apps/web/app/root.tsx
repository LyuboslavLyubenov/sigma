import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router';

import type { Route } from './+types/root';
import { useNonce } from './nonce';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { PageHeader } from './components/PageHeader';
import './app.css';

// The editorial design uses a system serif/mono/sans stack (see app.css @theme) — no webfont request.
export const links: Route.LinksFunction = () => [];

// One cheap read for the chrome: the data current-as-of date shown in the footer on every page.
export async function loader({ context }: Route.LoaderArgs) {
  const row = await context.cloudflare.env.DB.prepare(
    'SELECT as_of FROM home_totals WHERE id = 1',
  ).first<{ as_of: string | null }>();
  return { asOf: row?.as_of ?? null };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const nonce = useNonce();
  return (
    <html lang="bg">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <a className="skip" href="#main">
        Към съдържанието
      </a>
      <SiteHeader />
      <Outlet />
      <SiteFooter asOf={loaderData.asOf} />
    </>
  );
}

// Errors render inside the chrome so a 404/500 still looks like Сигма and keeps the nav.
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const kicker = is404 ? 'Грешка 404' : 'Грешка';
  const title = is404 ? 'Страницата не е намерена' : 'Възникна грешка';
  const lede = is404
    ? 'Записът не съществува или адресът е променен. Започни от търсенето или от някой от списъците.'
    : 'Нещо се обърка при зареждането. Опитай отново или се върни към началото.';
  const stack = import.meta.env.DEV && error instanceof Error ? error.stack : undefined;

  return (
    <>
      <a className="skip" href="#main">
        Към съдържанието
      </a>
      <SiteHeader />
      <main id="main">
        <PageHeader kicker={kicker} title={title} lede={lede} />
        <p className="muted">
          <Link to="/">Начало</Link> · <Link to="/companies">Компании</Link> ·{' '}
          <Link to="/authorities">Институции</Link> · <Link to="/contracts">Договори</Link>
        </p>
        {stack && (
          <pre className="mono small" style={{ overflowX: 'auto', marginTop: 'var(--s-5)' }}>
            <code>{stack}</code>
          </pre>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
