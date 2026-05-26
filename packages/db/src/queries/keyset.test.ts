import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, keyset, pageCursors } from './keyset';

describe('cursor encode/decode', () => {
  it('round-trips a [value, id] pair', () => {
    const c = encodeCursor('after', 50_840_000_000, 'eik:103267194');
    const d = decodeCursor(c);
    expect(d).toEqual({ dir: 'after', value: 50_840_000_000, id: 'eik:103267194' });
  });
  it('rejects malformed cursors', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('garbage')).toBeNull();
    expect(decodeCursor('sideways:Zm9v')).toBeNull();
  });
});

describe('keyset clause', () => {
  it('orders desc with no cursor', () => {
    const k = keyset({ sortCol: 'won_eur', idCol: 'bidder_id', dir: 'desc' });
    expect(k.whereSql).toBe('');
    expect(k.orderSql).toBe('ORDER BY won_eur DESC, bidder_id DESC');
    expect(k.reverse).toBe(false);
  });
  it('builds a forward (after) predicate keeping the natural direction', () => {
    const cursor = encodeCursor('after', 1000, 'x');
    const k = keyset({ sortCol: 'won_eur', idCol: 'bidder_id', dir: 'desc', cursor });
    expect(k.whereSql).toContain('won_eur < ?');
    expect(k.orderSql).toContain('DESC');
    expect(k.params).toEqual([1000, 1000, 'x']);
    expect(k.reverse).toBe(false);
  });
  it('inverts direction for a backward (before) cursor and flags reverse', () => {
    const cursor = encodeCursor('before', 1000, 'x');
    const k = keyset({ sortCol: 'won_eur', idCol: 'bidder_id', dir: 'desc', cursor });
    expect(k.whereSql).toContain('won_eur > ?');
    expect(k.orderSql).toBe('ORDER BY won_eur ASC, bidder_id ASC');
    expect(k.reverse).toBe(true);
  });
});

describe('pageCursors', () => {
  const rows = [
    { sortValue: 900, id: 'a' },
    { sortValue: 800, id: 'b' },
  ];
  it('first page: no prev, next when more', () => {
    const { prevCursor, nextCursor } = pageCursors({ rows, hasMore: true, incomingCursor: null });
    expect(prevCursor).toBeNull();
    expect(decodeCursor(nextCursor)).toMatchObject({ dir: 'after', value: 800, id: 'b' });
  });
  it('later page: prev anchors before the first row, no next on last page', () => {
    const incoming = encodeCursor('after', 1000, 'z');
    const { prevCursor, nextCursor } = pageCursors({
      rows,
      hasMore: false,
      incomingCursor: incoming,
    });
    expect(decodeCursor(prevCursor)).toMatchObject({ dir: 'before', value: 900, id: 'a' });
    expect(nextCursor).toBeNull();
  });
});
