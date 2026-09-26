-- NEXT-04: actual domestic VAT return and independent control reconciliation.
-- Forward migration on the reviewed 0001-0003 baseline plus 0004-next-02.sql
-- (rule_releases) and 0006-next-03.sql (purchase_tax_facts). The baseline is not
-- renumbered or revived.
--
-- A sealed actual return is a read-only calculation artifact. The application
-- owns the qualified release selection, the fact and control capture, the
-- exact/report/residual arithmetic, the contribution provenance and the control
-- rollforward; these tables only hold the sealed header, the retained box
-- totals, the retained contribution and exclusion membership, the control
-- reconciliation rows and the retained source coverage members, so a later
-- posting cannot change what a captured return already means. There is no
-- function, no policy, no rate table and no report calculation here.
--
-- Rate, box, filing unit, period and coverage are qualified inputs. A missing
-- one is a refusal, never a default, and none of them is stored as a policy in
-- this file: the release and the reviewed facts own them.

CREATE TABLE openerp.vat_actual_returns (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal integer NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  basis_digest text NOT NULL,
  basis_engine text NOT NULL,
  rule_release_id text NOT NULL,
  rule_release_checksum text NOT NULL,
  period_fact_revision_id text NOT NULL,
  filing_ready boolean NOT NULL,
  controls_reconciled boolean NOT NULL,
  coverage_complete boolean NOT NULL,
  calculation_supported boolean NOT NULL,
  exact_net_minor numeric NOT NULL,
  reported_net_minor numeric NOT NULL,
  residual_net_minor numeric NOT NULL,
  ledger_boundary bigint NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT vat_actual_returns_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_actual_returns_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT vat_actual_returns_period_check CHECK (starts_on <= ends_on),
  CONSTRAINT vat_actual_returns_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 500),
  CONSTRAINT vat_actual_returns_engine_check CHECK (basis_engine = 'vat-actual-return-v1'::text),
  CONSTRAINT vat_actual_returns_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT vat_actual_returns_body_check CHECK (octet_length(body::text) <= 4194304),
  CONSTRAINT vat_actual_returns_identity_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_actual_returns_scope_check CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_actual_returns_period_body_check CHECK (
    NOT body -> 'input'::jsonb ->> 'startsOn'::text IS DISTINCT FROM starts_on::text
    AND NOT body -> 'input'::jsonb ->> 'endsOn'::text IS DISTINCT FROM ends_on::text),
  -- A calculation artifact never carries a filing outcome. Only a released
  -- filing owner may write one, and it is not this packet.
  CONSTRAINT vat_actual_returns_external_state_check CHECK (
    body ->> 'externalState'::text = 'not_submitted'::text
    AND jsonb_typeof(body -> 'assessedMinor'::text) = 'null'::text
    AND body ->> 'paymentState'::text = 'not_paid'::text),
  CONSTRAINT vat_actual_returns_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_actual_returns_rule_release_fkey FOREIGN KEY (rule_release_id) REFERENCES openerp.rule_releases(id)
);

CREATE TABLE openerp.vat_actual_return_boxes (
  book_id text NOT NULL,
  return_id text NOT NULL,
  box text NOT NULL,
  kind text NOT NULL,
  exact_minor numeric NOT NULL,
  reported_minor numeric NOT NULL,
  residual_minor numeric NOT NULL,
  CONSTRAINT vat_actual_return_boxes_pkey PRIMARY KEY (book_id, return_id, box),
  CONSTRAINT vat_actual_return_boxes_box_check CHECK (box = ANY (ARRAY['05'::text, '10'::text, '11'::text, '12'::text, '48'::text, '49'::text])),
  CONSTRAINT vat_actual_return_boxes_kind_check CHECK (kind = ANY (ARRAY['primitive'::text, 'net'::text])),
  CONSTRAINT vat_actual_return_boxes_bounds_check CHECK (
    abs(exact_minor) < 1e38 AND abs(reported_minor) < 1e38 AND abs(residual_minor) < 1e38),
  CONSTRAINT vat_actual_return_boxes_net_check CHECK ((box = '49'::text) = (kind = 'net'::text)),
  CONSTRAINT vat_actual_return_boxes_return_fkey FOREIGN KEY (book_id, return_id)
    REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE TABLE openerp.vat_actual_return_contributions (
  book_id text NOT NULL,
  return_id text NOT NULL,
  ordinal integer NOT NULL,
  fact_id text NOT NULL,
  origin text NOT NULL,
  mapping_rule_id text NOT NULL,
  rate_id text NOT NULL,
  box text NOT NULL,
  signed_minor numeric NOT NULL,
  basis_minor numeric NOT NULL,
  tax_minor numeric NOT NULL,
  revision_id text NOT NULL,
  fact_digest text NOT NULL,
  CONSTRAINT vat_actual_return_contributions_pkey PRIMARY KEY (book_id, return_id, ordinal),
  CONSTRAINT vat_actual_return_contributions_fact_box_key UNIQUE (book_id, return_id, fact_id, box),
  CONSTRAINT vat_actual_return_contributions_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 1000),
  CONSTRAINT vat_actual_return_contributions_origin_check CHECK (
    origin = ANY (ARRAY['manual_admission'::text, 'owned_purchase_recognition'::text])),
  -- A contribution is a primitive box only. The net box is derived, never a
  -- member.
  CONSTRAINT vat_actual_return_contributions_box_check CHECK (box = ANY (ARRAY['05'::text, '10'::text, '11'::text, '12'::text, '48'::text])),
  CONSTRAINT vat_actual_return_contributions_bounds_check CHECK (
    abs(signed_minor) < 1e38 AND abs(basis_minor) < 1e38 AND abs(tax_minor) < 1e38),
  CONSTRAINT vat_actual_return_contributions_return_fkey FOREIGN KEY (book_id, return_id)
    REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE TABLE openerp.vat_actual_return_exclusions (
  book_id text NOT NULL,
  return_id text NOT NULL,
  ordinal integer NOT NULL,
  fact_id text NOT NULL,
  origin text NOT NULL,
  revision_id text NOT NULL,
  reason text NOT NULL,
  detail text NOT NULL,
  CONSTRAINT vat_actual_return_exclusions_pkey PRIMARY KEY (book_id, return_id, ordinal),
  CONSTRAINT vat_actual_return_exclusions_fact_key UNIQUE (book_id, return_id, fact_id),
  CONSTRAINT vat_actual_return_exclusions_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 1000),
  CONSTRAINT vat_actual_return_exclusions_reason_check CHECK (reason = ANY (ARRAY[
    'synthetic_record_class'::text, 'unsupported_treatment'::text, 'unmapped_treatment'::text,
    'rate_absent_from_release'::text, 'published_tax_not_the_qualified_rate'::text,
    'basis_box_absent_from_release'::text,
    'withdrawn_fact'::text, 'duplicate_source_component'::text, 'unlinked_control_component'::text,
    'voucher_reversed'::text, 'voucher_outside_ledger_boundary'::text, 'rule_release_mismatch'::text])),
  CONSTRAINT vat_actual_return_exclusions_return_fkey FOREIGN KEY (book_id, return_id)
    REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE TABLE openerp.vat_actual_return_controls (
  book_id text NOT NULL,
  return_id text NOT NULL,
  account_id text NOT NULL,
  role text NOT NULL,
  reviewed_opening_minor numeric NOT NULL,
  expected_closing_minor numeric NOT NULL,
  frozen_gl_closing_minor numeric NOT NULL,
  difference_minor numeric NOT NULL,
  reconciled boolean NOT NULL,
  CONSTRAINT vat_actual_return_controls_pkey PRIMARY KEY (book_id, return_id, account_id),
  CONSTRAINT vat_actual_return_controls_role_check CHECK (
    role = ANY (ARRAY['output_vat_control'::text, 'input_vat_control'::text, 'vat_settlement_control'::text])),
  -- Deliberately no row check ties `reconciled` to `difference_minor`. Two
  -- opposite unexplained rows net to zero and still block, so a reconciled
  -- control is an application decision over both the rows and the amount, not
  -- an arithmetic fact the narrow integrity layer may restate.
  CONSTRAINT vat_actual_return_controls_bounds_check CHECK (
    abs(reviewed_opening_minor) < 1e38 AND abs(expected_closing_minor) < 1e38
    AND abs(frozen_gl_closing_minor) < 1e38 AND abs(difference_minor) < 1e38),
  CONSTRAINT vat_actual_return_controls_account_fkey FOREIGN KEY (book_id, account_id)
    REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT vat_actual_return_controls_return_fkey FOREIGN KEY (book_id, return_id)
    REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE TABLE openerp.vat_actual_return_control_rows (
  book_id text NOT NULL,
  return_id text NOT NULL,
  account_id text NOT NULL,
  ordinal integer NOT NULL,
  state text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  posting_date date NOT NULL,
  signed_minor numeric NOT NULL,
  CONSTRAINT vat_actual_return_control_rows_pkey PRIMARY KEY (book_id, return_id, account_id, ordinal),
  CONSTRAINT vat_actual_return_control_rows_row_key UNIQUE (book_id, return_id, account_id, voucher_id, line_id),
  CONSTRAINT vat_actual_return_control_rows_state_check CHECK (state = ANY (ARRAY['unexplained'::text, 'missing'::text])),
  CONSTRAINT vat_actual_return_control_rows_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 1000),
  CONSTRAINT vat_actual_return_control_rows_bounds_check CHECK (abs(signed_minor) < 1e38),
  CONSTRAINT vat_actual_return_control_rows_control_fkey FOREIGN KEY (book_id, return_id, account_id)
    REFERENCES openerp.vat_actual_return_controls(book_id, return_id, account_id)
);

CREATE TABLE openerp.vat_actual_return_coverage (
  book_id text NOT NULL,
  return_id text NOT NULL,
  family text NOT NULL,
  state text NOT NULL,
  evidence_id text,
  evidence_sha256 text,
  CONSTRAINT vat_actual_return_coverage_pkey PRIMARY KEY (book_id, return_id, family),
  CONSTRAINT vat_actual_return_coverage_state_check CHECK (state = ANY (ARRAY['current'::text, 'unavailable'::text, 'unknown'::text])),
  CONSTRAINT vat_actual_return_coverage_evidence_check CHECK ((evidence_id IS NULL) = (evidence_sha256 IS NULL)),
  -- Independent coverage evidence is what "current" means. It is never implied.
  CONSTRAINT vat_actual_return_coverage_current_check CHECK (state <> 'current'::text OR evidence_id IS NOT NULL),
  CONSTRAINT vat_actual_return_coverage_evidence_fkey FOREIGN KEY (book_id, evidence_id)
    REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT vat_actual_return_coverage_return_fkey FOREIGN KEY (book_id, return_id)
    REFERENCES openerp.vat_actual_returns(book_id, id)
);

CREATE INDEX vat_actual_returns_scan ON openerp.vat_actual_returns (book_id, ordinal desc);
CREATE INDEX vat_actual_returns_period ON openerp.vat_actual_returns (book_id, starts_on, ends_on);
CREATE INDEX vat_actual_return_contributions_fact
  ON openerp.vat_actual_return_contributions (book_id, return_id, fact_id);
CREATE INDEX vat_actual_return_control_rows_account
  ON openerp.vat_actual_return_control_rows (book_id, return_id, account_id, state);

-- A sealed return is history. Later activity, a correction or a released owner
-- effect creates a new return; it never rewrites what a captured one means.
CREATE TRIGGER immutable_vat_actual_return
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_returns
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_box
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_boxes
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_contribution
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_contributions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_exclusion
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_exclusions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_control
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_controls
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_control_row
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_control_rows
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_vat_actual_return_coverage
  BEFORE DELETE OR UPDATE ON openerp.vat_actual_return_coverage
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON TABLE openerp.vat_actual_returns,
  openerp.vat_actual_return_boxes, openerp.vat_actual_return_contributions,
  openerp.vat_actual_return_exclusions, openerp.vat_actual_return_controls,
  openerp.vat_actual_return_control_rows, openerp.vat_actual_return_coverage
  TO openerp_runtime;
