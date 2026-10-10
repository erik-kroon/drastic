-- ADR 0020 / PST-05. A standing mandate pre-authorizes one grantee to execute a
-- bounded class of supplier-invoice acceptances. Terms are immutable; revocation and
-- each consumption are separate append-only records. The application checks every
-- term and limit under the mandate row lock in the posting transaction.
CREATE TABLE openerp.posting_mandates (
  book_id text NOT NULL REFERENCES openerp.books(id),
  id text NOT NULL,
  grantor_id text NOT NULL REFERENCES openerp.actors(id),
  grantee_id text NOT NULL REFERENCES openerp.actors(id),
  family text NOT NULL CHECK (family = 'supplier_acceptance'),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  body jsonb NOT NULL CHECK (octet_length(body::text) <= 65536),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, id),
  CHECK (valid_until > valid_from),
  CHECK (grantor_id <> grantee_id)
);

-- Each named supplier at the exact revision the grantor reviewed.
CREATE TABLE openerp.posting_mandate_counterparties (
  book_id text NOT NULL,
  mandate_id text NOT NULL,
  counterparty_id text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY (book_id, mandate_id, counterparty_id),
  FOREIGN KEY (book_id, mandate_id) REFERENCES openerp.posting_mandates(book_id, id),
  FOREIGN KEY (book_id, counterparty_id, revision)
    REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision)
);

CREATE TABLE openerp.posting_mandate_revocations (
  book_id text NOT NULL,
  mandate_id text NOT NULL,
  actor_id text NOT NULL REFERENCES openerp.actors(id),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, mandate_id),
  FOREIGN KEY (book_id, mandate_id) REFERENCES openerp.posting_mandates(book_id, id)
);

-- One row per execution. The ordinal counts events; a review and an approval can
-- each be consumed once. Amounts are canonical positive minor-unit integers.
CREATE TABLE openerp.posting_mandate_consumptions (
  book_id text NOT NULL,
  mandate_id text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 1),
  review_id text NOT NULL,
  approval_id text NOT NULL,
  acceptance_id text NOT NULL,
  gross_minor text NOT NULL CHECK (gross_minor ~ '^[1-9][0-9]{0,37}$'),
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (book_id, mandate_id, ordinal),
  UNIQUE (book_id, review_id),
  UNIQUE (book_id, approval_id),
  FOREIGN KEY (book_id, mandate_id) REFERENCES openerp.posting_mandates(book_id, id),
  FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_acceptance_reviews(book_id, id),
  FOREIGN KEY (book_id, approval_id) REFERENCES openerp.supplier_acceptance_approvals(book_id, id),
  FOREIGN KEY (book_id, acceptance_id) REFERENCES openerp.supplier_acceptances(book_id, id)
);

CREATE TRIGGER immutable_posting_mandate BEFORE DELETE OR UPDATE ON openerp.posting_mandates FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_posting_mandate_counterparty BEFORE DELETE OR UPDATE ON openerp.posting_mandate_counterparties FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_posting_mandate_revocation BEFORE DELETE OR UPDATE ON openerp.posting_mandate_revocations FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_posting_mandate_consumption BEFORE DELETE OR UPDATE ON openerp.posting_mandate_consumptions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON openerp.posting_mandates, openerp.posting_mandate_counterparties,
  openerp.posting_mandate_revocations, openerp.posting_mandate_consumptions TO openerp_runtime;
-- Lock-only: execution and revocation serialize on the mandate row.
GRANT UPDATE (id) ON openerp.posting_mandates TO openerp_runtime;
