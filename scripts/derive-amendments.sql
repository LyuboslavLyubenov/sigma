-- Sigma — roll raw_egov_amendments up onto raw_egov_contracts.
-- Run AFTER scripts/load-admin.mjs (admin amendments) and scripts/load-ocds.mjs (OCDS amendments).
-- Re-runnable: resets the rollup, then matches amendments by (unp, contract_number).
-- current_value = the after-value of the LATEST amendment; annex_count = how many.
-- Contracts without amendments keep annex_count = 0 and current_value = NULL (the
-- convention downstream is COALESCE(current_value, signing_value)).

UPDATE raw_egov_contracts SET annex_count = 0, current_value = NULL;

UPDATE raw_egov_contracts
SET
  annex_count = (
    SELECT COUNT(*) FROM raw_egov_amendments a
    WHERE a.unp = raw_egov_contracts.unp
      AND a.contract_number = raw_egov_contracts.contract_number
  ),
  current_value = (
    SELECT a.value_after FROM raw_egov_amendments a
    WHERE a.unp = raw_egov_contracts.unp
      AND a.contract_number = raw_egov_contracts.contract_number
      AND a.value_after IS NOT NULL
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT 1
  )
WHERE EXISTS (
  SELECT 1 FROM raw_egov_amendments a
  WHERE a.unp = raw_egov_contracts.unp
    AND a.contract_number = raw_egov_contracts.contract_number
);

-- Summary (printed by wrangler)
SELECT
  (SELECT COUNT(*) FROM raw_egov_amendments)                              AS amendments,
  (SELECT COUNT(*) FROM raw_egov_contracts WHERE annex_count > 0)         AS contracts_amended,
  (SELECT COUNT(*) FROM raw_egov_contracts WHERE current_value IS NOT NULL) AS with_current_value,
  (SELECT COUNT(*) FROM raw_egov_contracts
     WHERE current_value IS NOT NULL AND current_value > signing_value)   AS grew_in_value;
