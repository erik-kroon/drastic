-- NEXT-17: payable foreign-currency settlement with explicit fees.
-- Forward migration on the reviewed 0001-0003 baseline plus the 0004-0010 forward
-- migrations. The baseline is not renumbered, revived or rewritten.
--
-- The released WIP-FX02-P1 paired release stays the single original-units and
-- book-carrying capacity owner. This release only lets the same owner record a
-- payable direction, the evidenced gross book consideration and the fee and cash
-- source legs that the settlement journal actually posts. It adds no register, no
-- second balance and no calculation.
--
-- `commerce_fx_settlements` previously encoded the receivable convention
-- `realized_gain = consideration - carrying_released` in a body check. A payable
-- realises the opposite sign, so that one constraint is replaced by a
-- direction-aware equivalent that keeps both conventions exact. The two released
-- settlement profiles keep their original structural rules verbatim.
--
-- A settlement source is immutable history. A corrected settlement releases its
-- sources by the existence of that correction, not by a mutable flag, so the same
-- reviewed source identity can be consumed again after a correction without any
-- row being deleted or rewritten.

ALTER TABLE openerp.commerce_fx_items
  ADD COLUMN direction text NOT NULL DEFAULT 'customer';

ALTER TABLE openerp.commerce_fx_items
  ADD CONSTRAINT commerce_fx_items_direction_check CHECK (
    direction = ANY (ARRAY['customer'::text, 'supplier'::text])
    AND body ->> 'direction'::text = direction
  );

ALTER TABLE openerp.commerce_fx_settlements
  ADD COLUMN direction text NOT NULL DEFAULT 'customer',
  ADD COLUMN gross_book_minor openerp.minor_units,
  ADD COLUMN fee_total_minor openerp.minor_units,
  ADD COLUMN cash_source_minor numeric;

ALTER TABLE openerp.commerce_fx_settlements
  DROP CONSTRAINT commerce_fx_settlements_profile_check;

ALTER TABLE openerp.commerce_fx_settlements
  ADD CONSTRAINT commerce_fx_settlements_profile_check CHECK ((
    profile = 'synthetic_full_book_currency_settlement_v1'::text
    AND direction = 'customer'::text
    AND leg_ordinal = 1
    AND final_leg IS NULL
    AND original_remaining_before_minor IS NULL
    AND original_remaining_after_minor IS NULL
    AND carrying_remaining_before_minor IS NULL
    AND carrying_remaining_after_minor IS NULL
    AND gross_book_minor IS NULL
    AND fee_total_minor IS NULL
    AND cash_source_minor IS NULL
    OR profile = 'synthetic_partial_book_currency_settlement_v1'::text
    AND direction = 'customer'::text
    AND leg_ordinal > 0
    AND final_leg IS NOT NULL
    AND original_remaining_before_minor::numeric > 0::numeric
    AND original_released_minor::numeric > 0::numeric
    AND original_released_minor::numeric <= original_remaining_before_minor::numeric
    AND original_remaining_after_minor::numeric = original_remaining_before_minor::numeric - original_released_minor::numeric
    AND carrying_remaining_before_minor::numeric >= 0::numeric
    AND carrying_released_minor::numeric >= 0::numeric
    AND carrying_released_minor::numeric <= carrying_remaining_before_minor::numeric
    AND carrying_remaining_after_minor::numeric = carrying_remaining_before_minor::numeric - carrying_released_minor::numeric
    AND final_leg = (original_remaining_after_minor::numeric = 0::numeric)
    AND gross_book_minor IS NULL
    AND fee_total_minor IS NULL
    AND cash_source_minor IS NULL
    AND body ->> 'profile'::text = profile
    AND body ->> 'legOrdinal'::text = leg_ordinal::text
    AND body -> 'calculation'::text ->> 'originalRemainingBeforeMinor'::text = original_remaining_before_minor::text
    AND body -> 'calculation'::text ->> 'originalReleasedMinor'::text = original_released_minor::text
    AND body -> 'calculation'::text ->> 'originalRemainingAfterMinor'::text = original_remaining_after_minor::text
    AND body -> 'calculation'::text ->> 'carryingRemainingBeforeMinor'::text = carrying_remaining_before_minor::text
    AND body -> 'calculation'::text ->> 'carryingReleasedMinor'::text = carrying_released_minor::text
    AND body -> 'calculation'::text ->> 'carryingRemainingAfterMinor'::text = carrying_remaining_after_minor::text
    AND body -> 'calculation'::text ->> 'considerationMinor'::text = consideration_minor::text
    AND body -> 'calculation'::text ->> 'realizedGainMinor'::text = realized_gain_minor::text
    AND body -> 'calculation'::text ->> 'finalLeg'::text = final_leg::text
    OR profile = 'synthetic_book_currency_settlement_with_fees_v1'::text
    AND direction = ANY (ARRAY['customer'::text, 'supplier'::text])
    AND leg_ordinal > 0
    AND final_leg IS NOT NULL
    AND original_remaining_before_minor::numeric > 0::numeric
    AND original_released_minor::numeric > 0::numeric
    AND original_released_minor::numeric <= original_remaining_before_minor::numeric
    AND original_remaining_after_minor::numeric = original_remaining_before_minor::numeric - original_released_minor::numeric
    AND carrying_remaining_before_minor::numeric >= 0::numeric
    AND carrying_released_minor::numeric >= 0::numeric
    AND carrying_released_minor::numeric <= carrying_remaining_before_minor::numeric
    AND carrying_remaining_after_minor::numeric = carrying_remaining_before_minor::numeric - carrying_released_minor::numeric
    AND final_leg = (original_remaining_after_minor::numeric = 0::numeric)
    AND gross_book_minor IS NOT NULL
    AND gross_book_minor::numeric >= 0::numeric
    AND fee_total_minor IS NOT NULL
    AND fee_total_minor::numeric > 0::numeric
    AND cash_source_minor IS NOT NULL
    -- The signed cash is a receipt net of the withheld fee and a payment gross of
    -- the separately debited fee, so the supplier side carries the sign of the
    -- settlement's own cash equation rather than the unsigned fee convention.
    AND cash_source_minor::numeric = gross_book_minor::numeric + CASE
      WHEN direction = 'customer'::text THEN -fee_total_minor::numeric
      ELSE fee_total_minor::numeric
    END
    AND body ->> 'profile'::text = profile
    AND body -> 'calculation'::text ->> 'direction'::text = direction
    AND body -> 'calculation'::text ->> 'legOrdinal'::text = leg_ordinal::text
    AND body -> 'calculation'::text ->> 'originalRemainingBeforeMinor'::text = original_remaining_before_minor::text
    AND body -> 'calculation'::text ->> 'originalReleasedMinor'::text = original_released_minor::text
    AND body -> 'calculation'::text ->> 'originalRemainingAfterMinor'::text = original_remaining_after_minor::text
    AND body -> 'calculation'::text ->> 'carryingRemainingBeforeMinor'::text = carrying_remaining_before_minor::text
    AND body -> 'calculation'::text ->> 'carryingReleasedMinor'::text = carrying_released_minor::text
    AND body -> 'calculation'::text ->> 'carryingRemainingAfterMinor'::text = carrying_remaining_after_minor::text
    AND body -> 'calculation'::text ->> 'grossBookMinor'::text = gross_book_minor::text
    AND body -> 'calculation'::text ->> 'feeTotalMinor'::text = fee_total_minor::text
    AND body -> 'calculation'::text ->> 'signedCashMinor'::text = cash_source_minor::text
    AND body -> 'calculation'::text ->> 'finalLeg'::text = final_leg::text
  ) IS TRUE);

ALTER TABLE openerp.commerce_fx_settlements
  DROP CONSTRAINT commerce_fx_settlements_body_check;

ALTER TABLE openerp.commerce_fx_settlements
  ADD CONSTRAINT commerce_fx_settlements_body_check CHECK ((
    body ->> 'id'::text = id
    AND body -> 'scope'::text ->> 'bookId'::text = book_id
    AND body ->> 'itemId'::text = item_id
    AND body ->> 'reviewId'::text = review_id
    AND body ->> 'approvalId'::text = approval_id
    AND body -> 'postingReceipt'::text ->> 'id'::text = posting_receipt_id
    AND body -> 'postingReceipt'::text ->> 'voucherId'::text = voucher_id
    AND original_released_minor::numeric > 0::numeric
    AND consideration_minor::numeric > 0::numeric
    AND realized_gain_minor = CASE
      WHEN profile = 'synthetic_book_currency_settlement_with_fees_v1'::text
        AND direction = 'supplier'::text THEN carrying_released_minor::numeric - consideration_minor::numeric
      ELSE consideration_minor::numeric - carrying_released_minor::numeric
    END
    AND (
      profile = 'synthetic_full_book_currency_settlement_v1'::text
      AND body ->> 'originalReleasedMinor'::text = original_released_minor::text
      AND body ->> 'carryingReleasedMinor'::text = carrying_released_minor::text
      AND body ->> 'considerationMinor'::text = consideration_minor::text
      AND body ->> 'realizedGainMinor'::text = realized_gain_minor::text
      OR profile = 'synthetic_partial_book_currency_settlement_v1'::text
      OR profile = 'synthetic_book_currency_settlement_with_fees_v1'::text
        AND body -> 'calculation'::text ->> 'grossBookMinor'::text = consideration_minor::text
        AND body -> 'calculation'::text ->> 'realizedGainMinor'::text = realized_gain_minor::text
    )
    AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text)
  ) IS TRUE);

-- The realized-fee convention. A customer receipt nets the fee against the
-- consideration; a supplier payment adds it. Both are structural, not calculated
-- here: the exact sign lives in the sealed calculation the application compiled.
CREATE TABLE openerp.commerce_fx_settlement_sources (
  book_id text NOT NULL,
  id text NOT NULL,
  settlement_id text NOT NULL,
  ordinal integer NOT NULL,
  source_kind text NOT NULL,
  source_identity text COLLATE "C" NOT NULL,
  account_id text NOT NULL,
  journal_line_id text NOT NULL,
  signed_book_minor numeric NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_sources_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_sources_settlement_ordinal_key UNIQUE (book_id, settlement_id, ordinal),
  CONSTRAINT commerce_fx_settlement_sources_settlement_identity_key UNIQUE (book_id, settlement_id, source_identity),
  CONSTRAINT commerce_fx_settlement_sources_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT commerce_fx_settlement_sources_kind_check CHECK (source_kind = ANY (ARRAY['fee'::text, 'cash_source'::text])),
  CONSTRAINT commerce_fx_settlement_sources_identity_check CHECK (source_identity ~ '^[A-Za-z0-9._:-]{1,128}$'::text),
  CONSTRAINT commerce_fx_settlement_sources_amount_check CHECK (
    (source_kind = 'fee'::text AND signed_book_minor > 0::numeric)
    OR (source_kind = 'cash_source'::text AND signed_book_minor <> 0::numeric)
  ),
  CONSTRAINT commerce_fx_settlement_sources_body_check CHECK (
    body ->> 'id'::text = id
    AND body -> 'scope'::text ->> 'bookId'::text = book_id
    AND body ->> 'settlementId'::text = settlement_id
    AND body ->> 'ordinal'::text = ordinal::text
    AND body ->> 'kind'::text = source_kind
    AND body ->> 'sourceIdentity'::text = source_identity
    AND body ->> 'accountId'::text = account_id
    AND body ->> 'journalLineId'::text = journal_line_id
    AND body ->> 'signedBookMinor'::text = signed_book_minor::text
    AND body ->> 'evidenceId'::text = evidence_id
    AND body ->> 'digest'::text = openerp.digest(body - 'digest'::text)
    AND octet_length(body::text) <= 65536
  ),
  CONSTRAINT commerce_fx_settlement_sources_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT commerce_fx_settlement_sources_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_fx_settlement_sources_book_id_settlement_id_fkey FOREIGN KEY (book_id, settlement_id) REFERENCES openerp.commerce_fx_settlements(book_id, id)
);

CREATE INDEX commerce_fx_settlement_source_identity
  ON openerp.commerce_fx_settlement_sources (book_id, source_identity);

-- Immutable history. The guard function is the one 0001-0003 already reviewed;
-- this migration declares no function.
CREATE TRIGGER immutable_commerce_fx_settlement_source
  BEFORE DELETE OR UPDATE ON openerp.commerce_fx_settlement_sources
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role already holds table-level SELECT and INSERT on both commerce FX
-- tables from the reviewed 0003 baseline, so the new columns need no new grant. This
-- release adds exactly one table.
GRANT SELECT, INSERT ON TABLE openerp.commerce_fx_settlement_sources TO openerp_runtime;
