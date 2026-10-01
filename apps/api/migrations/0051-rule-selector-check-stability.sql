ALTER TABLE openerp.rule_change_notices
  DROP CONSTRAINT rule_change_notices_selectors_check,
  ADD CONSTRAINT rule_change_notices_selectors_check CHECK (
    cardinality(changed_selectors) >= 1
    AND cardinality(changed_selectors) <= 20
    AND array_position(changed_selectors, NULL) IS NULL
  );
