-- Sample data for local development. Idempotent (INSERT OR IGNORE).

INSERT OR IGNORE INTO authorities (id, name, bulstat, region) VALUES
  ('auth-sofia', 'Община София', '000696327', 'София-град'),
  ('auth-mrrb', 'Министерство на регионалното развитие', '831661388', 'София-град');

INSERT OR IGNORE INTO tenders
  (id, source_id, title, authority_id, cpv_code, estimated_value, currency, procedure_type, status, published_at, deadline_at)
VALUES
  ('demo-tender', 'AOP-2026-0001', 'Доставка на хранителни продукти за детски градини', 'auth-sofia', '15000000', 1200000, 'BGN', 'открита процедура', 'published', '2026-03-01', '2026-04-01'),
  ('t-build-01', 'AOP-2026-0002', 'Ремонт на общински път', 'auth-mrrb', '45000000', 3500000, 'BGN', 'открита процедура', 'evaluation', '2026-02-15', '2026-03-20');

INSERT OR IGNORE INTO bidders (id, name, bulstat) VALUES
  ('bidder-a', 'Алфа ЕООД', '111111111'),
  ('bidder-b', 'Бета АД', '222222222'),
  ('bidder-c', 'Гама ООД', '333333333');

INSERT OR IGNORE INTO bids
  (id, tender_id, lot_id, bidder_id, amount, currency, is_winner, submitted_at)
VALUES
  ('bid-1', 'demo-tender', NULL, 'bidder-a', 1180000, 'BGN', 1, '2026-03-25'),
  ('bid-2', 'demo-tender', NULL, 'bidder-b', 1195000, 'BGN', 0, '2026-03-26'),
  ('bid-3', 't-build-01', NULL, 'bidder-c', 3450000, 'BGN', 0, '2026-03-10');
