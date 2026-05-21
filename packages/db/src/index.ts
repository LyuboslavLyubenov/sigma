export * from './schema';

import type { RiskScoreRow, TenderRow } from './schema';

export async function getTenderById(db: D1Database, id: string): Promise<TenderRow | null> {
  return db.prepare('SELECT * FROM tenders WHERE id = ?1').bind(id).first<TenderRow>();
}

export async function listRecentTenders(db: D1Database, limit = 50): Promise<TenderRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM tenders ORDER BY published_at DESC LIMIT ?1')
    .bind(limit)
    .all<TenderRow>();
  return results;
}

export async function upsertRiskScore(db: D1Database, row: RiskScoreRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO risk_scores (tender_id, score, band, signals, computed_at)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(tender_id) DO UPDATE SET
         score = excluded.score,
         band = excluded.band,
         signals = excluded.signals,
         computed_at = excluded.computed_at`,
    )
    .bind(row.tender_id, row.score, row.band, row.signals, row.computed_at)
    .run();
}
