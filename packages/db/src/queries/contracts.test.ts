import { describe, expect, it } from 'vitest';
import { MASKED_NATURAL_PERSON_LABEL } from '@sigma/shared';
import { fakeD1 } from '@sigma/test-support';
import {
  getContractFacets,
  listContracts,
  normalizeContractSort,
  streamContractsCsv,
} from './contracts';

describe('normalizeContractSort', () => {
  it('passes known sort keys through', () => {
    expect(normalizeContractSort('date-asc')).toBe('date-asc');
    expect(normalizeContractSort('value-desc')).toBe('value-desc');
  });
  it('collapses unknown / missing / prototype keys to the default', () => {
    expect(normalizeContractSort(null)).toBe('value-desc');
    expect(normalizeContractSort('')).toBe('value-desc');
    expect(normalizeContractSort('../../etc')).toBe('value-desc');
    expect(normalizeContractSort('__proto__')).toBe('value-desc');
    expect(normalizeContractSort('toString')).toBe('value-desc');
  });
});

const contractRow = {
  id: 'c:1',
  subject: 'Subject',
  unp: 'UNP-1',
  cpv_code: '45000000',
  eu_funded: 0,
  authority_id: 'auth:123456786',
  authority_name: 'Authority',
  bidder_id: 'eik:111111113',
  bidder_name: 'Bidder',
  bidder_kind: 'company' as const,
  bidder_legal_form: 'ООД',
  procedure_type: 'Открита процедура',
  signed_at: '2024-01-01',
  bids_received: 3,
  amount_eur: 1000,
  sort_value: 1000,
};

// The three facet reads: the precomputed rollup, the CPV-division count, and the signed-year buckets.
const FACET_ROLLUP = 'FROM facet_counts';
const FACET_SECTORS = 'substr(t.cpv_code, 1, 2)';
const FACET_YEARS = 'GROUP BY key';

function fakeDb(): D1Database {
  // `1=0` is the guard the list query uses for an input it could not decode — the page it returns
  // must be empty, and the count that goes with it zero.
  return fakeD1([
    { when: '1=0', all: [] },
    { when: '1=0', first: { total: 0, eur: 0, suspect: 0 } },
    { when: 'FROM contracts c', all: [contractRow] },
    { when: 'FROM contracts c', first: { total: 1, eur: 1000, suspect: 0 } },
  ]).db;
}

describe('listContracts', () => {
  it('returns no rows for an undecodable bidder slug', async () => {
    const page = await listContracts(fakeDb(), { bidder: 'n%', pageSize: 10 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('falls back to the default sort instead of throwing (sort=toString)', async () => {
    await expect(
      listContracts(fakeDb(), { sort: 'toString' as never, pageSize: 10 }),
    ).resolves.toBeDefined();
  });

  it('ignores a reserved value-bucket key instead of a destructure TypeError (value=toString)', async () => {
    await expect(
      listContracts(fakeDb(), { valueBucket: 'toString', pageSize: 10 }),
    ).resolves.toBeDefined();
  });
});

describe('getContractFacets', () => {
  it('counts sectors from the same CPV division expression used by list filters', async () => {
    const fake = fakeD1([
      { when: FACET_ROLLUP, all: [] },
      { when: FACET_SECTORS, all: [{ division: '45', contracts: 7 }] },
      { when: FACET_YEARS, all: [] },
    ]);

    const facets = await getContractFacets(fake.db);

    expect(fake.sql.some((sql) => sql.includes('JOIN tenders t ON t.id = c.tender_id'))).toBe(true);
    expect(facets.sectors.find((sector) => sector.value === '45')?.count).toBe(7);
  });

  it('folds future signed-year buckets into unknown without hiding the rows', async () => {
    const currentYear = new Date().getUTCFullYear();
    const futureYear = String(currentYear + 3);
    const db = fakeD1([
      { when: FACET_ROLLUP, all: [] },
      { when: FACET_SECTORS, all: [] },
      {
        when: FACET_YEARS,
        all: [
          { key: String(currentYear), contracts: 4 },
          { key: futureYear, contracts: 1 },
          { key: 'unknown', contracts: 2 },
        ],
      },
    ]).db;

    const facets = await getContractFacets(db);

    expect(facets.years.find((year) => year.value === String(currentYear))?.count).toBe(4);
    expect(facets.years.find((year) => year.value === futureYear)).toBeUndefined();
    expect(facets.years.find((year) => year.value === 'unknown')).toMatchObject({
      label: 'Неизвестна',
      count: 3,
    });
  });
});

/**
 * Privacy-masking surface for the CSV export — see ADR-0002 in `docs/architecture.md`.
 * Each row of the export carries the bidder's `legal_form` so the streamer can decide whether
 * to mask `contractor` and `contractor_eik`. The shared `isNaturalPersonBidder` predicate is the
 * single source of truth; these tests pin the CSV-side behaviour.
 */
describe('streamContractsCsv masking', () => {
  function makeCsvRow(overrides: Record<string, unknown>) {
    return {
      id: 'c:1',
      rowid: 1,
      subject: 'Subject',
      unp: 'UNP-1',
      cpv_code: '45000000',
      eu_funded: 0,
      authority_id: 'auth:123456789',
      authority_name: 'Authority',
      authority_eik: '123456789',
      bidder_id: 'eik:111111111',
      bidder_name: 'Bidder',
      bidder_kind: 'company' as const,
      contractor_eik: '111111111',
      bidder_legal_form: 'ООД',
      procedure_type: 'Открита процедура',
      signed_at: '2024-01-01',
      bids_received: 3,
      amount_eur: 1000,
      ...overrides,
    };
  }

  function csvDb(rows: Record<string, unknown>[]): D1Database {
    return {
      prepare() {
        let calls = 0;
        return {
          bind() {
            return this;
          },
          async all<T>() {
            // First chunk returns the seeded rows (≤ CHUNK so the streamer closes after it).
            // Any subsequent pull is answered with an empty array so the stream ends cleanly.
            calls += 1;
            return { results: (calls === 1 ? rows : []) as T[] };
          },
          async first<T>() {
            return { total: rows.length, eur: 0, suspect: 0 } as T;
          },
        };
      },
    } as unknown as D1Database;
  }

  function parseCsv(text: string): string[][] {
    return text
      .replace(/^﻿/, '')
      .trim()
      .split('\n')
      .map((line) => line.split(','));
  }

  it('masks the contractor and clears contractor_eik when legal_form is a sole-trader form (ЕТ)', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:natural',
        rowid: 1,
        bidder_name: 'ЕТ НИКОЛАЙ КИРОВ',
        bidder_kind: 'company',
        bidder_legal_form: 'ЕТ',
        contractor_eik: '176011111',
      }),
      makeCsvRow({
        id: 'c:legal',
        rowid: 2,
        bidder_name: 'СОФАРМА ТРЕЙДИНГ',
        bidder_kind: 'company',
        bidder_legal_form: 'ООД',
        contractor_eik: '121817309',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    // The header carries the documented column order — kept as the contract the CSV consumer sees.
    expect(rows[0]).toEqual([
      'id',
      'unp',
      'subject',
      'authority',
      'authority_eik',
      'contractor',
      'contractor_eik',
      'kind',
      'sector_code',
      'procedure',
      'signed_at',
      'value_eur',
      'eu_funded',
      'bids_received',
    ]);

    const naturalRow = rows[1]!;
    expect(naturalRow[0]).toBe('natural'); // contractSlug strips the leading "c:"
    expect(naturalRow[5]).toBe(MASKED_NATURAL_PERSON_LABEL);
    expect(naturalRow[6]).toBe('');

    const legalRow = rows[2]!;
    expect(legalRow[0]).toBe('legal');
    expect(legalRow[5]).toBe('СОФАРМА ТРЕЙДИНГ');
    expect(legalRow[6]).toBe('121817309');
  });

  it('keeps every other column verbatim for both masked and unmasked rows', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:natural',
        rowid: 1,
        bidder_name: 'ЕТ НИКОЛАЙ КИРОВ',
        bidder_kind: 'company',
        bidder_legal_form: 'ЕТ',
        contractor_eik: '176011111',
        unp: 'UNP-NAT',
        subject: 'Natural subject',
      }),
      makeCsvRow({
        id: 'c:legal',
        rowid: 2,
        bidder_name: 'СОФАРМА ТРЕЙДИНГ',
        bidder_kind: 'company',
        bidder_legal_form: 'ООД',
        contractor_eik: '121817309',
        unp: 'UNP-LEG',
        subject: 'Legal subject',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    // Skip the masked columns (5 = contractor, 6 = contractor_eik). Every other column must be the
    // raw seeded value for both rows.
    const header = rows[0]!;
    const otherColumns = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13];
    for (const row of rows.slice(1)) {
      for (const col of otherColumns) {
        expect(row[col]!, `row "${row[0]}" column "${header[col]!}" must be defined`).toBeDefined();
      }
    }

    const naturalRow = rows.find((r) => r[0] === 'natural')!;
    expect(naturalRow[1]).toBe('UNP-NAT');
    expect(naturalRow[2]).toBe('Natural subject');
    expect(naturalRow[7]).toBe('company');

    const legalRow = rows.find((r) => r[0] === 'legal')!;
    expect(legalRow[1]).toBe('UNP-LEG');
    expect(legalRow[2]).toBe('Legal subject');
    expect(legalRow[7]).toBe('company');
  });

  it('masks via the leading-ЕТ name heuristic when legal_form is null', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:heuristic',
        rowid: 1,
        bidder_name: 'ЕТ ДРИФТ - НИКОЛАЙ КИРОВ',
        bidder_kind: 'company',
        bidder_legal_form: null,
        contractor_eik: '176011111',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    expect(rows[1]![5]).toBe(MASKED_NATURAL_PERSON_LABEL);
    expect(rows[1]![6]).toBe('');
  });

  it('preserves the kind column so downstream consumers can still distinguish companies from consortia', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:consortium',
        rowid: 1,
        bidder_name: 'A ООД; B ЕООД',
        bidder_kind: 'consortium',
        bidder_legal_form: 'ДЗЗД',
        contractor_eik: '999999999',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    // ДЗЗД + consortium: predicate returns false; `kind` still flags the consortium shape.
    expect(rows[1]![5]).toBe('A ООД и др.');
    expect(rows[1]![6]).toBe('999999999');
    expect(rows[1]![7]).toBe('consortium');
  });

  // Regression for PR #183 review T-006: `isNaturalPersonBidder`'s docstring delegates consortium
  // filtering to the caller, but `streamContractsCsv` invoked it WITHOUT a `bidder_kind ===
  // 'consortium'` guard. A consortium whose `bidder_name` starts with „ЕТ " (a lead member that is a
  // sole trader, e.g. „ЕТ Иван Петров; Строй ООД") or whose `legal_form` collides with a sole-trader
  // form was masked as a natural person — privacy-safe (over-masking) but a behavioral change that
  // drops the lead member's name + ЕИК and contradicts the predicate's contract. Consortium rows now
  // bypass the natural-person mask and keep the „… и др." shape from `entityName`.
  it('does not mask a consortium row whose lead member looks like a sole trader (ЕТ name / sole-trader legal_form)', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:et-led-consortium',
        rowid: 1,
        bidder_name: 'ЕТ Иван Петров; Строй ООД',
        bidder_kind: 'consortium',
        bidder_legal_form: 'ЕТ',
        contractor_eik: '201345678',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    expect(rows[1]![5]).toBe('ЕТ Иван Петров и др.');
    expect(rows[1]![6]).toBe('201345678');
    expect(rows[1]![7]).toBe('consortium');
  });

  it('does not mask a consortium row matched only by the leading-ЕТ name heuristic (legal_form null)', async () => {
    const db = csvDb([
      makeCsvRow({
        id: 'c:et-named-consortium',
        rowid: 1,
        bidder_name: 'ЕТ ДРИФТ - НИКОЛАЙ КИРОВ; Логистика АД',
        bidder_kind: 'consortium',
        bidder_legal_form: null,
        contractor_eik: '201345678',
      }),
    ]);

    const rows = parseCsv(await streamContractsCsv(db, {}).text());

    expect(rows[1]![5]).toBe('ЕТ ДРИФТ - НИКОЛАЙ КИРОВ и др.');
    expect(rows[1]![6]).toBe('201345678');
    expect(rows[1]![7]).toBe('consortium');
  });
});

describe('listContracts — privacy masking on the leaderboard list (PR #183 review #1)', () => {
  // Sole traders must read "Частно лице" on /contracts + /contracts.data (RRv7 single-fetch twin)
  // and on the home single-offer tables. The CSV streamer masks the same row upstream of bytes
  // hitting R2; maskContractForPrivacy covers /contracts/:id.json. The list path is the third
  // surface.
  const soleTraderRow = {
    id: 'c:et-1',
    subject: 'S',
    unp: 'UNP-et',
    cpv_code: '45000000',
    eu_funded: 0,
    authority_id: 'auth:1',
    authority_name: 'Authority',
    bidder_id: 'eik:121817309',
    bidder_name: 'ЕТ ДРИФТ - НИКОЛАЙ КИРОВ',
    bidder_kind: 'company' as const,
    bidder_legal_form: 'ЕТ',
    procedure_type: 'Открита процедура',
    signed_at: '2024-01-01',
    bids_received: 3,
    amount_eur: 1000,
    sort_value: 1000,
  };
  const legalEntityRow = { ...contractRow };
  const consortiumRow = {
    ...contractRow,
    bidder_name: 'ЕТ Иван Петров; Строй ООД',
    bidder_kind: 'consortium' as const,
    bidder_legal_form: null,
  };

  function dbFor(row: object | object[]): D1Database {
    const rows = Array.isArray(row) ? row : [row];
    return {
      prepare(_sql: string) {
        return {
          bind() {
            return this;
          },
          async all<T>() {
            return { results: rows as T[] };
          },
          async first<T>() {
            return { total: rows.length, eur: rows.length ? 1000 : 0, suspect: 0 } as T;
          },
        };
      },
    } as D1Database;
  }

  it('masks bidderName + bidderDisplayName for a sole trader (ЕТ, legal_form=ЕТ)', async () => {
    const page = await listContracts(dbFor(soleTraderRow), { pageSize: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.bidderName).toBe(MASKED_NATURAL_PERSON_LABEL);
    expect(page.items[0]!.bidderDisplayName).toBe(MASKED_NATURAL_PERSON_LABEL);
  });

  it('preserves the legal-entity name verbatim', async () => {
    const page = await listContracts(dbFor(legalEntityRow), { pageSize: 10 });
    expect(page.items[0]!.bidderName).toBe('Bidder');
    expect(page.items[0]!.bidderDisplayName).toBe('Bidder');
  });

  it('does NOT mask a consortium whose first member is a sole trader (MAJOR-class guard)', async () => {
    const page = await listContracts(dbFor(consortiumRow), { pageSize: 10 });
    expect(page.items[0]!.bidderName).toBe('ЕТ Иван Петров; Строй ООД');
    expect(page.items[0]!.bidderKind).toBe('consortium');
    expect(page.items[0]!.isConsortium).toBe(true);
  });

  it('replaces bidderSlug with the opaque `m<base64(bidder_id)>` token for a sole trader (lyubomir-bozhinov review 2026-09-02, thread on rows.ts:86)', async () => {
    // The `bidderSlug` is the second half of the masking: `companySlug('eik:<digits>')` returns the
    // ЕИК digits verbatim, so a masked eik-keyed row's slug would still carry the natural-person's
    // ЕИК into the `/contracts.data` machine-readable twin (RRv7 single-fetch turbo-stream) and the
    // HTML hydration payload of the public home single-offer tables — defeating the label mask.
    // `maskedCompanySlug(bidder_id)` is a one-way token: opaque, non-round-trippable via
    // `bidderIdFromSlug`, and stable across rebuilds (depends only on the bidder id). The mapper
    // wires it in here so /contracts.data + the home single-offer tables share the same invariant as
    // the leaderboard (`rows.ts:86`) and the home top-10 (`9308672`).
    const { bidderIdFromSlug } = await import('./identity');
    const page = await listContracts(dbFor(soleTraderRow), { pageSize: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    // Masked flag surfaces the privacy signal for downstream consumers (home.tsx, contracts.tsx
    // branches on `c.masked` to choose <span> vs <Link>). The flag is the single source-of-truth —
    // not a string compare on MASKED_NATURAL_PERSON_LABEL.
    expect(item.masked).toBe(true);
    // Slug is opaque: not round-trippable, no bare ЕИК.
    expect(item.bidderSlug.startsWith('m')).toBe(true);
    expect(bidderIdFromSlug(item.bidderSlug)).toBeNull();
    expect(item.bidderSlug).not.toContain('121817309');
    expect(item.bidderSlug).not.toMatch(/^\d{9}(\d{4})?$/);
  });

  it('keeps bidderSlug as the bare ЕИК for a legal entity (round-trippable, by design)', async () => {
    // The legal-entity branch is untouched: it returns `companySlug(r.bidder_id)` and the slug
    // is the bare ЕИК so `bidderIdFromSlug(slug)` round-trips. Consumers rely on this for
    // navigation — masked rows are the only ones that get the opaque form.
    const { bidderIdFromSlug } = await import('./identity');
    const page = await listContracts(dbFor(legalEntityRow), { pageSize: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.masked).toBe(false);
    expect(item.bidderSlug).toBe('111111113');
    expect(bidderIdFromSlug(item.bidderSlug)).toBe('eik:111111113');
  });

  it('keeps bidderSlug as the bare ЕИК for a consortium (round-trippable, by design)', async () => {
    // The consortium branch is also untouched — masking it would lose the „… и др." shape and the
    // consortium ЕИК. The guard `bidder_kind !== 'consortium'` in `toItem` keeps this branch
    // verbatim, even when the consortium lead member's name looks like a sole trader.
    const { bidderIdFromSlug } = await import('./identity');
    const page = await listContracts(dbFor(consortiumRow), { pageSize: 10 });
    expect(page.items).toHaveLength(1);
    const item = page.items[0]!;
    expect(item.masked).toBe(false);
    expect(item.bidderSlug).toBe('111111113');
    expect(bidderIdFromSlug(item.bidderSlug)).toBe('eik:111111113');
  });
});
