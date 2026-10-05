CREATE TABLE openerp.processor_accounts (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  provider_account_id text NOT NULL, live_mode boolean NOT NULL, currency text NOT NULL,
  processor_control_account_id text NOT NULL, payout_transit_account_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,id),
  UNIQUE (book_id,provider_account_id,live_mode,currency),
  UNIQUE (book_id,processor_control_account_id), UNIQUE (book_id,payout_transit_account_id),
  FOREIGN KEY (book_id,processor_control_account_id) REFERENCES openerp.accounts(book_id,id),
  FOREIGN KEY (book_id,payout_transit_account_id) REFERENCES openerp.accounts(book_id,id)
);
CREATE TABLE openerp.processor_fetch_requests (
  book_id text NOT NULL, command_key text NOT NULL, id text NOT NULL,
  account_id text NOT NULL, request_digest text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,command_key), UNIQUE (book_id,id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.processor_accounts(book_id,id)
);
CREATE TABLE openerp.processor_fetch_pages (
  book_id text NOT NULL, fetch_id text NOT NULL, cursor_key text NOT NULL,
  raw_source_ref text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,fetch_id,cursor_key),
  FOREIGN KEY (book_id,fetch_id) REFERENCES openerp.processor_fetch_requests(book_id,id),
  FOREIGN KEY (book_id,raw_source_ref) REFERENCES openerp.intake_occurrences(book_id,id)
);
CREATE TABLE openerp.processor_fetches (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), FOREIGN KEY (book_id,account_id) REFERENCES openerp.processor_accounts(book_id,id)
);
CREATE TABLE openerp.processor_observations (
  book_id text NOT NULL, id text NOT NULL, account_id text NOT NULL,
  balance_transaction_id text NOT NULL, semantic_digest text NOT NULL, body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,account_id,balance_transaction_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.processor_accounts(book_id,id)
);
CREATE TABLE openerp.processor_source_occurrences (
  book_id text NOT NULL, fetch_id text NOT NULL, observation_id text NOT NULL,
  raw_source_ref text NOT NULL, payout_membership_id text, body jsonb NOT NULL,
  PRIMARY KEY (book_id,fetch_id,observation_id),
  FOREIGN KEY (book_id,fetch_id) REFERENCES openerp.processor_fetches(book_id,id),
  FOREIGN KEY (book_id,observation_id) REFERENCES openerp.processor_observations(book_id,id),
  FOREIGN KEY (book_id,raw_source_ref) REFERENCES openerp.intake_occurrences(book_id,id)
);
CREATE TABLE openerp.processor_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id), source_identity text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.processor_approvals (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id), digest text NOT NULL,
  expires_at timestamptz NOT NULL, body jsonb NOT NULL, PRIMARY KEY (book_id,id), UNIQUE (book_id,id,review_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_reviews(book_id,id)
);
CREATE TABLE openerp.processor_executions (
  book_id text NOT NULL, review_id text NOT NULL, source_identity text NOT NULL,
  voucher_id text, observation_id text, body jsonb NOT NULL,
  PRIMARY KEY (book_id,review_id), UNIQUE (book_id,source_identity),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_reviews(book_id,id),
  FOREIGN KEY (book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id),
  FOREIGN KEY (book_id,observation_id) REFERENCES openerp.processor_observations(book_id,id)
);
ALTER TABLE openerp.commerce_allocation_approvals
  ADD COLUMN owner_kind text,
  ADD COLUMN owner_review_id text,
  ADD COLUMN owner_approval_id text,
  ADD CONSTRAINT processor_allocation_approval_owner CHECK (
    (owner_kind IS NULL AND owner_review_id IS NULL AND owner_approval_id IS NULL)
    OR (owner_kind = 'processor' AND owner_review_id IS NOT NULL AND owner_approval_id IS NOT NULL)
  ),
  ADD CONSTRAINT processor_allocation_approval_reference
    FOREIGN KEY (book_id,owner_approval_id,owner_review_id) REFERENCES openerp.processor_approvals(book_id,id,review_id);
CREATE TABLE openerp.processor_cash_effects (
  book_id text NOT NULL, id text NOT NULL, review_id text NOT NULL, account_id text NOT NULL,
  source_identity text NOT NULL, native_delta_minor numeric(38,0) NOT NULL,
  carrying_delta_minor numeric(38,0) NOT NULL, actual_on date NOT NULL, voucher_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,id), UNIQUE (book_id,account_id,source_identity),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_executions(book_id,review_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts(book_id,id),
  FOREIGN KEY (book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE TABLE openerp.processor_obligation_effects (
  book_id text NOT NULL, review_id text NOT NULL, item_id text NOT NULL,
  native_minor numeric(38,0) NOT NULL CHECK (native_minor > 0),
  carrying_minor numeric(38,0) NOT NULL CHECK (carrying_minor >= 0), body jsonb NOT NULL,
  PRIMARY KEY (book_id,review_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_executions(book_id,review_id),
  FOREIGN KEY (book_id,item_id) REFERENCES openerp.commerce_fx_items(book_id,id)
);
CREATE TABLE openerp.processor_payout_effects (
  book_id text NOT NULL, review_id text NOT NULL, payout_observation_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('movement','receipt','failure')),
  native_delta_minor numeric(38,0) NOT NULL, carrying_delta_minor numeric(38,0) NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,review_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_executions(book_id,review_id),
  FOREIGN KEY (book_id,payout_observation_id) REFERENCES openerp.processor_observations(book_id,id)
);
CREATE TABLE openerp.processor_dispute_effects (
  book_id text NOT NULL, review_id text NOT NULL, account_id text NOT NULL, provider_dispute_id text NOT NULL,
  native_delta_minor numeric(38,0) NOT NULL, carrying_delta_minor numeric(38,0) NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,review_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_executions(book_id,review_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.processor_accounts(book_id,id)
);
CREATE TABLE openerp.processor_bank_claims (
  book_id text NOT NULL, statement_id text NOT NULL, row_ordinal integer NOT NULL,
  review_id text NOT NULL, account_id text NOT NULL, native_minor numeric(38,0) NOT NULL CHECK (native_minor > 0),
  amount_minor numeric(38,0) NOT NULL CHECK (amount_minor > 0), voucher_id text NOT NULL, line_id text NOT NULL,
  body jsonb NOT NULL, PRIMARY KEY (book_id,statement_id,row_ordinal), UNIQUE (book_id,voucher_id,line_id),
  FOREIGN KEY (book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations(book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.processor_executions(book_id,review_id),
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TABLE openerp.processor_native_credit_origins (
  book_id text NOT NULL, origin_id text NOT NULL, account_id text NOT NULL,
  source_voucher_id text NOT NULL, source_line_id text NOT NULL,
  original_native_minor numeric(38,0) NOT NULL CHECK (original_native_minor > 0),
  original_carrying_minor numeric(38,0) NOT NULL CHECK (original_carrying_minor > 0),
  body jsonb NOT NULL, PRIMARY KEY (book_id,origin_id), UNIQUE (book_id,source_voucher_id,source_line_id),
  FOREIGN KEY (book_id,origin_id) REFERENCES openerp.customer_credit_origins(book_id,id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.processor_accounts(book_id,id),
  FOREIGN KEY (book_id,source_voucher_id,source_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TRIGGER immutable_processor_accounts BEFORE UPDATE OR DELETE ON openerp.processor_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_fetches BEFORE UPDATE OR DELETE ON openerp.processor_fetches FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_fetch_requests BEFORE UPDATE OR DELETE ON openerp.processor_fetch_requests FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_fetch_pages BEFORE UPDATE OR DELETE ON openerp.processor_fetch_pages FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_observations BEFORE UPDATE OR DELETE ON openerp.processor_observations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_source_occurrences BEFORE UPDATE OR DELETE ON openerp.processor_source_occurrences FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_reviews BEFORE UPDATE OR DELETE ON openerp.processor_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_approvals BEFORE UPDATE OR DELETE ON openerp.processor_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_executions BEFORE UPDATE OR DELETE ON openerp.processor_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_cash_effects BEFORE UPDATE OR DELETE ON openerp.processor_cash_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_obligation_effects BEFORE UPDATE OR DELETE ON openerp.processor_obligation_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_payout_effects BEFORE UPDATE OR DELETE ON openerp.processor_payout_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_dispute_effects BEFORE UPDATE OR DELETE ON openerp.processor_dispute_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_bank_claims BEFORE UPDATE OR DELETE ON openerp.processor_bank_claims FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_processor_native_credit_origins BEFORE UPDATE OR DELETE ON openerp.processor_native_credit_origins FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.processor_native_credit_origins TO openerp_runtime;
GRANT SELECT,INSERT ON openerp.processor_accounts,openerp.processor_fetch_requests,openerp.processor_fetch_pages,openerp.processor_fetches,openerp.processor_observations,openerp.processor_source_occurrences,openerp.processor_reviews,openerp.processor_approvals,openerp.processor_executions,openerp.processor_cash_effects,openerp.processor_obligation_effects,openerp.processor_payout_effects,openerp.processor_dispute_effects,openerp.processor_bank_claims TO openerp_runtime;
ALTER TABLE openerp.customer_credit_origins
  DROP CONSTRAINT customer_credit_origins_kind_check,
  ADD CONSTRAINT customer_credit_origins_kind_check
    CHECK (source_kind IN ('new_cash', 'adopted_clearing', 'native_processor_credit'));
