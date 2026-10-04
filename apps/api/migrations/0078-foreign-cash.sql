CREATE TABLE openerp.bank_foreign_cash_accounts (
  book_id text NOT NULL REFERENCES openerp.books(id),
  account_id text NOT NULL,
  native_currency text NOT NULL CHECK (native_currency ~ '^[A-Z]{3}$'),
  native_scale integer NOT NULL CHECK (native_scale BETWEEN 0 AND 6),
  opened_on date NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,account_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts(book_id,id)
);
CREATE TABLE openerp.bank_foreign_cash_reviews (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.bank_foreign_cash_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.bank_foreign_cash_reviews(book_id,id)
);
CREATE TABLE openerp.bank_foreign_cash_executions (
  book_id text NOT NULL,
  review_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,review_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.bank_foreign_cash_reviews(book_id,id)
);
CREATE TABLE openerp.bank_foreign_cash_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  account_id text NOT NULL,
  source_identity text NOT NULL,
  native_delta_minor numeric(38,0) NOT NULL,
  carrying_delta_minor numeric(38,0) NOT NULL,
  actual_on date NOT NULL,
  voucher_id text,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  UNIQUE (book_id,account_id,source_identity),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.bank_foreign_cash_accounts(book_id,account_id),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.bank_foreign_cash_reviews(book_id,id),
  FOREIGN KEY (book_id,voucher_id) REFERENCES openerp.vouchers(book_id,id)
);
CREATE TABLE openerp.bank_foreign_cash_obligation_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  item_id text NOT NULL,
  native_minor numeric(38,0) NOT NULL CHECK (native_minor > 0),
  carrying_minor numeric(38,0) NOT NULL CHECK (carrying_minor >= 0),
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,id),
  FOREIGN KEY (book_id,id) REFERENCES openerp.bank_foreign_cash_executions(book_id,review_id),
  FOREIGN KEY (book_id,item_id) REFERENCES openerp.commerce_fx_items(book_id,id)
);
CREATE TRIGGER immutable_bank_foreign_cash_accounts BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_accounts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_foreign_cash_reviews BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_reviews FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_foreign_cash_approvals BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_foreign_cash_executions BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_executions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_foreign_cash_effects BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_bank_foreign_cash_obligation_effects BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_obligation_effects FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.bank_foreign_cash_accounts,openerp.bank_foreign_cash_reviews,openerp.bank_foreign_cash_approvals,openerp.bank_foreign_cash_executions,openerp.bank_foreign_cash_effects,openerp.bank_foreign_cash_obligation_effects TO openerp_runtime;

CREATE TABLE openerp.bank_foreign_cash_native_consumptions (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  review_id text NOT NULL,
  account_id text NOT NULL,
  native_minor numeric(38,0) NOT NULL,
  voucher_id text,
  line_id text,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations(book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.bank_foreign_cash_executions(book_id,review_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.bank_foreign_cash_accounts(book_id,account_id),
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TRIGGER immutable_bank_foreign_cash_native_consumptions BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_native_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.bank_foreign_cash_native_consumptions TO openerp_runtime;
CREATE TABLE openerp.bank_foreign_cash_opening_lines (
  book_id text NOT NULL,
  account_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,voucher_id,line_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.bank_foreign_cash_accounts(book_id,account_id),
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TRIGGER immutable_bank_foreign_cash_opening_lines BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_opening_lines FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.bank_foreign_cash_opening_lines TO openerp_runtime;
CREATE TABLE openerp.bank_foreign_cash_book_consumptions (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  review_id text NOT NULL,
  account_id text NOT NULL,
  native_minor numeric(38,0) NOT NULL CHECK (native_minor > 0),
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,statement_id,row_ordinal) REFERENCES openerp.bank_observations(book_id,statement_id,row_ordinal),
  FOREIGN KEY (book_id,review_id) REFERENCES openerp.bank_foreign_cash_executions(book_id,review_id),
  FOREIGN KEY (book_id,account_id) REFERENCES openerp.accounts(book_id,id),
  FOREIGN KEY (book_id,voucher_id,line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TRIGGER immutable_bank_foreign_cash_book_consumptions BEFORE UPDATE OR DELETE ON openerp.bank_foreign_cash_book_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.bank_foreign_cash_book_consumptions TO openerp_runtime;
