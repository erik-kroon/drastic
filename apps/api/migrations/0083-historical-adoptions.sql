CREATE TABLE openerp.historical_control_pools (
  book_id text NOT NULL,id text NOT NULL,admission_id text NOT NULL,source_account text NOT NULL,control_account_id text NOT NULL,cutover_on date NOT NULL,direction text NOT NULL CHECK(direction IN('AR','AP')),
  digest text NOT NULL,body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  PRIMARY KEY(book_id,id),UNIQUE(book_id,admission_id,source_account,direction),UNIQUE(book_id,control_account_id,direction),
  FOREIGN KEY(book_id,control_account_id) REFERENCES openerp.accounts(book_id,id),
  FOREIGN KEY(book_id,admission_id) REFERENCES openerp.historical_item_admissions(book_id,id),
  CHECK(body->>'id'=id AND body->>'digest'=digest)
);
CREATE TABLE openerp.historical_adoption_plans (
  book_id text NOT NULL,id text NOT NULL,pool_id text NOT NULL,digest text NOT NULL,body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
  PRIMARY KEY(book_id,id),FOREIGN KEY(book_id,pool_id) REFERENCES openerp.historical_control_pools(book_id,id),
  CHECK(body->>'id'=id AND body->>'digest'=digest)
);
CREATE TABLE openerp.historical_adoption_approvals (
  book_id text NOT NULL,id text NOT NULL,plan_id text NOT NULL,actor_id text NOT NULL,expires_at timestamptz NOT NULL,body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),FOREIGN KEY(book_id,plan_id) REFERENCES openerp.historical_adoption_plans(book_id,id)
);
CREATE TABLE openerp.historical_adoptions (
  book_id text NOT NULL,id text NOT NULL,plan_id text NOT NULL,pool_id text NOT NULL,source_plan_id text NOT NULL,source_system text NOT NULL,source_identity text NOT NULL,approval_id text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),UNIQUE(book_id,plan_id),UNIQUE(book_id,source_system,source_identity),UNIQUE(book_id,approval_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.historical_adoption_plans(book_id,id),
  FOREIGN KEY(book_id,pool_id) REFERENCES openerp.historical_control_pools(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.historical_adoption_approvals(book_id,id)
);
CREATE TABLE openerp.commerce_historical_settlement_plans (
  book_id text NOT NULL,id text NOT NULL,adoption_id text NOT NULL,digest text NOT NULL,body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),FOREIGN KEY(book_id,adoption_id) REFERENCES openerp.historical_adoptions(book_id,id),
  CHECK(body->>'id'=id AND body->>'digest'=digest)
);
CREATE TABLE openerp.commerce_historical_settlement_approvals (
  book_id text NOT NULL,id text NOT NULL,plan_id text NOT NULL,actor_id text NOT NULL,expires_at timestamptz NOT NULL,body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),FOREIGN KEY(book_id,plan_id) REFERENCES openerp.commerce_historical_settlement_plans(book_id,id)
);
CREATE TABLE openerp.commerce_historical_settlements (
  book_id text NOT NULL,id text NOT NULL,plan_id text NOT NULL,adoption_id text NOT NULL,approval_id text NOT NULL,payment_voucher_id text NOT NULL,payment_line_id text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),UNIQUE(book_id,plan_id),UNIQUE(book_id,approval_id),
  FOREIGN KEY(book_id,plan_id) REFERENCES openerp.commerce_historical_settlement_plans(book_id,id),
  FOREIGN KEY(book_id,adoption_id) REFERENCES openerp.historical_adoptions(book_id,id),
  FOREIGN KEY(book_id,approval_id) REFERENCES openerp.commerce_historical_settlement_approvals(book_id,id),
  FOREIGN KEY(book_id,payment_voucher_id,payment_line_id) REFERENCES openerp.journal_lines(book_id,voucher_id,id)
);
CREATE TRIGGER immutable_historical_pool BEFORE UPDATE OR DELETE ON openerp.historical_control_pools FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_adoption_plan BEFORE UPDATE OR DELETE ON openerp.historical_adoption_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_adoption_approval BEFORE UPDATE OR DELETE ON openerp.historical_adoption_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_adoption BEFORE UPDATE OR DELETE ON openerp.historical_adoptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_settlement_plan BEFORE UPDATE OR DELETE ON openerp.commerce_historical_settlement_plans FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_settlement_approval BEFORE UPDATE OR DELETE ON openerp.commerce_historical_settlement_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_historical_settlement BEFORE UPDATE OR DELETE ON openerp.commerce_historical_settlements FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.historical_control_pools,openerp.historical_adoption_plans,openerp.historical_adoption_approvals,openerp.historical_adoptions,openerp.commerce_historical_settlement_plans,openerp.commerce_historical_settlement_approvals,openerp.commerce_historical_settlements TO openerp_runtime;
