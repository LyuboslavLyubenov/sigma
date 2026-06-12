import { describe, expect, it } from 'vitest';
import {
  distinctSearchTitleParts,
  MAX_QUERY_CHARS,
  MAX_QUERY_TOKENS,
  search,
  searchMatchQuery,
  searchMoreHref,
} from './search';

function searchDb(): D1Database {
  const companyRows = Array.from({ length: 6 }, (_, i) => ({
    ref: `eik:11111111${i}`,
    title: `Company ${i}`,
    ident: `11111111${i}`,
    subtitle: null,
    amount: 1000 + i,
  }));
  const contractRows = Array.from({ length: 6 }, (_, i) => ({
    ref: `c:${i}`,
    title: `Contract ${i}`,
    ident: `UNP-${i}`,
    subtitle: null,
    amount: 1000 + i,
  }));

  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          bound = args;
          return this;
        },
        async all<T>() {
          if (sql.includes('COUNT(*) AS n')) {
            return {
              results: [
                { kind: 'company', n: 7 },
                { kind: 'contract', n: 6 },
              ] as T[],
            };
          }

          const kind = bound[0];
          if (kind === 'company') return { results: companyRows as T[] };
          if (kind === 'contract') return { results: contractRows as T[] };
          return { results: [] as T[] };
        },
      };
    },
  } as D1Database;
}

describe('search helpers', () => {
  it('splits and de-duplicates semicolon-joined title blobs', () => {
    expect(distinctSearchTitleParts('Алфа ООД; Бета АД; алфа оод ; ; Бета АД; Гама ЕООД')).toEqual([
      'Алфа ООД',
      'Бета АД',
      'Гама ЕООД',
    ]);
  });

  it('builds list hrefs with an encoded q filter', () => {
    const href = searchMoreHref('company', 'строителство София');
    const url = new URL(`https://sigma.test${href}`);

    expect(url.pathname).toBe('/companies');
    expect(url.searchParams.get('q')).toBe('строителство София');
  });

  it('caps over-long MATCH queries at the shared chokepoint', () => {
    const q = Array.from({ length: 32 }, (_, i) => `word${i}`).join(' ');
    expect(q.length).toBeGreaterThan(MAX_QUERY_CHARS);

    const match = searchMatchQuery(q);
    const terms = match?.split(' ') ?? [];

    expect(terms.length).toBeLessThanOrEqual(MAX_QUERY_TOKENS);
    expect(match?.length).toBeLessThanOrEqual(MAX_QUERY_CHARS + MAX_QUERY_TOKENS);
  });

  it('keeps normal short MATCH query behavior unchanged', () => {
    expect(searchMatchQuery('Стрoителствo София 123')).toBe('строителство* софия* 123*');
  });
});

describe('search', () => {
  it('sets moreHref only for truncated groups', async () => {
    const results = await search(searchDb(), 'строителство');
    const company = results.groups.find((g) => g.kind === 'company');
    const contract = results.groups.find((g) => g.kind === 'contract');
    const authority = results.groups.find((g) => g.kind === 'authority');

    expect(company?.moreHref).toBe(
      '/companies?q=%D1%81%D1%82%D1%80%D0%BE%D0%B8%D1%82%D0%B5%D0%BB%D1%81%D1%82%D0%B2%D0%BE',
    );
    expect(contract?.moreHref).toBeNull();
    expect(authority?.moreHref).toBeNull();
  });
});
