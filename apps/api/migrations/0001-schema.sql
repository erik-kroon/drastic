-- Clean database baseline: the final OpenERP schema.
--
-- The application process owns accounting policy, authorization, calculations and
-- scoped writes, so this file carries structure only: no functions, no triggers and
-- no executable policy. The narrow integrity layer lives in 0002-integrity.sql and
-- the runtime role's privileges in 0003-roles.sql.

CREATE SCHEMA openerp;
REVOKE ALL ON SCHEMA openerp FROM PUBLIC;

CREATE SCHEMA openerp_auth;
REVOKE ALL ON SCHEMA openerp_auth FROM PUBLIC;

-- Exact money is held in minor units: whole, non-negative and short of the numeric
-- ceiling, so no rounding ever lands inside a stored amount.
CREATE DOMAIN openerp.minor_units AS numeric
  CHECK (VALUE = trunc(VALUE) AND VALUE >= 0 AND VALUE < 1e38::numeric);

-- The accounting schema. Tables are created so every referenced table exists first;
-- the foreign keys that cannot be declared inline follow once the whole schema is in
-- place.
CREATE TABLE openerp.entities (
  id text NOT NULL,
  name text NOT NULL,
  CONSTRAINT entities_pkey PRIMARY KEY (id)
);
CREATE TABLE openerp.books (
  id text NOT NULL,
  entity_id text NOT NULL,
  name text NOT NULL,
  currency text NOT NULL,
  currency_scale integer NOT NULL,
  profile text NOT NULL,
  profile_version bigint DEFAULT 1 NOT NULL,
  writer_epoch bigint DEFAULT 1 NOT NULL,
  authority text DEFAULT 'native'::text NOT NULL,
  committed_sequence bigint DEFAULT 0 NOT NULL,
  CONSTRAINT books_pkey PRIMARY KEY (id),
  CONSTRAINT books_entity_id_id_key UNIQUE (entity_id, id),
  CONSTRAINT books_authority_check CHECK (authority = 'native'::text),
  CONSTRAINT books_committed_sequence_check CHECK (committed_sequence >= 0),
  CONSTRAINT books_currency_check CHECK (currency ~ '^[A-Z]{3}$'::text),
  CONSTRAINT books_currency_scale_check CHECK (currency_scale >= 0 AND currency_scale <= 6),
  CONSTRAINT books_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES openerp.entities(id)
);
CREATE TABLE openerp.report_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  sequence bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT report_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT report_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.accountant_review_packs (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal bigint NOT NULL,
  report_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT accountant_review_packs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT accountant_review_packs_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT accountant_review_packs_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT accountant_review_packs_check1 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT accountant_review_packs_check2 CHECK (NOT body -> 'report'::text ->> 'id'::text IS DISTINCT FROM report_id),
  CONSTRAINT accountant_review_packs_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT accountant_review_packs_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT accountant_review_packs_book_id_report_id_fkey FOREIGN KEY (book_id, report_id) REFERENCES openerp.report_snapshots(book_id, id)
);
CREATE TABLE openerp.accountant_review_artifacts (
  book_id text NOT NULL,
  pack_id text NOT NULL,
  format text NOT NULL,
  descriptor jsonb NOT NULL,
  content text NOT NULL,
  CONSTRAINT accountant_review_artifacts_pkey PRIMARY KEY (book_id, pack_id, format),
  CONSTRAINT accountant_review_artifacts_check CHECK (NOT descriptor ->> 'format'::text IS DISTINCT FROM format),
  CONSTRAINT accountant_review_artifacts_check1 CHECK (descriptor ->> 'sha256'::text = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT accountant_review_artifacts_check2 CHECK ((descriptor ->> 'byteLength'::text)::bigint = octet_length(content)),
  CONSTRAINT accountant_review_artifacts_content_check CHECK (octet_length(content) <= 8388608),
  CONSTRAINT accountant_review_artifacts_format_check CHECK (format = ANY (ARRAY['json'::text, 'balances_csv'::text, 'journal_csv'::text, 'evidence_csv'::text, 'coverage_csv'::text, 'owner_sources_csv'::text, 'owner_controls_csv'::text, 'expense_tax_csv'::text])),
  CONSTRAINT accountant_review_artifacts_book_id_pack_id_fkey FOREIGN KEY (book_id, pack_id) REFERENCES openerp.accountant_review_packs(book_id, id)
);
CREATE TABLE openerp.accountant_review_rows (
  book_id text NOT NULL,
  pack_id text NOT NULL,
  section text NOT NULL,
  ordinal bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT accountant_review_rows_pkey PRIMARY KEY (book_id, pack_id, section, ordinal),
  CONSTRAINT accountant_review_rows_check CHECK (NOT body ->> 'section'::text IS DISTINCT FROM section),
  CONSTRAINT accountant_review_rows_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT accountant_review_rows_section_check CHECK (section = ANY (ARRAY['balances'::text, 'journal'::text, 'evidence'::text, 'coverage'::text, 'owner_sources'::text, 'owner_controls'::text, 'expense_tax'::text])),
  CONSTRAINT accountant_review_rows_book_id_pack_id_fkey FOREIGN KEY (book_id, pack_id) REFERENCES openerp.accountant_review_packs(book_id, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE openerp.accounts (
  book_id text NOT NULL,
  id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean DEFAULT TRUE NOT NULL,
  version bigint DEFAULT 1 NOT NULL,
  CONSTRAINT accounts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT accounts_book_id_code_key UNIQUE (book_id, code),
  CONSTRAINT accounts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.actors (
  id text NOT NULL,
  name text NOT NULL,
  CONSTRAINT actors_pkey PRIMARY KEY (id)
);
CREATE TABLE openerp.change_sets (
  book_id text NOT NULL,
  id text NOT NULL,
  plan jsonb NOT NULL,
  digest text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT change_sets_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT change_sets_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT change_sets_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  digest text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT approvals_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id)
);
CREATE TABLE openerp.posting_group_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  group_id text NOT NULL,
  plan_digest text NOT NULL,
  body jsonb NOT NULL,
  committed_at timestamptz NOT NULL,
  CONSTRAINT posting_group_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT posting_group_receipts_book_id_change_set_id_group_id_key UNIQUE (book_id, change_set_id, group_id),
  CONSTRAINT posting_group_receipts_check CHECK (body ->> 'changeSetId'::text = change_set_id),
  CONSTRAINT posting_group_receipts_check1 CHECK (body ->> 'groupId'::text = group_id),
  CONSTRAINT posting_group_receipts_check2 CHECK (body ->> 'planDigest'::text = plan_digest),
  CONSTRAINT posting_group_receipts_group_id_check CHECK (group_id ~ '^[a-z][a-z0-9_-]{2,127}$'::text),
  CONSTRAINT posting_group_receipts_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id)
);
CREATE TABLE openerp.approval_consumptions (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  change_set_id text NOT NULL,
  group_id text NOT NULL,
  plan_digest text NOT NULL,
  receipt_id text NOT NULL,
  approver_id text NOT NULL,
  consumed_by_id text NOT NULL,
  consumed_at timestamptz NOT NULL,
  CONSTRAINT approval_consumptions_pkey PRIMARY KEY (book_id, approval_id, group_id),
  CONSTRAINT approval_consumptions_book_id_receipt_id_group_id_key UNIQUE (book_id, receipt_id, group_id),
  CONSTRAINT approval_consumptions_group_id_check CHECK (group_id ~ '^[a-z][a-z0-9_-]{2,127}$'::text),
  CONSTRAINT approval_consumptions_plan_digest_check CHECK (plan_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT approval_consumptions_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals(book_id, id),
  CONSTRAINT approval_consumptions_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT approval_consumptions_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.posting_group_receipts(book_id, id)
);
CREATE TABLE openerp.invoice_policy_candidates (
  book_id text NOT NULL,
  id text NOT NULL,
  profile_key text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_policy_candidates_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_policy_candidates_book_id_profile_key_key UNIQUE (book_id, profile_key),
  CONSTRAINT invoice_policy_candidates_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT invoice_policy_candidates_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_policy_candidates_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.invoice_policy_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  candidate_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_policy_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_policy_reviews_book_id_candidate_id_key UNIQUE (book_id, candidate_id),
  CONSTRAINT invoice_policy_reviews_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT invoice_policy_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_policy_reviews_book_id_candidate_id_fkey FOREIGN KEY (book_id, candidate_id) REFERENCES openerp.invoice_policy_candidates(book_id, id)
);
CREATE TABLE openerp.ar_legal_policies (
  book_id text NOT NULL,
  id text NOT NULL,
  candidate_id text NOT NULL,
  review_id text NOT NULL,
  series text COLLATE "C" NOT NULL,
  activated_by text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_policies_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_policies_book_id_candidate_id_key UNIQUE (book_id, candidate_id),
  CONSTRAINT ar_legal_policies_book_id_series_key UNIQUE (book_id, series),
  CONSTRAINT ar_legal_policies_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT ar_legal_policies_activated_by_fkey FOREIGN KEY (activated_by) REFERENCES openerp.actors(id),
  CONSTRAINT ar_legal_policies_book_id_candidate_id_fkey FOREIGN KEY (book_id, candidate_id) REFERENCES openerp.invoice_policy_candidates(book_id, id),
  CONSTRAINT ar_legal_policies_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT ar_legal_policies_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.invoice_policy_reviews(book_id, id)
);
CREATE TABLE openerp.ar_legal_accounting_profiles (
  book_id text NOT NULL,
  id text NOT NULL,
  policy_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_accounting_profiles_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_accounting_profiles_book_id_policy_id_key UNIQUE (book_id, policy_id),
  CONSTRAINT ar_legal_accounting_profiles_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT ar_legal_accounting_profiles_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT ar_legal_accounting_profiles_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT ar_legal_accounting_profiles_book_id_policy_id_fkey FOREIGN KEY (book_id, policy_id) REFERENCES openerp.ar_legal_policies(book_id, id)
);
CREATE TABLE openerp.invoice_draft_revisions (
  book_id text NOT NULL,
  draft_id text NOT NULL,
  revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_draft_revisions_pkey PRIMARY KEY (book_id, draft_id, revision),
  CONSTRAINT invoice_draft_revisions_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT invoice_draft_revisions_check CHECK (body ->> 'id'::text = draft_id AND body ->> 'revision'::text = revision::text),
  CONSTRAINT invoice_draft_revisions_revision_check CHECK (revision >= 1 AND revision <= 50)
);
CREATE TABLE openerp.invoice_drafts (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_key text COLLATE "C" NOT NULL,
  current_revision bigint NOT NULL,
  CONSTRAINT invoice_drafts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_drafts_book_id_draft_key_key UNIQUE (book_id, draft_key),
  CONSTRAINT invoice_drafts_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 50),
  CONSTRAINT invoice_drafts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT invoice_drafts_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.invoice_draft_revisions(book_id, draft_id, revision) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE openerp.ar_legal_issue_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  policy_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_issue_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_issue_reviews_book_id_draft_id_ordinal_key UNIQUE (book_id, draft_id, ordinal),
  CONSTRAINT ar_legal_issue_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT ar_legal_issue_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT ar_legal_issue_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT ar_legal_issue_reviews_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id),
  CONSTRAINT ar_legal_issue_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT ar_legal_issue_reviews_book_id_policy_id_fkey FOREIGN KEY (book_id, policy_id) REFERENCES openerp.ar_legal_policies(book_id, id)
);
CREATE TABLE openerp.ar_legal_issue_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_issue_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_issue_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT ar_legal_issue_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT ar_legal_issue_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT ar_legal_issue_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.ar_legal_issue_reviews(book_id, id)
);
CREATE TABLE openerp.evidence (
  book_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  media_type text NOT NULL,
  origin text NOT NULL,
  sha256 text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT evidence_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT evidence_book_id_sha256_key UNIQUE (book_id, sha256),
  CONSTRAINT evidence_check CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT evidence_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 262144),
  CONSTRAINT evidence_media_type_check CHECK (media_type = ANY (ARRAY['text/plain'::text, 'application/json'::text])),
  CONSTRAINT evidence_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT evidence_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.events (
  book_id text NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  event_key text NOT NULL,
  CONSTRAINT events_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT events_book_id_evidence_id_event_key_key UNIQUE (book_id, evidence_id, event_key),
  CONSTRAINT events_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.fiscal_years (
  book_id text NOT NULL,
  id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  CONSTRAINT fiscal_years_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT fiscal_years_check CHECK (starts_on <= ends_on),
  CONSTRAINT fiscal_years_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.periods (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  locked boolean DEFAULT FALSE NOT NULL,
  version bigint DEFAULT 1 NOT NULL,
  CONSTRAINT periods_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT periods_book_id_fiscal_year_id_id_key UNIQUE (book_id, fiscal_year_id, id),
  CONSTRAINT periods_check CHECK (starts_on <= ends_on),
  CONSTRAINT periods_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id)
);
CREATE TABLE openerp.vouchers (
  book_id text NOT NULL,
  id text NOT NULL,
  fiscal_year_id text NOT NULL,
  period_id text NOT NULL,
  series text NOT NULL,
  number bigint NOT NULL,
  sequence bigint NOT NULL,
  posting_date date NOT NULL,
  event_id text NOT NULL,
  posting_purpose text NOT NULL,
  occurrence_key text NOT NULL,
  corrects_voucher_id text,
  change_set_id text NOT NULL,
  action jsonb NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  expected_line_count integer NOT NULL,
  CONSTRAINT vouchers_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vouchers_book_id_event_id_posting_purpose_occurrence_key_key UNIQUE (book_id, event_id, posting_purpose, occurrence_key),
  CONSTRAINT vouchers_book_id_fiscal_year_id_series_number_key UNIQUE (book_id, fiscal_year_id, series, number),
  CONSTRAINT vouchers_book_id_sequence_key UNIQUE (book_id, sequence),
  CONSTRAINT voucher_expected_line_count CHECK (expected_line_count >= 2 AND expected_line_count <= 500),
  CONSTRAINT vouchers_number_check CHECK (number > 0),
  CONSTRAINT vouchers_sequence_check CHECK (sequence > 0),
  CONSTRAINT vouchers_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT vouchers_book_id_corrects_voucher_id_fkey FOREIGN KEY (book_id, corrects_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT vouchers_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT vouchers_book_id_fiscal_year_id_period_id_fkey FOREIGN KEY (book_id, fiscal_year_id, period_id) REFERENCES openerp.periods(book_id, fiscal_year_id, id)
);
CREATE TABLE openerp.execution_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  change_set_id text NOT NULL,
  voucher_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT execution_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT execution_receipts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals(book_id, id),
  CONSTRAINT execution_receipts_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT execution_receipts_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.commerce_control_accounts (
  book_id text NOT NULL,
  account_id text NOT NULL,
  direction text NOT NULL,
  CONSTRAINT commerce_control_accounts_pkey PRIMARY KEY (book_id, account_id),
  CONSTRAINT commerce_control_accounts_book_id_account_id_direction_key UNIQUE (book_id, account_id, direction),
  CONSTRAINT commerce_control_accounts_direction_check CHECK (direction = ANY (ARRAY['customer'::text, 'supplier'::text])),
  CONSTRAINT commerce_control_accounts_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id)
);
CREATE TABLE openerp.commerce_counterparties (
  book_id text NOT NULL,
  id text NOT NULL,
  external_key text COLLATE "C" NOT NULL,
  role text NOT NULL,
  current_revision bigint NOT NULL,
  CONSTRAINT commerce_counterparties_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_counterparties_book_id_external_key_key UNIQUE (book_id, external_key),
  CONSTRAINT commerce_counterparties_current_revision_check CHECK (current_revision > 0),
  CONSTRAINT commerce_counterparties_role_check CHECK (role = ANY (ARRAY['customer'::text, 'supplier'::text, 'both'::text])),
  CONSTRAINT commerce_counterparties_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_counterparty_revisions (
  book_id text NOT NULL,
  counterparty_id text NOT NULL,
  revision bigint NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_counterparty_revisions_pkey PRIMARY KEY (book_id, counterparty_id, revision),
  CONSTRAINT commerce_counterparty_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT commerce_counterparty_revisions_book_id_counterparty_id_fkey FOREIGN KEY (book_id, counterparty_id) REFERENCES openerp.commerce_counterparties(book_id, id),
  CONSTRAINT commerce_counterparty_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.commerce_invoice_revisions (
  book_id text NOT NULL,
  invoice_id text NOT NULL,
  revision bigint NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_invoice_revisions_pkey PRIMARY KEY (book_id, invoice_id, revision),
  CONSTRAINT commerce_invoice_revisions_revision_check CHECK (revision > 0),
  CONSTRAINT commerce_invoice_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.journal_lines (
  book_id text NOT NULL,
  voucher_id text NOT NULL,
  id text NOT NULL,
  ordinal integer NOT NULL,
  account_id text NOT NULL,
  debit_minor openerp.minor_units NOT NULL,
  credit_minor openerp.minor_units NOT NULL,
  description text NOT NULL,
  CONSTRAINT journal_lines_pkey PRIMARY KEY (book_id, voucher_id, id),
  CONSTRAINT journal_lines_book_id_voucher_id_ordinal_key UNIQUE (book_id, voucher_id, ordinal),
  CONSTRAINT journal_lines_check CHECK (debit_minor::numeric > 0::numeric AND credit_minor::numeric = 0::numeric OR credit_minor::numeric > 0::numeric AND debit_minor::numeric = 0::numeric),
  CONSTRAINT journal_lines_ordinal_check CHECK (ordinal >= 1),
  CONSTRAINT journal_lines_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT journal_lines_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.commerce_invoices (
  book_id text NOT NULL,
  id text NOT NULL,
  direction text NOT NULL,
  counterparty_id text NOT NULL,
  counterparty_revision bigint NOT NULL,
  document_number text COLLATE "C" NOT NULL,
  issued_on date NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  control_account_id text NOT NULL,
  recognition_voucher_id text NOT NULL,
  recognition_line_id text NOT NULL,
  evidence_id text NOT NULL,
  current_revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_invoices_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_invoices_book_id_direction_counterparty_id_documen_key UNIQUE (book_id, direction, counterparty_id, document_number),
  CONSTRAINT commerce_invoices_book_id_recognition_voucher_id_recognitio_key UNIQUE (book_id, recognition_voucher_id, recognition_line_id),
  CONSTRAINT commerce_invoices_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT commerce_invoices_current_revision_check CHECK (current_revision > 0),
  CONSTRAINT commerce_invoices_direction_check CHECK (direction = ANY (ARRAY['customer'::text, 'supplier'::text])),
  CONSTRAINT commerce_invoices_book_id_control_account_id_direction_fkey FOREIGN KEY (book_id, control_account_id, direction) REFERENCES openerp.commerce_control_accounts(book_id, account_id, direction),
  CONSTRAINT commerce_invoices_book_id_counterparty_id_counterparty_rev_fkey FOREIGN KEY (book_id, counterparty_id, counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision),
  CONSTRAINT commerce_invoices_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT commerce_invoices_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_invoices_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.commerce_invoice_revisions(book_id, invoice_id, revision) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT commerce_invoices_book_id_recognition_voucher_id_recogniti_fkey FOREIGN KEY (book_id, recognition_voucher_id, recognition_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.ar_legal_issues (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  policy_id text NOT NULL,
  legal_number text COLLATE "C" NOT NULL,
  posting_receipt_id text NOT NULL,
  register_invoice_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_issues_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_issues_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT ar_legal_issues_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT ar_legal_issues_book_id_legal_number_key UNIQUE (book_id, legal_number),
  CONSTRAINT ar_legal_issues_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT ar_legal_issues_book_id_register_invoice_id_key UNIQUE (book_id, register_invoice_id),
  CONSTRAINT ar_legal_issues_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT ar_legal_issues_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT ar_legal_issues_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.ar_legal_issue_approvals(book_id, id),
  CONSTRAINT ar_legal_issues_book_id_policy_id_fkey FOREIGN KEY (book_id, policy_id) REFERENCES openerp.ar_legal_policies(book_id, id),
  CONSTRAINT ar_legal_issues_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT ar_legal_issues_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT ar_legal_issues_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.ar_legal_issue_reviews(book_id, id)
);
CREATE TABLE openerp.ar_legal_pdf_captures (
  book_id text NOT NULL,
  id text NOT NULL,
  issue_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_pdf_captures_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_pdf_captures_book_id_issue_id_key UNIQUE (book_id, issue_id),
  CONSTRAINT ar_legal_pdf_captures_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT ar_legal_pdf_captures_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT ar_legal_pdf_issue_fk FOREIGN KEY (book_id, issue_id) REFERENCES openerp.ar_legal_issues(book_id, id)
);
CREATE TABLE openerp.ar_legal_pdf_artifacts (
  book_id text NOT NULL,
  capture_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT ar_legal_pdf_artifacts_pkey PRIMARY KEY (book_id, capture_id),
  CONSTRAINT ar_legal_pdf_artifacts_check CHECK (descriptor ->> 'captureId'::text = capture_id AND descriptor ->> 'sha256'::text = encode(sha256(content), 'hex'::text) AND (descriptor ->> 'byteLength'::text)::integer = octet_length(content)),
  CONSTRAINT ar_legal_pdf_artifacts_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 2097152),
  CONSTRAINT ar_legal_pdf_artifacts_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.ar_legal_pdf_captures(book_id, id)
);
CREATE TABLE openerp.ar_legal_delivery_requests (
  book_id text NOT NULL,
  id text NOT NULL,
  capture_id text NOT NULL,
  channel text NOT NULL,
  created_by text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_delivery_requests_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_delivery_requests_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT ar_legal_delivery_requests_channel_check CHECK (channel = ANY (ARRAY['email'::text, 'peppol'::text])),
  CONSTRAINT ar_legal_delivery_requests_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.ar_legal_pdf_artifacts(book_id, capture_id),
  CONSTRAINT ar_legal_delivery_requests_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT ar_legal_delivery_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.ar_legal_delivery_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  request_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_delivery_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_delivery_approvals_book_id_request_id_key UNIQUE (book_id, request_id),
  CONSTRAINT ar_legal_delivery_approvals_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT ar_legal_delivery_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT ar_legal_delivery_approvals_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.ar_legal_delivery_requests(book_id, id)
);
CREATE TABLE openerp.ar_legal_delivery_attempts (
  book_id text NOT NULL,
  id text NOT NULL,
  request_id text NOT NULL,
  approval_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_delivery_attempts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_delivery_attempts_book_id_request_id_ordinal_key UNIQUE (book_id, request_id, ordinal),
  CONSTRAINT ar_legal_delivery_attempts_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT ar_legal_delivery_attempts_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT ar_legal_delivery_attempts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.ar_legal_delivery_approvals(book_id, id),
  CONSTRAINT ar_legal_delivery_attempts_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.ar_legal_delivery_requests(book_id, id)
);
CREATE TABLE openerp.ar_legal_delivery_reconciliations (
  book_id text NOT NULL,
  id text NOT NULL,
  attempt_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT ar_legal_delivery_reconciliations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT ar_legal_delivery_reconciliations_book_id_attempt_id_key UNIQUE (book_id, attempt_id),
  CONSTRAINT ar_legal_delivery_reconciliations_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT ar_legal_delivery_reconciliations_book_id_attempt_id_fkey FOREIGN KEY (book_id, attempt_id) REFERENCES openerp.ar_legal_delivery_attempts(book_id, id)
);
CREATE TABLE openerp.ar_legal_issue_counters (
  book_id text NOT NULL,
  policy_id text NOT NULL,
  last_number bigint NOT NULL,
  CONSTRAINT ar_legal_issue_counters_pkey PRIMARY KEY (book_id, policy_id),
  CONSTRAINT ar_legal_issue_counters_last_number_check CHECK (last_number >= 1 AND last_number <= '999999999999999999'::bigint),
  CONSTRAINT ar_legal_issue_counters_book_id_policy_id_fkey FOREIGN KEY (book_id, policy_id) REFERENCES openerp.ar_legal_policies(book_id, id)
);
CREATE TABLE openerp.bank_allocation_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  input jsonb NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_allocation_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_allocation_plans_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT bank_allocation_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.bank_allocation_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_allocation_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_allocation_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT bank_allocation_approvals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_allocation_plans(book_id, id)
);
CREATE TABLE openerp.bank_allocation_executions (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_allocation_executions_pkey PRIMARY KEY (book_id, plan_id),
  CONSTRAINT bank_allocation_executions_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.bank_allocation_approvals(book_id, id),
  CONSTRAINT bank_allocation_executions_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_allocation_plans(book_id, id)
);
CREATE TABLE openerp.bank_sources (
  book_id text NOT NULL,
  account_id text NOT NULL,
  source_bank_account_id text NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  CONSTRAINT bank_sources_pkey PRIMARY KEY (book_id, account_id),
  CONSTRAINT bank_sources_book_id_source_bank_account_id_key UNIQUE (book_id, source_bank_account_id),
  CONSTRAINT bank_sources_revision_check CHECK (revision >= 0),
  CONSTRAINT bank_sources_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id)
);
CREATE TABLE openerp.bank_statements (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  source_bank_account_id text NOT NULL,
  statement_identifier text NOT NULL,
  evidence_id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  source jsonb NOT NULL,
  import_input jsonb NOT NULL,
  CONSTRAINT bank_statements_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_statements_book_id_evidence_id_key UNIQUE (book_id, evidence_id),
  CONSTRAINT bank_statements_book_id_source_bank_account_id_statement_id_key UNIQUE (book_id, source_bank_account_id, statement_identifier),
  CONSTRAINT bank_statements_check CHECK (starts_on <= ends_on),
  CONSTRAINT bank_statements_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.bank_sources(book_id, account_id),
  CONSTRAINT bank_statements_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.bank_observations (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  provider_id text,
  source_bank_account_id text NOT NULL,
  observed_on date NOT NULL,
  description text NOT NULL,
  amount_minor numeric NOT NULL,
  CONSTRAINT bank_observations_pkey PRIMARY KEY (book_id, statement_id, row_ordinal),
  CONSTRAINT bank_observations_book_id_source_bank_account_id_provider_i_key UNIQUE (book_id, source_bank_account_id, provider_id),
  CONSTRAINT bank_observations_amount_minor_check CHECK (amount_minor = trunc(amount_minor) AND abs(amount_minor) < '100000000000000000000000000000000000000'::numeric),
  CONSTRAINT bank_observations_row_ordinal_check CHECK (row_ordinal >= 1 AND row_ordinal <= 10000),
  CONSTRAINT bank_observations_book_id_statement_id_fkey FOREIGN KEY (book_id, statement_id) REFERENCES openerp.bank_statements(book_id, id)
);
CREATE TABLE openerp.bank_allocation_legs (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  ordinal integer NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  amount_minor numeric NOT NULL,
  CONSTRAINT bank_allocation_legs_pkey PRIMARY KEY (book_id, plan_id, ordinal),
  CONSTRAINT bank_allocation_legs_book_id_plan_id_statement_id_row_ordin_key UNIQUE (book_id, plan_id, statement_id, row_ordinal, voucher_id, line_id),
  CONSTRAINT bank_allocation_legs_amount_minor_check CHECK (amount_minor = trunc(amount_minor) AND amount_minor <> 0::numeric AND abs(amount_minor) < '100000000000000000000000000000000000000'::numeric),
  CONSTRAINT bank_allocation_legs_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 100),
  CONSTRAINT bank_allocation_legs_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_allocation_executions(book_id, plan_id),
  CONSTRAINT bank_allocation_legs_book_id_statement_id_row_ordinal_fkey FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_observations(book_id, statement_id, row_ordinal),
  CONSTRAINT bank_allocation_legs_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.bank_capacity_reconciliations (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_capacity_reconciliations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_capacity_reconciliations_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT bank_capacity_reconciliations_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.bank_connector_consents (
  book_id text NOT NULL,
  id text NOT NULL,
  provider_id text NOT NULL,
  external_account_id text NOT NULL,
  source_account_id text NOT NULL,
  account_id text NOT NULL,
  body jsonb NOT NULL,
  revoked_at timestamptz,
  cursor text,
  CONSTRAINT bank_connector_consents_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_connector_consents_book_id_provider_id_external_accoun_key UNIQUE (book_id, provider_id, external_account_id),
  CONSTRAINT bank_connector_consents_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.bank_connector_batches (
  book_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_connector_batches_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_connector_batches_book_id_consent_id_fkey FOREIGN KEY (book_id, consent_id) REFERENCES openerp.bank_connector_consents(book_id, id)
);
CREATE TABLE openerp.intake_contents (
  book_id text NOT NULL,
  sha256 text NOT NULL,
  bytes bytea,
  object_key text,
  byte_length integer,
  CONSTRAINT intake_contents_pkey PRIMARY KEY (book_id, sha256),
  CONSTRAINT intake_content_storage CHECK (bytes IS NOT NULL AND object_key IS NULL AND byte_length IS NULL OR bytes IS NULL AND object_key IS NOT NULL AND byte_length IS NOT NULL AND (byte_length >= 1 AND byte_length <= 5242880) AND sha256 ~ '^sha256:[a-f0-9]{64}$'::text AND object_key = 'v1/'::text || book_id || '/'::text || SUBSTRING(sha256 FROM 8)),
  CONSTRAINT intake_contents_bytes_check CHECK (octet_length(bytes) >= 1 AND octet_length(bytes) <= 65536),
  CONSTRAINT intake_contents_check CHECK (sha256 = 'sha256:'::text || encode(sha256(bytes), 'hex'::text)),
  CONSTRAINT intake_contents_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.intake_occurrences (
  book_id text NOT NULL,
  id text NOT NULL,
  sha256 text NOT NULL,
  source_system text NOT NULL,
  source_account_id text NOT NULL,
  occurrence_key text NOT NULL,
  source_revision text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT intake_occurrences_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT intake_occurrences_book_id_source_system_source_account_id__key UNIQUE (book_id, source_system, source_account_id, occurrence_key, source_revision),
  CONSTRAINT intake_occurrences_book_id_sha256_fkey FOREIGN KEY (book_id, sha256) REFERENCES openerp.intake_contents(book_id, sha256)
);
CREATE TABLE openerp.bank_connector_records (
  book_id text NOT NULL,
  consent_id text NOT NULL,
  external_id text NOT NULL,
  revision text NOT NULL,
  occurrence_id text NOT NULL,
  batch_id text NOT NULL,
  sha256 text NOT NULL,
  CONSTRAINT bank_connector_records_pkey PRIMARY KEY (book_id, consent_id, external_id, revision),
  CONSTRAINT bank_connector_records_book_id_batch_id_fkey FOREIGN KEY (book_id, batch_id) REFERENCES openerp.bank_connector_batches(book_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT bank_connector_records_book_id_consent_id_fkey FOREIGN KEY (book_id, consent_id) REFERENCES openerp.bank_connector_consents(book_id, id),
  CONSTRAINT bank_connector_records_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id)
);
CREATE TABLE openerp.closing_inventories (
  book_id text NOT NULL,
  id text NOT NULL,
  period_id text NOT NULL,
  ordinal bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT closing_inventories_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT closing_inventories_book_id_period_id_ordinal_key UNIQUE (book_id, period_id, ordinal),
  CONSTRAINT closing_inventories_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT closing_inventories_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id)
);
CREATE TABLE openerp.bank_inventory_signoff_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  inventory_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT bank_inventory_signoff_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_inventory_signoff_plans_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 8388608),
  CONSTRAINT bank_inventory_signoff_plans_check CHECK (byte_length = octet_length(convert_to(content, 'UTF8'::name))),
  CONSTRAINT bank_inventory_signoff_plans_check1 CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT bank_inventory_signoff_plans_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT bank_inventory_signoff_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT bank_inventory_signoff_plans_book_id_inventory_id_fkey FOREIGN KEY (book_id, inventory_id) REFERENCES openerp.closing_inventories(book_id, id)
);
CREATE TABLE openerp.bank_inventory_signoffs (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT bank_inventory_signoffs_pkey PRIMARY KEY (book_id, plan_id),
  CONSTRAINT bank_inventory_signoffs_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 8388608),
  CONSTRAINT bank_inventory_signoffs_check CHECK (byte_length = octet_length(convert_to(content, 'UTF8'::name))),
  CONSTRAINT bank_inventory_signoffs_check1 CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT bank_inventory_signoffs_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT bank_inventory_signoffs_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT bank_inventory_signoffs_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_inventory_signoff_plans(book_id, id)
);
CREATE TABLE openerp.bank_match_reversal_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  target_key text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_match_reversal_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_match_reversal_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.bank_match_reversal_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_match_reversal_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_match_reversal_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT bank_match_reversal_approvals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_match_reversal_plans(book_id, id)
);
CREATE TABLE openerp.bank_match_reversal_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_match_reversal_revocations_pkey PRIMARY KEY (book_id, approval_id),
  CONSTRAINT bank_match_reversal_revocations_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.bank_match_reversal_approvals(book_id, id)
);
CREATE TABLE openerp.bank_matches (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  origin text NOT NULL,
  actor_id text NOT NULL,
  CONSTRAINT bank_matches_pkey PRIMARY KEY (book_id, statement_id, row_ordinal),
  CONSTRAINT bank_matches_book_id_voucher_id_line_id_key UNIQUE (book_id, voucher_id, line_id),
  CONSTRAINT bank_matches_origin_check CHECK (origin = ANY (ARRAY['imported'::text, 'explicit'::text])),
  CONSTRAINT bank_matches_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT bank_matches_book_id_statement_id_row_ordinal_fkey FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_observations(book_id, statement_id, row_ordinal),
  CONSTRAINT bank_matches_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.bank_match_reversals (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  approval_id text NOT NULL,
  target_key text NOT NULL,
  allocation_plan_id text,
  statement_id text,
  row_ordinal integer,
  body jsonb NOT NULL,
  CONSTRAINT bank_match_reversals_pkey PRIMARY KEY (book_id, plan_id),
  CONSTRAINT bank_match_reversals_book_id_allocation_plan_id_key UNIQUE (book_id, allocation_plan_id),
  CONSTRAINT bank_match_reversals_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT bank_match_reversals_book_id_statement_id_row_ordinal_key UNIQUE (book_id, statement_id, row_ordinal),
  CONSTRAINT bank_match_reversals_book_id_target_key_key UNIQUE (book_id, target_key),
  CONSTRAINT bank_match_reversals_check CHECK (allocation_plan_id IS NOT NULL AND statement_id IS NULL AND row_ordinal IS NULL OR allocation_plan_id IS NULL AND statement_id IS NOT NULL AND row_ordinal IS NOT NULL),
  CONSTRAINT bank_match_reversals_book_id_allocation_plan_id_fkey FOREIGN KEY (book_id, allocation_plan_id) REFERENCES openerp.bank_allocation_executions(book_id, plan_id),
  CONSTRAINT bank_match_reversals_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.bank_match_reversal_approvals(book_id, id),
  CONSTRAINT bank_match_reversals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_match_reversal_plans(book_id, id),
  CONSTRAINT bank_match_reversals_book_id_statement_id_row_ordinal_fkey FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_matches(book_id, statement_id, row_ordinal)
);
CREATE TABLE openerp.bank_source_coverage_reports (
  book_id text NOT NULL,
  id text NOT NULL,
  inventory_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT bank_source_coverage_reports_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_source_coverage_reports_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 8388608),
  CONSTRAINT bank_source_coverage_reports_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT bank_source_coverage_reports_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT bank_source_coverage_reports_book_id_inventory_id_fkey FOREIGN KEY (book_id, inventory_id) REFERENCES openerp.closing_inventories(book_id, id)
);
CREATE TABLE openerp.bank_signoff_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  coverage_report_id text NOT NULL,
  reconciliation_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_signoff_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_signoff_plans_book_id_coverage_report_id_fkey FOREIGN KEY (book_id, coverage_report_id) REFERENCES openerp.bank_source_coverage_reports(book_id, id),
  CONSTRAINT bank_signoff_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT bank_signoff_plans_book_id_reconciliation_id_fkey FOREIGN KEY (book_id, reconciliation_id) REFERENCES openerp.bank_capacity_reconciliations(book_id, id)
);
CREATE TABLE openerp.bank_reconciliation_signoffs (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT bank_reconciliation_signoffs_pkey PRIMARY KEY (book_id, plan_id),
  CONSTRAINT bank_reconciliation_signoffs_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 1048576),
  CONSTRAINT bank_reconciliation_signoffs_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT bank_reconciliation_signoffs_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT bank_reconciliation_signoffs_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.bank_signoff_plans(book_id, id)
);
CREATE TABLE openerp.bank_reconciliations (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT bank_reconciliations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_reconciliations_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id)
);
CREATE TABLE openerp.case_context_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT case_context_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT case_context_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.case_context_items (
  book_id text NOT NULL,
  snapshot_id text NOT NULL,
  event_id text NOT NULL,
  ordinal bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT case_context_items_pkey PRIMARY KEY (book_id, snapshot_id, event_id),
  CONSTRAINT case_context_items_book_id_snapshot_id_ordinal_key UNIQUE (book_id, snapshot_id, ordinal),
  CONSTRAINT case_context_items_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT case_context_items_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT case_context_items_book_id_snapshot_id_fkey FOREIGN KEY (book_id, snapshot_id) REFERENCES openerp.case_context_snapshots(book_id, id)
);
CREATE TABLE openerp.case_context_plans (
  book_id text NOT NULL,
  snapshot_id text NOT NULL,
  event_id text NOT NULL,
  ordinal bigint NOT NULL,
  change_set_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT case_context_plans_pkey PRIMARY KEY (book_id, snapshot_id, event_id, ordinal),
  CONSTRAINT case_context_plans_book_id_snapshot_id_change_set_id_key UNIQUE (book_id, snapshot_id, change_set_id),
  CONSTRAINT case_context_plans_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT case_context_plans_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT case_context_plans_book_id_snapshot_id_event_id_fkey FOREIGN KEY (book_id, snapshot_id, event_id) REFERENCES openerp.case_context_items(book_id, snapshot_id, event_id)
);
CREATE TABLE openerp.catalog_articles (
  book_id text NOT NULL,
  code text COLLATE "C" NOT NULL,
  current_revision bigint NOT NULL,
  CONSTRAINT catalog_articles_pkey PRIMARY KEY (book_id, code),
  CONSTRAINT catalog_articles_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 100000),
  CONSTRAINT catalog_articles_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.catalog_article_revisions (
  book_id text NOT NULL,
  code text COLLATE "C" NOT NULL,
  revision bigint NOT NULL,
  body jsonb NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT catalog_article_revisions_pkey PRIMARY KEY (book_id, code, revision),
  CONSTRAINT catalog_article_revisions_body_check CHECK (octet_length(body::text) <= 4096),
  CONSTRAINT catalog_article_revisions_check CHECK (body ->> 'code'::text = code AND body ->> 'revision'::text = revision::text),
  CONSTRAINT catalog_article_revisions_book_id_code_fkey FOREIGN KEY (book_id, code) REFERENCES openerp.catalog_articles(book_id, code),
  CONSTRAINT catalog_article_revisions_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.closing_proposals (
  book_id text NOT NULL,
  id text NOT NULL,
  period_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT closing_proposals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT closing_proposals_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id)
);
CREATE TABLE openerp.closing_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  proposal_id text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT closing_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT closing_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT closing_approvals_book_id_proposal_id_fkey FOREIGN KEY (book_id, proposal_id) REFERENCES openerp.closing_proposals(book_id, id)
);
CREATE TABLE openerp.closing_transitions (
  book_id text NOT NULL,
  id text NOT NULL,
  period_id text NOT NULL,
  proposal_id text NOT NULL,
  approval_id text NOT NULL,
  period_version bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT closing_transitions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT closing_transitions_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT closing_transitions_book_id_period_id_period_version_key UNIQUE (book_id, period_id, period_version),
  CONSTRAINT closing_transitions_book_id_proposal_id_key UNIQUE (book_id, proposal_id),
  CONSTRAINT closing_transitions_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.closing_approvals(book_id, id),
  CONSTRAINT closing_transitions_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id),
  CONSTRAINT closing_transitions_book_id_proposal_id_fkey FOREIGN KEY (book_id, proposal_id) REFERENCES openerp.closing_proposals(book_id, id)
);
CREATE TABLE openerp.closing_certificates (
  book_id text NOT NULL,
  id text NOT NULL,
  period_id text NOT NULL,
  transition_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT closing_certificates_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT closing_certificates_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id),
  CONSTRAINT closing_certificates_book_id_transition_id_fkey FOREIGN KEY (book_id, transition_id) REFERENCES openerp.closing_transitions(book_id, id)
);
CREATE TABLE openerp.closing_invalidations (
  book_id text NOT NULL,
  kind text NOT NULL,
  artifact_id text NOT NULL,
  transition_id text NOT NULL,
  CONSTRAINT closing_invalidations_pkey PRIMARY KEY (book_id, kind, artifact_id),
  CONSTRAINT closing_invalidations_kind_check CHECK (kind = ANY (ARRAY['certificate'::text, 'report'::text, 'bank_reconciliation'::text])),
  CONSTRAINT closing_invalidations_book_id_transition_id_fkey FOREIGN KEY (book_id, transition_id) REFERENCES openerp.closing_transitions(book_id, id)
);
CREATE TABLE openerp.collection_disputes (
  book_id text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  customer_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT collection_disputes_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT collection_disputes_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT collection_disputes_book_id_customer_id_fkey FOREIGN KEY (book_id, customer_id) REFERENCES openerp.commerce_counterparties(book_id, id),
  CONSTRAINT collection_disputes_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT collection_disputes_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);
CREATE TABLE openerp.collection_events (
  book_id text NOT NULL,
  id text NOT NULL,
  customer_id text NOT NULL,
  invoice_id text,
  dispute_id text,
  kind text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT collection_events_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT collection_events_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT collection_events_kind_check CHECK (kind = ANY (ARRAY['contact'::text, 'follow_up'::text, 'dispute_resolved'::text, 'reminder_prepared'::text])),
  CONSTRAINT collection_events_book_id_customer_id_fkey FOREIGN KEY (book_id, customer_id) REFERENCES openerp.commerce_counterparties(book_id, id),
  CONSTRAINT collection_events_book_id_dispute_id_fkey FOREIGN KEY (book_id, dispute_id) REFERENCES openerp.collection_disputes(book_id, id),
  CONSTRAINT collection_events_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT collection_events_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);
CREATE TABLE openerp.collection_statements (
  book_id text NOT NULL,
  id text NOT NULL,
  customer_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT collection_statements_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT collection_statements_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT collection_statements_book_id_customer_id_fkey FOREIGN KEY (book_id, customer_id) REFERENCES openerp.commerce_counterparties(book_id, id),
  CONSTRAINT collection_statements_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.collection_statement_artifacts (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  content text NOT NULL,
  CONSTRAINT collection_statement_artifacts_pkey PRIMARY KEY (book_id, statement_id),
  CONSTRAINT collection_statement_artifacts_content_check CHECK (octet_length(convert_to(content, 'UTF8'::name)) >= 1 AND octet_length(convert_to(content, 'UTF8'::name)) <= 262144),
  CONSTRAINT collection_statement_artifacts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT collection_statement_artifacts_book_id_statement_id_fkey FOREIGN KEY (book_id, statement_id) REFERENCES openerp.collection_statements(book_id, id)
);
CREATE TABLE openerp.command_receipts (
  book_id text NOT NULL,
  key text NOT NULL,
  request_digest text NOT NULL,
  operation text NOT NULL,
  actor_id text NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT command_receipts_pkey PRIMARY KEY (book_id, key),
  CONSTRAINT command_receipts_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT command_receipts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_allocation_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_allocation_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_allocation_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_allocation_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_allocation_approvals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.commerce_allocation_plans(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_allocation_receipts_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT commerce_allocation_receipts_book_id_plan_id_key UNIQUE (book_id, plan_id),
  CONSTRAINT commerce_allocation_receipts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_allocation_approvals(book_id, id),
  CONSTRAINT commerce_allocation_receipts_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.commerce_allocation_plans(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_legs (
  book_id text NOT NULL,
  receipt_id text NOT NULL,
  ordinal integer NOT NULL,
  invoice_id text NOT NULL,
  payment_voucher_id text NOT NULL,
  payment_line_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  CONSTRAINT commerce_allocation_legs_pkey PRIMARY KEY (book_id, receipt_id, ordinal),
  CONSTRAINT commerce_allocation_legs_book_id_receipt_id_invoice_id_key UNIQUE (book_id, receipt_id, invoice_id),
  CONSTRAINT commerce_allocation_legs_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT commerce_allocation_legs_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT commerce_allocation_legs_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT commerce_allocation_legs_book_id_payment_voucher_id_paymen_fkey FOREIGN KEY (book_id, payment_voucher_id, payment_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT commerce_allocation_legs_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_reversal_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  receipt_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_reversal_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_allocation_reversal_plans_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT commerce_allocation_reversal_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_allocation_reversal_plans_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_reversal_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_reversal_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_allocation_reversal_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_allocation_reversal_approvals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.commerce_allocation_reversal_plans(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_reversal_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_reversal_revocations_pkey PRIMARY KEY (book_id, approval_id),
  CONSTRAINT commerce_allocation_reversal_revocatio_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_allocation_reversal_approvals(book_id, id)
);
CREATE TABLE openerp.commerce_allocation_reversals (
  book_id text NOT NULL,
  plan_id text NOT NULL,
  approval_id text NOT NULL,
  receipt_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_allocation_reversals_pkey PRIMARY KEY (book_id, plan_id),
  CONSTRAINT commerce_allocation_reversals_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT commerce_allocation_reversals_book_id_receipt_id_key UNIQUE (book_id, receipt_id),
  CONSTRAINT commerce_allocation_reversals_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_allocation_reversal_approvals(book_id, id),
  CONSTRAINT commerce_allocation_reversals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.commerce_allocation_reversal_plans(book_id, id),
  CONSTRAINT commerce_allocation_reversals_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.commerce_allocation_receipts(book_id, id)
);
CREATE TABLE openerp.commerce_fx_recognition_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  item_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_recognition_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_recognition_reviews_book_id_item_id_key UNIQUE (book_id, item_id),
  CONSTRAINT commerce_fx_recognition_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_recognition_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_fx_recognition_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_recognition_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_recognition_approvals_book_id_review_id_id_key UNIQUE (book_id, review_id, id),
  CONSTRAINT commerce_fx_recognition_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_recognition_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_recognition_reviews(book_id, id)
);
CREATE TABLE openerp.exchange_rate_observations (
  book_id text NOT NULL,
  id text NOT NULL,
  source_key text NOT NULL,
  CONSTRAINT exchange_rate_observations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT exchange_rate_observations_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT exchange_rate_observations_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.exchange_rate_revisions (
  book_id text NOT NULL,
  observation_id text NOT NULL,
  revision integer NOT NULL,
  evidence_id text NOT NULL,
  review_evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT exchange_rate_revisions_pkey PRIMARY KEY (book_id, observation_id, revision),
  CONSTRAINT exchange_rate_revisions_revision_check CHECK (revision >= 1 AND revision <= 20),
  CONSTRAINT exchange_rate_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT exchange_rate_revisions_book_id_observation_id_fkey FOREIGN KEY (book_id, observation_id) REFERENCES openerp.exchange_rate_observations(book_id, id),
  CONSTRAINT exchange_rate_revisions_book_id_review_evidence_id_fkey FOREIGN KEY (book_id, review_evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.commerce_fx_items (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  counterparty_id text NOT NULL,
  counterparty_revision bigint NOT NULL,
  source_key text COLLATE "C" NOT NULL,
  source_revision text NOT NULL,
  evidence_id text NOT NULL,
  rate_observation_id text NOT NULL,
  rate_revision integer NOT NULL,
  rate_digest text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  original_currency text NOT NULL,
  original_scale integer NOT NULL,
  original_minor openerp.minor_units NOT NULL,
  book_currency text NOT NULL,
  book_scale integer NOT NULL,
  carrying_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_items_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_items_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT commerce_fx_items_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT commerce_fx_items_book_id_voucher_id_line_id_key UNIQUE (book_id, voucher_id, line_id),
  CONSTRAINT commerce_fx_items_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_fx_recognition_approvals(book_id, id),
  CONSTRAINT commerce_fx_items_book_id_counterparty_id_counterparty_rev_fkey FOREIGN KEY (book_id, counterparty_id, counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision),
  CONSTRAINT commerce_fx_items_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT commerce_fx_items_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT commerce_fx_items_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_fx_items_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT commerce_fx_items_book_id_rate_observation_id_rate_revisio_fkey FOREIGN KEY (book_id, rate_observation_id, rate_revision) REFERENCES openerp.exchange_rate_revisions(book_id, observation_id, revision),
  CONSTRAINT commerce_fx_items_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_recognition_reviews(book_id, id),
  CONSTRAINT commerce_fx_items_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.commerce_fx_settlement_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  item_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_settlement_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_fx_settlement_reviews_book_id_item_id_fkey FOREIGN KEY (book_id, item_id) REFERENCES openerp.commerce_fx_items(book_id, id)
);
CREATE TABLE openerp.commerce_fx_settlement_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_approvals_book_id_review_id_id_key UNIQUE (book_id, review_id, id),
  CONSTRAINT commerce_fx_settlement_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_settlement_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_settlement_reviews(book_id, id)
);
CREATE TABLE openerp.commerce_fx_settlements (
  book_id text NOT NULL,
  id text NOT NULL,
  item_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  cash_line_id text NOT NULL,
  control_line_id text,
  realized_line_id text,
  original_released_minor openerp.minor_units NOT NULL,
  carrying_released_minor openerp.minor_units NOT NULL,
  consideration_minor openerp.minor_units NOT NULL,
  realized_gain_minor numeric NOT NULL,
  body jsonb NOT NULL,
  profile text DEFAULT 'synthetic_full_book_currency_settlement_v1'::text NOT NULL,
  leg_ordinal integer DEFAULT 1 NOT NULL,
  final_leg boolean,
  original_remaining_before_minor openerp.minor_units,
  original_remaining_after_minor openerp.minor_units,
  carrying_remaining_before_minor openerp.minor_units,
  carrying_remaining_after_minor openerp.minor_units,
  CONSTRAINT commerce_fx_settlements_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT commerce_fx_settlements_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT commerce_fx_settlements_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT commerce_fx_settlements_profile_item_unique UNIQUE (book_id, item_id, leg_ordinal),
  CONSTRAINT commerce_fx_settlements_line_check CHECK (carrying_released_minor::numeric = 0::numeric AND control_line_id IS NULL OR carrying_released_minor::numeric > 0::numeric AND control_line_id IS NOT NULL),
  CONSTRAINT commerce_fx_settlements_profile_check CHECK ((profile = 'synthetic_full_book_currency_settlement_v1'::text AND leg_ordinal = 1 AND final_leg IS NULL AND original_remaining_before_minor IS NULL AND original_remaining_after_minor IS NULL AND carrying_remaining_before_minor IS NULL AND carrying_remaining_after_minor IS NULL OR profile = 'synthetic_partial_book_currency_settlement_v1'::text AND leg_ordinal > 0 AND final_leg IS NOT NULL AND original_remaining_before_minor::numeric > 0::numeric AND original_released_minor::numeric > 0::numeric AND original_released_minor::numeric <= original_remaining_before_minor::numeric AND original_remaining_after_minor::numeric = original_remaining_before_minor::numeric - original_released_minor::numeric AND carrying_remaining_before_minor::numeric >= 0::numeric AND carrying_released_minor::numeric >= 0::numeric AND carrying_released_minor::numeric <= carrying_remaining_before_minor::numeric AND carrying_remaining_after_minor::numeric = carrying_remaining_before_minor::numeric - carrying_released_minor::numeric AND final_leg = (original_remaining_after_minor::numeric = 0::numeric) AND body ->> 'profile'::text = profile AND body ->> 'legOrdinal'::text = leg_ordinal::text AND body -> 'calculation'::text ->> 'originalRemainingBeforeMinor'::text = original_remaining_before_minor::text AND body -> 'calculation'::text ->> 'originalReleasedMinor'::text = original_released_minor::text AND body -> 'calculation'::text ->> 'originalRemainingAfterMinor'::text = original_remaining_after_minor::text AND body -> 'calculation'::text ->> 'carryingRemainingBeforeMinor'::text = carrying_remaining_before_minor::text AND body -> 'calculation'::text ->> 'carryingReleasedMinor'::text = carrying_released_minor::text AND body -> 'calculation'::text ->> 'carryingRemainingAfterMinor'::text = carrying_remaining_after_minor::text AND body -> 'calculation'::text ->> 'considerationMinor'::text = consideration_minor::text AND body -> 'calculation'::text ->> 'realizedGainMinor'::text = realized_gain_minor::text AND body -> 'calculation'::text ->> 'finalLeg'::text = final_leg::text) IS TRUE),
  CONSTRAINT commerce_fx_settlements_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_fx_settlement_approvals(book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_fx_settlements_book_id_item_id_fkey FOREIGN KEY (book_id, item_id) REFERENCES openerp.commerce_fx_items(book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_settlement_reviews(book_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_voucher_id_cash_line_id_fkey FOREIGN KEY (book_id, voucher_id, cash_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_voucher_id_control_line_id_fkey FOREIGN KEY (book_id, voucher_id, control_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT commerce_fx_settlements_book_id_voucher_id_realized_line_i_fkey FOREIGN KEY (book_id, voucher_id, realized_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.commerce_fx_settlement_correction_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  settlement_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_correction_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_correction_re_book_id_settlement_id_fkey FOREIGN KEY (book_id, settlement_id) REFERENCES openerp.commerce_fx_settlements(book_id, id),
  CONSTRAINT commerce_fx_settlement_correction_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT commerce_fx_settlement_correction_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_fx_settlement_correction_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_correction_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_correction_appr_book_id_review_id_id_key UNIQUE (book_id, review_id, id),
  CONSTRAINT commerce_fx_settlement_correction_approv_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_settlement_correction_reviews(book_id, id),
  CONSTRAINT commerce_fx_settlement_correction_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.commerce_fx_settlement_corrections (
  book_id text NOT NULL,
  id text NOT NULL,
  item_id text NOT NULL,
  settlement_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  original_voucher_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_fx_settlement_corrections_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_fx_settlement_correctio_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_settlement_id_key UNIQUE (book_id, settlement_id),
  CONSTRAINT commerce_fx_settlement_correct_book_id_original_voucher_id_fkey FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT commerce_fx_settlement_correcti_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.commerce_fx_settlement_correction_approvals(book_id, id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_item_id_fkey FOREIGN KEY (book_id, item_id) REFERENCES openerp.commerce_fx_items(book_id, id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.commerce_fx_settlement_correction_reviews(book_id, id),
  CONSTRAINT commerce_fx_settlement_corrections_book_id_settlement_id_fkey FOREIGN KEY (book_id, settlement_id) REFERENCES openerp.commerce_fx_settlements(book_id, id)
);
CREATE TABLE openerp.commerce_register_snapshots (
  book_id text NOT NULL,
  id text COLLATE "C" NOT NULL,
  ordinal bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT commerce_register_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT commerce_register_snapshots_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT commerce_register_snapshots_body_check CHECK (octet_length(body::text) <= 2097152),
  CONSTRAINT commerce_register_snapshots_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT commerce_register_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.commerce_register_allocation_dependencies (
  book_id text NOT NULL,
  report_id text NOT NULL,
  history_version numeric NOT NULL,
  CONSTRAINT commerce_register_allocation_dependencies_pkey PRIMARY KEY (book_id, report_id),
  CONSTRAINT commerce_register_allocation_dependencies_history_version_check CHECK (history_version >= 0::numeric),
  CONSTRAINT commerce_register_allocation_dependencie_book_id_report_id_fkey FOREIGN KEY (book_id, report_id) REFERENCES openerp.commerce_register_snapshots(book_id, id)
);
CREATE TABLE openerp.company_setup_commands (
  actor_id text NOT NULL,
  key text NOT NULL,
  book_id text NOT NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT company_setup_commands_pkey PRIMARY KEY (actor_id, key),
  CONSTRAINT company_setup_commands_operation_check CHECK (operation = ANY (ARRAY['create'::text, 'save'::text])),
  CONSTRAINT company_setup_commands_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT company_setup_commands_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.company_setups (
  book_id text NOT NULL,
  details jsonb NOT NULL,
  revision integer NOT NULL,
  created_by text NOT NULL,
  CONSTRAINT company_setups_pkey PRIMARY KEY (book_id),
  CONSTRAINT company_setups_details_check CHECK (jsonb_typeof(details) = 'object'::text),
  CONSTRAINT company_setups_revision_check CHECK (revision > 0),
  CONSTRAINT company_setups_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT company_setups_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.correction_bundles (
  book_id text NOT NULL,
  id text NOT NULL,
  original_voucher_id text NOT NULL,
  reversal_change_set_id text NOT NULL,
  replacement_change_set_id text NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT correction_bundles_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT correction_bundles_book_id_replacement_change_set_id_key UNIQUE (book_id, replacement_change_set_id),
  CONSTRAINT correction_bundles_book_id_reversal_change_set_id_key UNIQUE (book_id, reversal_change_set_id),
  CONSTRAINT correction_bundles_check CHECK (reversal_change_set_id <> replacement_change_set_id),
  CONSTRAINT correction_bundles_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT correction_bundles_book_id_original_voucher_id_fkey FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT correction_bundles_book_id_replacement_change_set_id_fkey FOREIGN KEY (book_id, replacement_change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT correction_bundles_book_id_reversal_change_set_id_fkey FOREIGN KEY (book_id, reversal_change_set_id) REFERENCES openerp.change_sets(book_id, id)
);
CREATE TABLE openerp.correction_bundle_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  bundle_id text NOT NULL,
  reversal_approval_id text NOT NULL,
  replacement_approval_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT correction_bundle_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT correction_bundle_approvals_book_id_bundle_id_id_key UNIQUE (book_id, bundle_id, id),
  CONSTRAINT correction_bundle_approvals_book_id_bundle_id_fkey FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundles(book_id, id),
  CONSTRAINT correction_bundle_approvals_book_id_replacement_approval_i_fkey FOREIGN KEY (book_id, replacement_approval_id) REFERENCES openerp.approvals(book_id, id),
  CONSTRAINT correction_bundle_approvals_book_id_reversal_approval_id_fkey FOREIGN KEY (book_id, reversal_approval_id) REFERENCES openerp.approvals(book_id, id)
);
CREATE TABLE openerp.correction_bundle_receipts (
  book_id text NOT NULL,
  bundle_id text NOT NULL,
  original_voucher_id text NOT NULL,
  approval_id text NOT NULL,
  reversal_receipt_id text NOT NULL,
  replacement_receipt_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT correction_bundle_receipts_pkey PRIMARY KEY (book_id, bundle_id),
  CONSTRAINT correction_bundle_receipts_book_id_original_voucher_id_key UNIQUE (book_id, original_voucher_id),
  CONSTRAINT correction_bundle_receipts_book_id_replacement_receipt_id_key UNIQUE (book_id, replacement_receipt_id),
  CONSTRAINT correction_bundle_receipts_book_id_reversal_receipt_id_key UNIQUE (book_id, reversal_receipt_id),
  CONSTRAINT correction_bundle_receipts_book_id_bundle_id_approval_id_fkey FOREIGN KEY (book_id, bundle_id, approval_id) REFERENCES openerp.correction_bundle_approvals(book_id, bundle_id, id),
  CONSTRAINT correction_bundle_receipts_book_id_bundle_id_fkey FOREIGN KEY (book_id, bundle_id) REFERENCES openerp.correction_bundles(book_id, id),
  CONSTRAINT correction_bundle_receipts_book_id_original_voucher_id_fkey FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT correction_bundle_receipts_book_id_replacement_receipt_id_fkey FOREIGN KEY (book_id, replacement_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT correction_bundle_receipts_book_id_reversal_receipt_id_fkey FOREIGN KEY (book_id, reversal_receipt_id) REFERENCES openerp.execution_receipts(book_id, id)
);
CREATE TABLE openerp.correction_impact_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  voucher_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT correction_impact_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT correction_impact_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT correction_impact_reviews_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.credentials (
  token_hash text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT credentials_pkey PRIMARY KEY (token_hash),
  CONSTRAINT credentials_token_hash_check CHECK (token_hash ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT credentials_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.crm_party_annotations (
  book_id text NOT NULL,
  party_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  detail text NOT NULL,
  evidence_id text NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_party_annotations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT crm_party_annotations_detail_check CHECK (length(detail) >= 1 AND length(detail) <= 2000),
  CONSTRAINT crm_party_annotations_kind_check CHECK (kind = ANY (ARRAY['contact'::text, 'alias'::text, 'registry_provenance'::text])),
  CONSTRAINT crm_party_annotations_label_check CHECK (length(label) >= 1 AND length(label) <= 200),
  CONSTRAINT crm_party_annotations_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT crm_party_annotations_book_id_party_id_fkey FOREIGN KEY (book_id, party_id) REFERENCES openerp.commerce_counterparties(book_id, id),
  CONSTRAINT crm_party_annotations_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.deadline_obligations (
  book_id text NOT NULL,
  id text NOT NULL,
  title text NOT NULL,
  period_id text NOT NULL,
  responsible_actor_id text NOT NULL,
  due_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  source_reference text NOT NULL,
  source_revision text NOT NULL,
  override_reason text,
  outcome_kind text NOT NULL,
  outcome_reference text,
  outcome_at timestamptz,
  reminder_dismissed_at timestamptz,
  revision bigint DEFAULT 1 NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT deadline_obligations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT deadline_obligations_check CHECK ((outcome_reference IS NULL) = (outcome_at IS NULL)),
  CONSTRAINT deadline_obligations_outcome_kind_check CHECK (outcome_kind = ANY (ARRAY['prepared'::text, 'submitted'::text, 'accepted'::text])),
  CONSTRAINT deadline_obligations_outcome_reference_check CHECK (outcome_reference IS NULL OR length(outcome_reference) >= 1 AND length(outcome_reference) <= 500),
  CONSTRAINT deadline_obligations_override_reason_check CHECK (length(override_reason) >= 1 AND length(override_reason) <= 1000),
  CONSTRAINT deadline_obligations_revision_check CHECK (revision > 0),
  CONSTRAINT deadline_obligations_source_reference_check CHECK (length(source_reference) >= 1 AND length(source_reference) <= 1000),
  CONSTRAINT deadline_obligations_source_revision_check CHECK (length(source_revision) >= 1 AND length(source_revision) <= 120),
  CONSTRAINT deadline_obligations_time_zone_check CHECK (length(time_zone) >= 1 AND length(time_zone) <= 100),
  CONSTRAINT deadline_obligations_title_check CHECK (length(title) >= 1 AND length(title) <= 240),
  CONSTRAINT deadline_obligations_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT deadline_obligations_book_id_period_id_fkey FOREIGN KEY (book_id, period_id) REFERENCES openerp.periods(book_id, id),
  CONSTRAINT deadline_obligations_responsible_actor_id_fkey FOREIGN KEY (responsible_actor_id) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.deadline_activity_history (
  book_id text NOT NULL,
  obligation_id text NOT NULL,
  id text NOT NULL,
  action text NOT NULL,
  reference text,
  outcome_kind text,
  recorded_by text NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT deadline_activity_history_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT deadline_activity_history_action_check CHECK (action = ANY (ARRAY['dismiss_reminder'::text, 'record_outcome'::text])),
  CONSTRAINT deadline_activity_history_check CHECK (action = 'record_outcome'::text AND reference IS NOT NULL AND outcome_kind IS NOT NULL OR action = 'dismiss_reminder'::text AND reference IS NULL AND outcome_kind IS NULL),
  CONSTRAINT deadline_activity_history_outcome_kind_check CHECK (outcome_kind IS NULL OR outcome_kind = ANY (ARRAY['prepared'::text, 'submitted'::text, 'accepted'::text])),
  CONSTRAINT deadline_activity_history_reference_check CHECK (reference IS NULL OR length(reference) >= 1 AND length(reference) <= 500),
  CONSTRAINT deadline_activity_history_book_id_obligation_id_fkey FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.deadline_obligations(book_id, id),
  CONSTRAINT deadline_activity_history_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.deadline_feeds (
  book_id text NOT NULL,
  id text NOT NULL,
  token_hash text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT deadline_feeds_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT deadline_feeds_token_hash_key UNIQUE (token_hash),
  CONSTRAINT deadline_feeds_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT deadline_feeds_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.deadline_revisions (
  book_id text NOT NULL,
  obligation_id text NOT NULL,
  revision bigint NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz DEFAULT now() NOT NULL,
  prior_due_at timestamptz,
  prior_source_reference text,
  prior_source_revision text,
  reason text NOT NULL,
  CONSTRAINT deadline_revisions_pkey PRIMARY KEY (book_id, obligation_id, revision),
  CONSTRAINT deadline_revisions_reason_check CHECK (length(reason) >= 1 AND length(reason) <= 1000),
  CONSTRAINT deadline_revisions_book_id_obligation_id_fkey FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.deadline_obligations(book_id, id),
  CONSTRAINT deadline_revisions_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.dimensions (
  book_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  archived_at timestamptz,
  current_revision integer DEFAULT 1 NOT NULL,
  CONSTRAINT dimensions_pkey PRIMARY KEY (book_id, code),
  CONSTRAINT dimensions_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT dimensions_code_check CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text),
  CONSTRAINT dimensions_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 100000),
  CONSTRAINT dimensions_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 120),
  CONSTRAINT dimensions_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.dimension_revisions (
  book_id text NOT NULL,
  code text NOT NULL,
  revision integer NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  archived_at timestamptz,
  CONSTRAINT dimension_revisions_pkey PRIMARY KEY (book_id, code, revision),
  CONSTRAINT dimension_revisions_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT dimension_revisions_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 120),
  CONSTRAINT dimension_revisions_revision_check CHECK (revision >= 1 AND revision <= 100000),
  CONSTRAINT dimension_revisions_book_id_code_fkey FOREIGN KEY (book_id, code) REFERENCES openerp.dimensions(book_id, code)
);
CREATE TABLE openerp.dimension_values (
  book_id text NOT NULL,
  dimension_code text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  archived_at timestamptz,
  current_revision integer DEFAULT 1 NOT NULL,
  CONSTRAINT dimension_values_pkey PRIMARY KEY (book_id, dimension_code, code),
  CONSTRAINT dimension_values_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT dimension_values_code_check CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'::text),
  CONSTRAINT dimension_values_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 100000),
  CONSTRAINT dimension_values_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 120),
  CONSTRAINT dimension_values_book_id_dimension_code_fkey FOREIGN KEY (book_id, dimension_code) REFERENCES openerp.dimensions(book_id, code)
);
CREATE TABLE openerp.dimension_value_revisions (
  book_id text NOT NULL,
  dimension_code text NOT NULL,
  code text NOT NULL,
  revision integer NOT NULL,
  name text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  archived_at timestamptz,
  CONSTRAINT dimension_value_revisions_pkey PRIMARY KEY (book_id, dimension_code, code, revision),
  CONSTRAINT dimension_value_revisions_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT dimension_value_revisions_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 120),
  CONSTRAINT dimension_value_revisions_revision_check CHECK (revision >= 1 AND revision <= 100000),
  CONSTRAINT dimension_value_revisions_book_id_dimension_code_code_fkey FOREIGN KEY (book_id, dimension_code, code) REFERENCES openerp.dimension_values(book_id, dimension_code, code)
);
CREATE TABLE openerp.exchange_conversion_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  observation_id text NOT NULL,
  revision integer NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT exchange_conversion_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT exchange_conversion_reviews_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 1048576),
  CONSTRAINT exchange_conversion_reviews_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT exchange_conversion_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT exchange_conversion_reviews_book_id_observation_id_revisio_fkey FOREIGN KEY (book_id, observation_id, revision) REFERENCES openerp.exchange_rate_revisions(book_id, observation_id, revision)
);
CREATE TABLE openerp.exchange_rate_withdrawals (
  book_id text NOT NULL,
  observation_id text NOT NULL,
  id text NOT NULL,
  revision integer NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT exchange_rate_withdrawals_pkey PRIMARY KEY (book_id, observation_id),
  CONSTRAINT exchange_rate_withdrawals_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT exchange_rate_withdrawals_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT exchange_rate_withdrawals_check1 CHECK (NOT body ->> 'observationId'::text IS DISTINCT FROM observation_id),
  CONSTRAINT exchange_rate_withdrawals_check2 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT exchange_rate_withdrawals_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT exchange_rate_withdrawals_book_id_observation_id_revision_fkey FOREIGN KEY (book_id, observation_id, revision) REFERENCES openerp.exchange_rate_revisions(book_id, observation_id, revision)
);
CREATE TABLE openerp.expense_tax_sources (
  book_id text NOT NULL,
  id text NOT NULL,
  source_key text NOT NULL,
  record_class text NOT NULL,
  CONSTRAINT expense_tax_sources_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT expense_tax_sources_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT expense_tax_sources_record_class_check CHECK (record_class = ANY (ARRAY['actual_company'::text, 'synthetic'::text])),
  CONSTRAINT expense_tax_sources_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.expense_tax_source_revisions (
  book_id text NOT NULL,
  source_id text NOT NULL,
  revision integer NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  change_set_id text,
  voucher_id text,
  body jsonb NOT NULL,
  CONSTRAINT expense_tax_source_revisions_pkey PRIMARY KEY (book_id, source_id, revision),
  CONSTRAINT expense_tax_source_revisions_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT expense_tax_source_revisions_revision_check CHECK (revision >= 1 AND revision <= 20),
  CONSTRAINT expense_tax_source_revisions_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT expense_tax_source_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT expense_tax_source_revisions_book_id_source_id_fkey FOREIGN KEY (book_id, source_id) REFERENCES openerp.expense_tax_sources(book_id, id),
  CONSTRAINT expense_tax_source_revisions_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.expense_tax_reviews (
  book_id text NOT NULL,
  source_id text NOT NULL,
  revision integer NOT NULL,
  source_revision integer NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT expense_tax_reviews_pkey PRIMARY KEY (book_id, source_id, revision),
  CONSTRAINT expense_tax_reviews_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT expense_tax_reviews_revision_check CHECK (revision >= 1 AND revision <= 100),
  CONSTRAINT expense_tax_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT expense_tax_reviews_book_id_source_id_source_revision_fkey FOREIGN KEY (book_id, source_id, source_revision) REFERENCES openerp.expense_tax_source_revisions(book_id, source_id, revision)
);
CREATE TABLE openerp.expense_tax_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT expense_tax_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT expense_tax_snapshots_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT expense_tax_snapshots_ordinal_check CHECK (ordinal >= 1 AND ordinal <= '999999999999999999'::bigint),
  CONSTRAINT expense_tax_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.expense_tax_source_withdrawals (
  book_id text NOT NULL,
  source_id text NOT NULL,
  revision integer NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT expense_tax_source_withdrawals_pkey PRIMARY KEY (book_id, source_id),
  CONSTRAINT expense_tax_source_withdrawals_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT expense_tax_source_withdrawals_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT expense_tax_source_withdrawals_check1 CHECK (NOT body ->> 'sourceId'::text IS DISTINCT FROM source_id),
  CONSTRAINT expense_tax_source_withdrawals_check2 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT expense_tax_source_withdrawals_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT expense_tax_source_withdrawals_book_id_source_id_revision_fkey FOREIGN KEY (book_id, source_id, revision) REFERENCES openerp.expense_tax_source_revisions(book_id, source_id, revision)
);
CREATE TABLE openerp.firms (
  id text NOT NULL,
  name text NOT NULL,
  revision integer DEFAULT 1 NOT NULL,
  created_by text NOT NULL,
  CONSTRAINT firms_pkey PRIMARY KEY (id),
  CONSTRAINT firms_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 100),
  CONSTRAINT firms_revision_check CHECK (revision > 0),
  CONSTRAINT firms_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.firm_clients (
  firm_id text NOT NULL,
  book_id text NOT NULL,
  lead_id text,
  next_review_on date,
  note text NOT NULL,
  revision integer NOT NULL,
  CONSTRAINT firm_clients_pkey PRIMARY KEY (firm_id, book_id),
  CONSTRAINT firm_clients_note_check CHECK (length(note) <= 2000),
  CONSTRAINT firm_clients_revision_check CHECK (revision > 0),
  CONSTRAINT firm_clients_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT firm_clients_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES openerp.firms(id)
);
CREATE TABLE openerp.firm_commands (
  actor_id text NOT NULL,
  key text NOT NULL,
  firm_id text NOT NULL,
  operation text NOT NULL,
  payload jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT firm_commands_pkey PRIMARY KEY (actor_id, key),
  CONSTRAINT firm_commands_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT firm_commands_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES openerp.firms(id)
);
CREATE TABLE openerp.firm_members (
  firm_id text NOT NULL,
  actor_id text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL,
  revision integer NOT NULL,
  CONSTRAINT firm_members_pkey PRIMARY KEY (firm_id, actor_id),
  CONSTRAINT firm_members_revision_check CHECK (revision > 0),
  CONSTRAINT firm_members_role_check CHECK (role = ANY (ARRAY['admin'::text, 'accountant'::text])),
  CONSTRAINT firm_members_firm_id_fkey FOREIGN KEY (firm_id) REFERENCES openerp.firms(id)
);
CREATE TABLE openerp.sie_source_previews (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_source_previews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_source_previews_book_id_occurrence_id_ordinal_key UNIQUE (book_id, occurrence_id, ordinal),
  CONSTRAINT sie_source_previews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT sie_source_previews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sie_source_previews_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id)
);
CREATE TABLE openerp.sie_source_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  preview_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_source_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_source_plans_book_id_preview_id_key UNIQUE (book_id, preview_id),
  CONSTRAINT sie_source_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sie_source_plans_book_id_preview_id_fkey FOREIGN KEY (book_id, preview_id) REFERENCES openerp.sie_source_previews(book_id, id)
);
CREATE TABLE openerp.historical_bases (
  book_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  mode text NOT NULL,
  cutover_on date NOT NULL,
  source_plan_id text NOT NULL,
  source_digest text NOT NULL,
  change_set_id text,
  opening_voucher_id text,
  control jsonb NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT historical_bases_pkey PRIMARY KEY (book_id, fiscal_year_id),
  CONSTRAINT historical_bases_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT historical_bases_check CHECK (mode = 'full_history'::text AND change_set_id IS NULL AND opening_voucher_id IS NULL OR mode = 'opening_set'::text AND change_set_id IS NOT NULL),
  CONSTRAINT historical_bases_mode_check CHECK (mode = ANY (ARRAY['full_history'::text, 'opening_set'::text])),
  CONSTRAINT historical_bases_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT historical_bases_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT historical_bases_book_id_opening_voucher_id_fkey FOREIGN KEY (book_id, opening_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT historical_bases_book_id_source_plan_id_fkey FOREIGN KEY (book_id, source_plan_id) REFERENCES openerp.sie_source_plans(book_id, id)
);
CREATE TABLE openerp.historical_item_admissions (
  book_id text NOT NULL,
  id text NOT NULL,
  source_plan_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT historical_item_admissions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT historical_item_admissions_book_id_source_plan_id_key UNIQUE (book_id, source_plan_id),
  CONSTRAINT historical_item_admissions_book_id_source_plan_id_fkey FOREIGN KEY (book_id, source_plan_id) REFERENCES openerp.sie_source_plans(book_id, id)
);
CREATE TABLE openerp.historical_items (
  book_id text NOT NULL,
  admission_id text NOT NULL,
  source_identity text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT historical_items_pkey PRIMARY KEY (book_id, admission_id, source_identity),
  CONSTRAINT historical_items_book_id_admission_id_fkey FOREIGN KEY (book_id, admission_id) REFERENCES openerp.historical_item_admissions(book_id, id)
);
CREATE TABLE openerp.historical_matches (
  book_id text NOT NULL,
  admission_id text NOT NULL,
  source_identity text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT historical_matches_pkey PRIMARY KEY (book_id, admission_id, source_identity),
  CONSTRAINT historical_matches_book_id_admission_id_fkey FOREIGN KEY (book_id, admission_id) REFERENCES openerp.historical_item_admissions(book_id, id)
);
CREATE TABLE openerp.historical_payments (
  book_id text NOT NULL,
  admission_id text NOT NULL,
  source_identity text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT historical_payments_pkey PRIMARY KEY (book_id, admission_id, source_identity),
  CONSTRAINT historical_payments_book_id_admission_id_fkey FOREIGN KEY (book_id, admission_id) REFERENCES openerp.historical_item_admissions(book_id, id)
);
CREATE TABLE openerp.identity_admissions (
  actor_id text NOT NULL,
  provider_id text NOT NULL,
  subject text NOT NULL,
  enabled boolean NOT NULL,
  CONSTRAINT identity_admissions_pkey PRIMARY KEY (actor_id),
  CONSTRAINT identity_admissions_provider_id_subject_key UNIQUE (provider_id, subject)
);
CREATE TABLE openerp.identity_provisioning_receipts (
  request_id text NOT NULL,
  manifest jsonb NOT NULL,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT identity_provisioning_receipts_pkey PRIMARY KEY (request_id)
);
CREATE TABLE openerp.intake_previews (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT intake_previews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT intake_previews_book_id_occurrence_id_ordinal_key UNIQUE (book_id, occurrence_id, ordinal),
  CONSTRAINT intake_previews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT intake_previews_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id)
);
CREATE TABLE openerp.intake_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  preview_id text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT intake_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT intake_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT intake_approvals_book_id_preview_id_fkey FOREIGN KEY (book_id, preview_id) REFERENCES openerp.intake_previews(book_id, id)
);
CREATE TABLE openerp.intake_admissions (
  book_id text NOT NULL,
  occurrence_id text NOT NULL,
  preview_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT intake_admissions_pkey PRIMARY KEY (book_id, occurrence_id),
  CONSTRAINT intake_admissions_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.intake_approvals(book_id, id),
  CONSTRAINT intake_admissions_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id),
  CONSTRAINT intake_admissions_book_id_preview_id_fkey FOREIGN KEY (book_id, preview_id) REFERENCES openerp.intake_previews(book_id, id)
);
CREATE TABLE openerp.intake_preview_supersessions (
  book_id text NOT NULL,
  previous_preview_id text NOT NULL,
  replacement_preview_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT intake_preview_supersessions_pkey PRIMARY KEY (book_id, previous_preview_id),
  CONSTRAINT intake_preview_supersessions_book_id_replacement_preview_id_key UNIQUE (book_id, replacement_preview_id),
  CONSTRAINT intake_preview_supersessions_check CHECK (previous_preview_id <> replacement_preview_id),
  CONSTRAINT intake_preview_supersessions_book_id_previous_preview_id_fkey FOREIGN KEY (book_id, previous_preview_id) REFERENCES openerp.intake_previews(book_id, id),
  CONSTRAINT intake_preview_supersessions_book_id_replacement_preview_i_fkey FOREIGN KEY (book_id, replacement_preview_id) REFERENCES openerp.intake_previews(book_id, id)
);
CREATE TABLE openerp.invoice_issue_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_issue_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_issue_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT invoice_issue_reviews_book_id_draft_id_ordinal_key UNIQUE (book_id, draft_id, ordinal),
  CONSTRAINT invoice_issue_reviews_book_id_id_draft_id_draft_revision_key UNIQUE (book_id, id, draft_id, draft_revision),
  CONSTRAINT invoice_issue_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT invoice_issue_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT invoice_issue_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT invoice_issue_reviews_book_id_draft_id_draft_revision_fkey FOREIGN KEY (book_id, draft_id, draft_revision) REFERENCES openerp.invoice_draft_revisions(book_id, draft_id, revision),
  CONSTRAINT invoice_issue_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT invoice_issue_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.invoice_issue_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_issue_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_issue_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT invoice_issue_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT invoice_issue_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT invoice_issue_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_issue_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.invoice_issue_reviews(book_id, id)
);
CREATE TABLE openerp.invoice_issues (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  internal_number bigint NOT NULL,
  posting_receipt_id text NOT NULL,
  register_invoice_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_issues_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_issues_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT invoice_issues_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT invoice_issues_book_id_internal_number_key UNIQUE (book_id, internal_number),
  CONSTRAINT invoice_issues_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT invoice_issues_book_id_register_invoice_id_key UNIQUE (book_id, register_invoice_id),
  CONSTRAINT invoice_issues_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT invoice_issues_internal_number_check CHECK (internal_number > 0),
  CONSTRAINT invoice_issues_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.invoice_issue_approvals(book_id, id, review_id),
  CONSTRAINT invoice_issues_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT invoice_issues_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT invoice_issues_book_id_review_id_draft_id_draft_revision_fkey FOREIGN KEY (book_id, review_id, draft_id, draft_revision) REFERENCES openerp.invoice_issue_reviews(book_id, id, draft_id, draft_revision)
);
CREATE TABLE openerp.invoice_cancellation_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  issue_id text NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_cancellation_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_cancellation_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT invoice_cancellation_reviews_book_id_issue_id_ordinal_key UNIQUE (book_id, issue_id, ordinal),
  CONSTRAINT invoice_cancellation_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT invoice_cancellation_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT invoice_cancellation_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT invoice_cancellation_reviews_book_id_issue_id_fkey FOREIGN KEY (book_id, issue_id) REFERENCES openerp.invoice_issues(book_id, id)
);
CREATE TABLE openerp.invoice_cancellation_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_cancellation_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_cancellation_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT invoice_cancellation_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT invoice_cancellation_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT invoice_cancellation_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_cancellation_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.invoice_cancellation_reviews(book_id, id)
);
CREATE TABLE openerp.invoice_cancellations (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  issue_id text NOT NULL,
  register_invoice_id text NOT NULL,
  original_voucher_id text NOT NULL,
  reversal_voucher_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  posting_date date NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_cancellations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_cancellations_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT invoice_cancellations_book_id_issue_id_key UNIQUE (book_id, issue_id),
  CONSTRAINT invoice_cancellations_book_id_original_voucher_id_key UNIQUE (book_id, original_voucher_id),
  CONSTRAINT invoice_cancellations_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT invoice_cancellations_book_id_register_invoice_id_key UNIQUE (book_id, register_invoice_id),
  CONSTRAINT invoice_cancellations_book_id_reversal_voucher_id_key UNIQUE (book_id, reversal_voucher_id),
  CONSTRAINT invoice_cancellations_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT invoice_cancellations_book_id_issue_id_fkey FOREIGN KEY (book_id, issue_id) REFERENCES openerp.invoice_issues(book_id, id),
  CONSTRAINT invoice_cancellations_book_id_original_voucher_id_fkey FOREIGN KEY (book_id, original_voucher_id) REFERENCES openerp.vouchers(book_id, id),
  CONSTRAINT invoice_cancellations_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT invoice_cancellations_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT invoice_cancellations_book_id_reversal_voucher_id_fkey FOREIGN KEY (book_id, reversal_voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.invoice_cancellation_executions (
  book_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  CONSTRAINT invoice_cancellation_executions_pkey PRIMARY KEY (book_id, review_id),
  CONSTRAINT invoice_cancellation_executio_book_id_review_id_approval_id_key UNIQUE (book_id, review_id, approval_id),
  CONSTRAINT invoice_cancellation_executions_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT invoice_cancellation_executio_book_id_approval_id_review_i_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.invoice_cancellation_approvals(book_id, id, review_id),
  CONSTRAINT invoice_cancellation_execution_complete FOREIGN KEY (book_id, review_id) REFERENCES openerp.invoice_cancellations(book_id, review_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE openerp.invoice_cancellation_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_cancellation_revocations_pkey PRIMARY KEY (book_id, approval_id),
  CONSTRAINT invoice_cancellation_revocations_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.invoice_cancellation_approvals(book_id, id)
);
CREATE TABLE openerp.invoice_pdf_captures (
  book_id text NOT NULL,
  id text NOT NULL,
  issue_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_pdf_captures_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_pdf_captures_book_id_issue_id_key UNIQUE (book_id, issue_id),
  CONSTRAINT invoice_pdf_captures_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT invoice_pdf_captures_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_pdf_captures_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT invoice_pdf_captures_book_id_issue_id_fkey FOREIGN KEY (book_id, issue_id) REFERENCES openerp.invoice_issues(book_id, id)
);
CREATE TABLE openerp.invoice_pdf_artifacts (
  book_id text NOT NULL,
  capture_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT invoice_pdf_artifacts_pkey PRIMARY KEY (book_id, capture_id),
  CONSTRAINT invoice_pdf_artifacts_check CHECK (descriptor ->> 'captureId'::text = capture_id AND descriptor ->> 'sha256'::text = encode(sha256(content), 'hex'::text) AND (descriptor ->> 'byteLength'::text)::integer = octet_length(content)),
  CONSTRAINT invoice_pdf_artifacts_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 1048576),
  CONSTRAINT invoice_pdf_artifacts_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.invoice_pdf_captures(book_id, id)
);
CREATE TABLE openerp.invoice_delivery_requests (
  book_id text NOT NULL,
  id text NOT NULL,
  capture_id text NOT NULL,
  actor_id text NOT NULL,
  channel text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_delivery_requests_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_delivery_requests_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT invoice_delivery_requests_channel_check CHECK (channel = ANY (ARRAY['email'::text, 'peppol'::text, 'local_simulation'::text])),
  CONSTRAINT invoice_delivery_requests_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_delivery_requests_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.invoice_pdf_artifacts(book_id, capture_id),
  CONSTRAINT invoice_delivery_requests_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.invoice_delivery_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  request_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_delivery_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_delivery_approvals_book_id_request_id_key UNIQUE (book_id, request_id),
  CONSTRAINT invoice_delivery_approvals_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT invoice_delivery_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_delivery_approvals_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.invoice_delivery_requests(book_id, id)
);
CREATE TABLE openerp.invoice_delivery_attempts (
  book_id text NOT NULL,
  id text NOT NULL,
  request_id text NOT NULL,
  approval_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_delivery_attempts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_delivery_attempts_book_id_request_id_ordinal_key UNIQUE (book_id, request_id, ordinal),
  CONSTRAINT invoice_delivery_attempts_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT invoice_delivery_attempts_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT invoice_delivery_attempts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.invoice_delivery_approvals(book_id, id),
  CONSTRAINT invoice_delivery_attempts_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.invoice_delivery_requests(book_id, id)
);
CREATE TABLE openerp.invoice_delivery_resolutions (
  book_id text NOT NULL,
  id text NOT NULL,
  attempt_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_delivery_resolutions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_delivery_resolutions_book_id_attempt_id_key UNIQUE (book_id, attempt_id),
  CONSTRAINT invoice_delivery_resolutions_body_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT invoice_delivery_resolutions_book_id_attempt_id_fkey FOREIGN KEY (book_id, attempt_id) REFERENCES openerp.invoice_delivery_attempts(book_id, id)
);
CREATE TABLE openerp.invoice_document_captures (
  book_id text NOT NULL,
  id text NOT NULL,
  issue_id text NOT NULL,
  review_id text NOT NULL,
  generator_version text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT invoice_document_captures_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT invoice_document_captures_book_id_issue_id_generator_versio_key UNIQUE (book_id, issue_id, generator_version),
  CONSTRAINT invoice_document_captures_body_check CHECK (octet_length(body::text) <= 524288),
  CONSTRAINT invoice_document_captures_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT invoice_document_captures_check1 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT invoice_document_captures_check2 CHECK (NOT body -> 'input'::text ->> 'issueId'::text IS DISTINCT FROM issue_id),
  CONSTRAINT invoice_document_captures_check3 CHECK (NOT body -> 'source'::text -> 'issue'::text ->> 'id'::text IS DISTINCT FROM issue_id),
  CONSTRAINT invoice_document_captures_check4 CHECK (NOT body -> 'source'::text -> 'review'::text ->> 'id'::text IS DISTINCT FROM review_id),
  CONSTRAINT invoice_document_captures_check5 CHECK (NOT body ->> 'generatorVersion'::text IS DISTINCT FROM generator_version),
  CONSTRAINT invoice_document_captures_check6 CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM actor_id),
  CONSTRAINT invoice_document_captures_generator_version_check CHECK (generator_version = ANY (ARRAY['openerp-synthetic-invoice-html-v1'::text, 'openerp-synthetic-invoice-html-v2'::text])),
  CONSTRAINT invoice_document_captures_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT invoice_document_captures_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT invoice_document_captures_book_id_issue_id_fkey FOREIGN KEY (book_id, issue_id) REFERENCES openerp.invoice_issues(book_id, id),
  CONSTRAINT invoice_document_captures_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.invoice_issue_reviews(book_id, id)
);
CREATE TABLE openerp.invoice_document_artifacts (
  book_id text NOT NULL,
  capture_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT invoice_document_artifacts_pkey PRIMARY KEY (book_id, capture_id),
  CONSTRAINT invoice_document_artifacts_check CHECK (NOT descriptor ->> 'captureId'::text IS DISTINCT FROM capture_id),
  CONSTRAINT invoice_document_artifacts_check1 CHECK (NOT descriptor -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT invoice_document_artifacts_check2 CHECK (NOT descriptor ->> 'sha256'::text IS DISTINCT FROM encode(sha256(content), 'hex'::text)),
  CONSTRAINT invoice_document_artifacts_check3 CHECK (NOT (descriptor ->> 'byteLength'::text)::integer IS DISTINCT FROM octet_length(content)),
  CONSTRAINT invoice_document_artifacts_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 1048576),
  CONSTRAINT invoice_document_artifacts_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.invoice_document_captures(book_id, id)
);
CREATE TABLE openerp.invoice_issue_counters (
  book_id text NOT NULL,
  last_number bigint NOT NULL,
  CONSTRAINT invoice_issue_counters_pkey PRIMARY KEY (book_id),
  CONSTRAINT invoice_issue_counters_last_number_check CHECK (last_number >= 1 AND last_number <= '999999999999999999'::bigint),
  CONSTRAINT invoice_issue_counters_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.memberships (
  book_id text NOT NULL,
  actor_id text NOT NULL,
  role text NOT NULL,
  CONSTRAINT memberships_pkey PRIMARY KEY (book_id, actor_id),
  CONSTRAINT memberships_role_check CHECK (role = ANY (ARRAY['operator'::text, 'agent'::text])),
  CONSTRAINT memberships_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT memberships_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.outbox (
  book_id text NOT NULL,
  id text NOT NULL,
  receipt_id text NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  delivered_at timestamptz,
  attempts integer DEFAULT 0 NOT NULL,
  CONSTRAINT outbox_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT outbox_book_id_receipt_id_kind_key UNIQUE (book_id, receipt_id, kind),
  CONSTRAINT outbox_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.execution_receipts(book_id, id)
);
CREATE TABLE openerp.owner_allocation_plans (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_allocation_plans_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_allocation_plans_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.owner_allocation_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_allocation_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_allocation_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT owner_allocation_approvals_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.owner_allocation_plans(book_id, id)
);
CREATE TABLE openerp.owner_control_accounts (
  book_id text NOT NULL,
  account_id text NOT NULL,
  CONSTRAINT owner_control_accounts_pkey PRIMARY KEY (book_id, account_id),
  CONSTRAINT owner_control_accounts_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id)
);
CREATE TABLE openerp.owner_parties (
  book_id text NOT NULL,
  id text NOT NULL,
  source_key text COLLATE "C" NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_parties_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_parties_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT owner_parties_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT owner_parties_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.owner_revisions (
  book_id text NOT NULL,
  record_id text NOT NULL,
  revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_revisions_pkey PRIMARY KEY (book_id, record_id, revision)
);
CREATE TABLE openerp.owner_records (
  book_id text NOT NULL,
  id text NOT NULL,
  owner_id text NOT NULL,
  source_key text COLLATE "C" NOT NULL,
  evidence_id text NOT NULL,
  locator text COLLATE "C" NOT NULL,
  occurred_on date NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  current_revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_records_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_records_book_id_evidence_id_locator_key UNIQUE (book_id, evidence_id, locator),
  CONSTRAINT owner_records_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT owner_records_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT owner_records_current_revision_check CHECK (current_revision > 0),
  CONSTRAINT owner_records_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT owner_records_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.owner_revisions(book_id, record_id, revision) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT owner_records_book_id_owner_id_fkey FOREIGN KEY (book_id, owner_id) REFERENCES openerp.owner_parties(book_id, id)
);
CREATE TABLE openerp.owner_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  record_id text NOT NULL,
  revision bigint NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_reviews_book_id_record_id_revision_key UNIQUE (book_id, record_id, revision),
  CONSTRAINT owner_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT owner_reviews_book_id_record_id_revision_fkey FOREIGN KEY (book_id, record_id, revision) REFERENCES openerp.owner_revisions(book_id, record_id, revision)
);
CREATE TABLE openerp.owner_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  record_id text NOT NULL,
  owner_id text NOT NULL,
  review_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  account_id text NOT NULL,
  posting_date date NOT NULL,
  side text NOT NULL,
  classification text NOT NULL,
  origin text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_effects_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_effects_book_id_record_id_key UNIQUE (book_id, record_id),
  CONSTRAINT owner_effects_book_id_voucher_id_line_id_key UNIQUE (book_id, voucher_id, line_id),
  CONSTRAINT owner_effects_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT owner_effects_origin_check CHECK (origin = ANY (ARRAY['opening'::text, 'current'::text])),
  CONSTRAINT owner_effects_side_check CHECK (side = ANY (ARRAY['debit'::text, 'credit'::text])),
  CONSTRAINT owner_effects_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.owner_control_accounts(book_id, account_id),
  CONSTRAINT owner_effects_book_id_owner_id_fkey FOREIGN KEY (book_id, owner_id) REFERENCES openerp.owner_parties(book_id, id),
  CONSTRAINT owner_effects_book_id_record_id_fkey FOREIGN KEY (book_id, record_id) REFERENCES openerp.owner_records(book_id, id),
  CONSTRAINT owner_effects_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.owner_reviews(book_id, id),
  CONSTRAINT owner_effects_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.owner_allocation_receipts (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  approval_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_allocation_receipts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_allocation_receipts_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT owner_allocation_receipts_book_id_plan_id_key UNIQUE (book_id, plan_id),
  CONSTRAINT owner_allocation_receipts_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.owner_allocation_approvals(book_id, id),
  CONSTRAINT owner_allocation_receipts_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.owner_allocation_plans(book_id, id)
);
CREATE TABLE openerp.owner_allocation_legs (
  book_id text NOT NULL,
  receipt_id text NOT NULL,
  ordinal integer NOT NULL,
  claim_id text NOT NULL,
  settlement_id text NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  CONSTRAINT owner_allocation_legs_pkey PRIMARY KEY (book_id, receipt_id, ordinal),
  CONSTRAINT owner_allocation_legs_book_id_receipt_id_claim_id_key UNIQUE (book_id, receipt_id, claim_id),
  CONSTRAINT owner_allocation_legs_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT owner_allocation_legs_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT owner_allocation_legs_book_id_claim_id_fkey FOREIGN KEY (book_id, claim_id) REFERENCES openerp.owner_effects(book_id, id),
  CONSTRAINT owner_allocation_legs_book_id_receipt_id_fkey FOREIGN KEY (book_id, receipt_id) REFERENCES openerp.owner_allocation_receipts(book_id, id),
  CONSTRAINT owner_allocation_legs_book_id_settlement_id_fkey FOREIGN KEY (book_id, settlement_id) REFERENCES openerp.owner_effects(book_id, id)
);
CREATE TABLE openerp.owner_controls (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_controls_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_controls_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.owner_proposal_links (
  book_id text NOT NULL,
  id text NOT NULL,
  record_id text NOT NULL,
  review_id text NOT NULL,
  change_set_id text NOT NULL,
  line_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT owner_proposal_links_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT owner_proposal_links_book_id_change_set_id_line_id_key UNIQUE (book_id, change_set_id, line_id),
  CONSTRAINT owner_proposal_links_book_id_record_id_change_set_id_key UNIQUE (book_id, record_id, change_set_id),
  CONSTRAINT owner_proposal_links_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT owner_proposal_links_book_id_record_id_fkey FOREIGN KEY (book_id, record_id) REFERENCES openerp.owner_records(book_id, id),
  CONSTRAINT owner_proposal_links_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.owner_reviews(book_id, id)
);
CREATE TABLE openerp.payroll_access (
  book_id text NOT NULL,
  actor_id text NOT NULL,
  granted_by text NOT NULL,
  granted_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT payroll_access_pkey PRIMARY KEY (book_id, actor_id),
  CONSTRAINT payroll_access_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT payroll_access_book_id_actor_id_fkey FOREIGN KEY (book_id, actor_id) REFERENCES openerp.memberships(book_id, actor_id) ON DELETE CASCADE,
  CONSTRAINT payroll_access_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT payroll_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.payroll_employees (
  book_id text NOT NULL,
  id text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT payroll_employees_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT payroll_employees_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.payroll_revisions (
  book_id text NOT NULL,
  id text NOT NULL,
  command_key text NOT NULL,
  employee_id text NOT NULL,
  kind text NOT NULL,
  effective_on date NOT NULL,
  supersedes text,
  body jsonb NOT NULL,
  evidence_id text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT payroll_revisions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT payroll_revision_logical_id UNIQUE (book_id, employee_id, kind, effective_on, id),
  CONSTRAINT payroll_revisions_book_id_command_key_key UNIQUE (book_id, command_key),
  CONSTRAINT payroll_revisions_book_id_supersedes_key UNIQUE (book_id, supersedes),
  CONSTRAINT payroll_revisions_body_check CHECK (jsonb_typeof(body) = 'object'::text AND body <> '{}'::jsonb),
  CONSTRAINT payroll_revisions_evidence_id_check CHECK (length(evidence_id) > 0),
  CONSTRAINT payroll_revisions_kind_check CHECK (kind = ANY (ARRAY['employment'::text, 'work'::text, 'opening'::text])),
  CONSTRAINT payroll_revision_evidence_fk FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT payroll_revision_predecessor_fk FOREIGN KEY (book_id, employee_id, kind, effective_on, supersedes) REFERENCES openerp.payroll_revisions(book_id, employee_id, kind, effective_on, id),
  CONSTRAINT payroll_revisions_book_id_employee_id_fkey FOREIGN KEY (book_id, employee_id) REFERENCES openerp.payroll_employees(book_id, id),
  CONSTRAINT payroll_revisions_book_id_supersedes_fkey FOREIGN KEY (book_id, supersedes) REFERENCES openerp.payroll_revisions(book_id, id),
  CONSTRAINT payroll_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.payroll_current_revisions (
  book_id text NOT NULL,
  employee_id text NOT NULL,
  kind text NOT NULL,
  effective_on date NOT NULL,
  revision_id text NOT NULL,
  CONSTRAINT payroll_current_revisions_pkey PRIMARY KEY (book_id, employee_id, kind, effective_on),
  CONSTRAINT payroll_current_revisions_kind_check CHECK (kind = ANY (ARRAY['employment'::text, 'work'::text, 'opening'::text])),
  CONSTRAINT payroll_current_revisions_book_id_employee_id_fkey FOREIGN KEY (book_id, employee_id) REFERENCES openerp.payroll_employees(book_id, id),
  CONSTRAINT payroll_current_revisions_book_id_employee_id_kind_effecti_fkey FOREIGN KEY (book_id, employee_id, kind, effective_on, revision_id) REFERENCES openerp.payroll_revisions(book_id, employee_id, kind, effective_on, id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE openerp.posting_approval_revocations (
  book_id text NOT NULL,
  approval_id text NOT NULL,
  actor_id text NOT NULL,
  reason text NOT NULL,
  revoked_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT posting_approval_revocations_pkey PRIMARY KEY (book_id, approval_id),
  CONSTRAINT posting_approval_revocations_reason_check CHECK (length(reason) >= 1 AND length(reason) <= 2000),
  CONSTRAINT posting_approval_revocations_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT posting_approval_revocations_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.approvals(book_id, id)
);
CREATE TABLE openerp.posting_saved_requests (
  book_id text NOT NULL,
  key text NOT NULL,
  actor_id text NOT NULL,
  command jsonb NOT NULL,
  digest text NOT NULL,
  command_key text NOT NULL,
  saved_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT posting_saved_requests_pkey PRIMARY KEY (book_id, key),
  CONSTRAINT posting_saved_requests_book_id_command_key_key UNIQUE (book_id, command_key),
  CONSTRAINT posting_saved_requests_key_check CHECK (key ~ '^[a-zA-Z0-9_-]{8,128}$'::text),
  CONSTRAINT posting_saved_requests_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT posting_saved_requests_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.posting_request_outcomes (
  book_id text NOT NULL,
  key text NOT NULL,
  state text NOT NULL,
  result jsonb,
  refusal jsonb,
  recorded_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT posting_request_outcomes_pkey PRIMARY KEY (book_id, key),
  CONSTRAINT posting_request_outcomes_check CHECK (state = 'committed'::text AND result IS NOT NULL AND refusal IS NULL OR state = 'refused'::text AND result IS NULL AND refusal IS NOT NULL),
  CONSTRAINT posting_request_outcomes_state_check CHECK (state = ANY (ARRAY['committed'::text, 'refused'::text])),
  CONSTRAINT posting_request_outcomes_book_id_key_fkey FOREIGN KEY (book_id, key) REFERENCES openerp.posting_saved_requests(book_id, key)
);
CREATE TABLE openerp.recurring_rules (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT recurring_rules_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT recurring_rules_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.recurring_simulations (
  book_id text NOT NULL,
  id text NOT NULL,
  rule_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT recurring_simulations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT recurring_simulations_book_id_rule_id_fkey FOREIGN KEY (book_id, rule_id) REFERENCES openerp.recurring_rules(book_id, id)
);
CREATE TABLE openerp.recurring_activations (
  book_id text NOT NULL,
  id text NOT NULL,
  rule_id text NOT NULL,
  simulation_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT recurring_activations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT recurring_activations_book_id_rule_id_fkey FOREIGN KEY (book_id, rule_id) REFERENCES openerp.recurring_rules(book_id, id),
  CONSTRAINT recurring_activations_book_id_simulation_id_fkey FOREIGN KEY (book_id, simulation_id) REFERENCES openerp.recurring_simulations(book_id, id)
);
CREATE TABLE openerp.preparation_runs (
  book_id text NOT NULL,
  id text NOT NULL,
  rule_id text NOT NULL,
  activation_id text NOT NULL,
  selection jsonb NOT NULL,
  state text NOT NULL,
  cursor integer DEFAULT 0 NOT NULL,
  results jsonb DEFAULT '[]'::jsonb NOT NULL,
  blocker jsonb,
  CONSTRAINT preparation_runs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT preparation_runs_check CHECK (cursor <= jsonb_array_length(selection -> 'rows'::text)),
  CONSTRAINT preparation_runs_cursor_check CHECK (cursor >= 0),
  CONSTRAINT preparation_runs_state_check CHECK (state = ANY (ARRAY['ready'::text, 'blocked'::text, 'cancelled'::text, 'completed'::text])),
  CONSTRAINT preparation_runs_book_id_activation_id_fkey FOREIGN KEY (book_id, activation_id) REFERENCES openerp.recurring_activations(book_id, id),
  CONSTRAINT preparation_runs_book_id_rule_id_fkey FOREIGN KEY (book_id, rule_id) REFERENCES openerp.recurring_rules(book_id, id)
);
CREATE TABLE openerp.preparation_jobs (
  book_id text NOT NULL,
  id text NOT NULL,
  run_id text NOT NULL,
  requested_by text NOT NULL,
  executor_id text NOT NULL,
  credential_hash text,
  session_id text,
  expected_audit integer NOT NULL,
  checkpoint integer DEFAULT 0 NOT NULL,
  state text DEFAULT 'ready'::text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  checked_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT preparation_jobs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT preparation_jobs_check CHECK ((credential_hash IS NULL) <> (session_id IS NULL)),
  CONSTRAINT preparation_jobs_checkpoint_check CHECK (checkpoint >= 0 AND checkpoint <= 50),
  CONSTRAINT preparation_jobs_state_check CHECK (state = ANY (ARRAY['ready'::text, 'completed'::text, 'blocked'::text, 'stopped'::text])),
  CONSTRAINT preparation_jobs_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.preparation_runs(book_id, id),
  CONSTRAINT preparation_jobs_executor_id_fkey FOREIGN KEY (executor_id) REFERENCES openerp.actors(id),
  CONSTRAINT preparation_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.preparation_run_audit (
  book_id text NOT NULL,
  run_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT preparation_run_audit_pkey PRIMARY KEY (book_id, run_id, ordinal),
  CONSTRAINT preparation_run_audit_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.preparation_runs(book_id, id)
);
CREATE TABLE openerp.recurring_deactivations (
  book_id text NOT NULL,
  activation_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT recurring_deactivations_pkey PRIMARY KEY (book_id, activation_id),
  CONSTRAINT recurring_deactivations_book_id_activation_id_fkey FOREIGN KEY (book_id, activation_id) REFERENCES openerp.recurring_activations(book_id, id)
);
CREATE TABLE openerp.recurring_preparations (
  book_id text NOT NULL,
  statement_id text NOT NULL,
  row_ordinal integer NOT NULL,
  rule_id text NOT NULL,
  change_set_id text NOT NULL,
  CONSTRAINT recurring_preparations_pkey PRIMARY KEY (book_id, statement_id, row_ordinal),
  CONSTRAINT recurring_preparations_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT recurring_preparations_book_id_rule_id_fkey FOREIGN KEY (book_id, rule_id) REFERENCES openerp.recurring_rules(book_id, id),
  CONSTRAINT recurring_preparations_book_id_statement_id_row_ordinal_fkey FOREIGN KEY (book_id, statement_id, row_ordinal) REFERENCES openerp.bank_observations(book_id, statement_id, row_ordinal)
);
CREATE TABLE openerp.report_lines (
  book_id text NOT NULL,
  report_id text NOT NULL,
  account_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT report_lines_pkey PRIMARY KEY (book_id, report_id, account_id),
  CONSTRAINT report_lines_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT report_lines_book_id_report_id_fkey FOREIGN KEY (book_id, report_id) REFERENCES openerp.report_snapshots(book_id, id)
);
CREATE TABLE openerp.sales_documents (
  book_id text NOT NULL,
  id text NOT NULL,
  kind text NOT NULL,
  source_quote_id text,
  source_quote_revision bigint,
  current_revision bigint DEFAULT 1 NOT NULL,
  CONSTRAINT sales_documents_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sales_documents_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 50),
  CONSTRAINT sales_documents_kind_check CHECK (kind = ANY (ARRAY['quote'::text, 'order'::text])),
  CONSTRAINT sales_documents_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sales_documents_book_id_source_quote_id_fkey FOREIGN KEY (book_id, source_quote_id) REFERENCES openerp.sales_documents(book_id, id)
);
CREATE TABLE openerp.sales_document_revisions (
  book_id text NOT NULL,
  document_id text NOT NULL,
  revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sales_document_revisions_pkey PRIMARY KEY (book_id, document_id, revision),
  CONSTRAINT sales_document_revisions_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT sales_document_revisions_revision_check CHECK (revision >= 1 AND revision <= 50),
  CONSTRAINT sales_document_revisions_book_id_document_id_fkey FOREIGN KEY (book_id, document_id) REFERENCES openerp.sales_documents(book_id, id)
);
CREATE TABLE openerp.sales_order_conversions (
  book_id text NOT NULL,
  order_id text NOT NULL,
  draft_id text NOT NULL,
  order_revision bigint NOT NULL,
  portions jsonb NOT NULL,
  CONSTRAINT sales_order_conversions_pkey PRIMARY KEY (book_id, order_id, draft_id),
  CONSTRAINT sales_order_conversions_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT sales_order_conversions_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id),
  CONSTRAINT sales_order_conversions_book_id_order_id_fkey FOREIGN KEY (book_id, order_id) REFERENCES openerp.sales_documents(book_id, id)
);
CREATE TABLE openerp.series_counters (
  book_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  series text NOT NULL,
  last_number bigint DEFAULT 0 NOT NULL,
  CONSTRAINT series_counters_pkey PRIMARY KEY (book_id, fiscal_year_id, series),
  CONSTRAINT series_counters_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id)
);
CREATE TABLE openerp.sie_source_runs (
  book_id text NOT NULL,
  id text NOT NULL,
  plan_id text NOT NULL,
  next_ordinal integer DEFAULT 1 NOT NULL,
  fence bigint DEFAULT 1 NOT NULL,
  lease_until timestamptz,
  status text DEFAULT 'running'::text NOT NULL,
  CONSTRAINT sie_source_runs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_source_runs_book_id_plan_id_key UNIQUE (book_id, plan_id),
  CONSTRAINT sie_source_runs_status_check CHECK (status = ANY (ARRAY['running'::text, 'paused'::text, 'staged'::text])),
  CONSTRAINT sie_source_runs_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sie_source_runs_book_id_plan_id_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.sie_source_plans(book_id, id)
);
CREATE TABLE openerp.sie_financial_runs (
  book_id text NOT NULL,
  id text NOT NULL,
  source_run_id text NOT NULL,
  fiscal_year_id text NOT NULL,
  source_plan_digest text NOT NULL,
  next_ordinal integer DEFAULT 1 NOT NULL,
  fence bigint DEFAULT 1 NOT NULL,
  lease_until timestamptz NOT NULL,
  status text DEFAULT 'running'::text NOT NULL,
  CONSTRAINT sie_financial_runs_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_financial_runs_book_id_source_run_id_key UNIQUE (book_id, source_run_id),
  CONSTRAINT sie_financial_runs_status_check CHECK (status = ANY (ARRAY['running'::text, 'paused'::text, 'posted'::text])),
  CONSTRAINT sie_financial_runs_book_id_fiscal_year_id_fkey FOREIGN KEY (book_id, fiscal_year_id) REFERENCES openerp.fiscal_years(book_id, id),
  CONSTRAINT sie_financial_runs_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sie_financial_runs_book_id_source_run_id_fkey FOREIGN KEY (book_id, source_run_id) REFERENCES openerp.sie_source_runs(book_id, id)
);
CREATE TABLE openerp.sie_financial_postings (
  book_id text NOT NULL,
  run_id text NOT NULL,
  ordinal integer NOT NULL,
  source_reference text NOT NULL,
  source_digest text NOT NULL,
  change_set_id text NOT NULL,
  voucher_id text NOT NULL,
  receipt jsonb NOT NULL,
  CONSTRAINT sie_financial_postings_pkey PRIMARY KEY (book_id, run_id, ordinal),
  CONSTRAINT sie_financial_postings_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT sie_financial_postings_book_id_run_id_source_reference_key UNIQUE (book_id, run_id, source_reference),
  CONSTRAINT sie_financial_postings_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT sie_financial_postings_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT sie_financial_postings_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.sie_financial_runs(book_id, id),
  CONSTRAINT sie_financial_postings_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.sie_financial_proposals (
  book_id text NOT NULL,
  run_id text NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT sie_financial_proposals_pkey PRIMARY KEY (book_id, change_set_id),
  CONSTRAINT sie_financial_proposals_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT sie_financial_proposals_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.sie_financial_runs(book_id, id)
);
CREATE TABLE openerp.sie_source_chunks (
  book_id text NOT NULL,
  run_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_source_chunks_pkey PRIMARY KEY (book_id, run_id, ordinal),
  CONSTRAINT sie_source_chunks_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.sie_source_runs(book_id, id)
);
CREATE TABLE openerp.sie_source_vouchers (
  book_id text NOT NULL,
  run_id text NOT NULL,
  ordinal integer NOT NULL,
  source_reference text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_source_vouchers_pkey PRIMARY KEY (book_id, run_id, ordinal),
  CONSTRAINT sie_source_vouchers_book_id_run_id_fkey FOREIGN KEY (book_id, run_id) REFERENCES openerp.sie_source_runs(book_id, id)
);
CREATE TABLE openerp.sie_transaction_captures (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal bigint NOT NULL,
  pack_id text NOT NULL,
  evidence_id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT sie_transaction_captures_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT sie_transaction_captures_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT sie_transaction_captures_body_check CHECK (octet_length(body::text) <= 8388608),
  CONSTRAINT sie_transaction_captures_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT sie_transaction_captures_check1 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT sie_transaction_captures_check2 CHECK (NOT body -> 'input'::text ->> 'packId'::text IS DISTINCT FROM pack_id),
  CONSTRAINT sie_transaction_captures_check3 CHECK (NOT body -> 'input'::text ->> 'legalNameEvidenceId'::text IS DISTINCT FROM evidence_id),
  CONSTRAINT sie_transaction_captures_check4 CHECK (NOT body ->> 'createdBy'::text IS DISTINCT FROM actor_id),
  CONSTRAINT sie_transaction_captures_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT sie_transaction_captures_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT sie_transaction_captures_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT sie_transaction_captures_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT sie_transaction_captures_book_id_pack_id_fkey FOREIGN KEY (book_id, pack_id) REFERENCES openerp.accountant_review_packs(book_id, id)
);
CREATE TABLE openerp.sie_transaction_artifacts (
  book_id text NOT NULL,
  capture_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content bytea NOT NULL,
  CONSTRAINT sie_transaction_artifacts_pkey PRIMARY KEY (book_id, capture_id),
  CONSTRAINT sie_transaction_artifacts_check CHECK (NOT descriptor ->> 'captureId'::text IS DISTINCT FROM capture_id),
  CONSTRAINT sie_transaction_artifacts_check1 CHECK (NOT descriptor -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT sie_transaction_artifacts_check2 CHECK (NOT descriptor ->> 'sha256'::text IS DISTINCT FROM encode(sha256(content), 'hex'::text)),
  CONSTRAINT sie_transaction_artifacts_check3 CHECK (NOT (descriptor ->> 'byteLength'::text)::bigint IS DISTINCT FROM octet_length(content)::bigint),
  CONSTRAINT sie_transaction_artifacts_content_check CHECK (octet_length(content) >= 1 AND octet_length(content) <= 8388608),
  CONSTRAINT sie_transaction_artifacts_book_id_capture_id_fkey FOREIGN KEY (book_id, capture_id) REFERENCES openerp.sie_transaction_captures(book_id, id)
);
CREATE TABLE openerp.source_review_artifacts (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  preview_id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  receipt jsonb NOT NULL,
  CONSTRAINT source_review_artifacts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT source_review_artifacts_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 4194304),
  CONSTRAINT source_review_artifacts_check CHECK (byte_length = octet_length(convert_to(content, 'UTF8'::name))),
  CONSTRAINT source_review_artifacts_check1 CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT source_review_artifacts_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT source_review_artifacts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT source_review_artifacts_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id),
  CONSTRAINT source_review_artifacts_book_id_preview_id_fkey FOREIGN KEY (book_id, preview_id) REFERENCES openerp.intake_previews(book_id, id)
);
CREATE TABLE openerp.source_uploads (
  book_id text NOT NULL,
  key text NOT NULL,
  input jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT source_uploads_pkey PRIMARY KEY (book_id, key),
  CONSTRAINT source_uploads_key_check CHECK (key ~ '^[a-zA-Z0-9_-]{8,128}$'::text),
  CONSTRAINT source_uploads_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT source_uploads_created_by_fkey FOREIGN KEY (created_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.subledger_schedules (
  book_id text NOT NULL,
  id text NOT NULL,
  source_key text NOT NULL,
  CONSTRAINT subledger_schedules_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_schedules_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT subledger_schedules_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.subledger_bases (
  book_id text NOT NULL,
  schedule_id text NOT NULL,
  evidence_id text NOT NULL,
  source_locator text NOT NULL,
  voucher_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_bases_pkey PRIMARY KEY (book_id, schedule_id),
  CONSTRAINT subledger_bases_book_id_evidence_id_source_locator_key UNIQUE (book_id, evidence_id, source_locator),
  CONSTRAINT subledger_bases_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT subledger_bases_book_id_schedule_id_fkey FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_schedules(book_id, id),
  CONSTRAINT subledger_bases_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.subledger_basis_lines (
  book_id text NOT NULL,
  schedule_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  CONSTRAINT subledger_basis_lines_pkey PRIMARY KEY (book_id, voucher_id, line_id),
  CONSTRAINT subledger_basis_lines_book_id_schedule_id_fkey FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_bases(book_id, schedule_id),
  CONSTRAINT subledger_basis_lines_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.subledger_control_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT subledger_control_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_control_snapshots_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 8388608),
  CONSTRAINT subledger_control_snapshots_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.subledger_disposal_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_disposal_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_disposal_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT subledger_disposal_reviews_book_id_evidence_id_key UNIQUE (book_id, evidence_id),
  CONSTRAINT subledger_disposal_reviews_book_id_id_schedule_id_key UNIQUE (book_id, id, schedule_id),
  CONSTRAINT subledger_disposal_reviews_book_id_schedule_id_ordinal_key UNIQUE (book_id, schedule_id, ordinal),
  CONSTRAINT subledger_disposal_reviews_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT subledger_disposal_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT subledger_disposal_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT subledger_disposal_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT subledger_disposal_reviews_book_id_schedule_id_fkey FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_schedules(book_id, id)
);
CREATE TABLE openerp.subledger_disposal_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_disposal_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_disposal_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT subledger_disposal_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT subledger_disposal_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT subledger_disposal_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT subledger_disposal_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.subledger_disposal_reviews(book_id, id)
);
CREATE TABLE openerp.subledger_disposals (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  posting_date date NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_disposals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_disposals_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT subledger_disposals_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT subledger_disposals_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT subledger_disposals_book_id_schedule_id_key UNIQUE (book_id, schedule_id),
  CONSTRAINT subledger_disposals_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.subledger_disposal_approvals(book_id, id, review_id),
  CONSTRAINT subledger_disposals_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT subledger_disposals_book_id_review_id_schedule_id_fkey FOREIGN KEY (book_id, review_id, schedule_id) REFERENCES openerp.subledger_disposal_reviews(book_id, id, schedule_id)
);
CREATE TABLE openerp.subledger_impairment_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  ordinal integer NOT NULL,
  decision_key text NOT NULL,
  change_set_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_impairment_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_impairment_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT subledger_impairment_reviews_book_id_decision_key_key UNIQUE (book_id, decision_key),
  CONSTRAINT subledger_impairment_reviews_book_id_evidence_id_key UNIQUE (book_id, evidence_id),
  CONSTRAINT subledger_impairment_reviews_book_id_id_schedule_id_key UNIQUE (book_id, id, schedule_id),
  CONSTRAINT subledger_impairment_reviews_book_id_schedule_id_ordinal_key UNIQUE (book_id, schedule_id, ordinal),
  CONSTRAINT subledger_impairment_reviews_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT subledger_impairment_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT subledger_impairment_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT subledger_impairment_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT subledger_impairment_reviews_book_id_schedule_id_fkey FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_schedules(book_id, id)
);
CREATE TABLE openerp.subledger_impairment_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_impairment_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_impairment_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT subledger_impairment_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT subledger_impairment_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT subledger_impairment_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT subledger_impairment_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.subledger_impairment_reviews(book_id, id)
);
CREATE TABLE openerp.subledger_impairments (
  book_id text NOT NULL,
  id text NOT NULL,
  schedule_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  posting_receipt_id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  loss_line_id text NOT NULL,
  accumulated_impairment_line_id text NOT NULL,
  ordinal integer NOT NULL,
  decision_key text NOT NULL,
  schedule_revision integer NOT NULL,
  posting_date date NOT NULL,
  impairment_minor openerp.minor_units NOT NULL,
  loss_account_id text NOT NULL,
  accumulated_impairment_account_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_impairments_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT subledger_impairments_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT subledger_impairments_book_id_decision_key_key UNIQUE (book_id, decision_key),
  CONSTRAINT subledger_impairments_book_id_event_id_key UNIQUE (book_id, event_id),
  CONSTRAINT subledger_impairments_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT subledger_impairments_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT subledger_impairments_book_id_schedule_id_ordinal_key UNIQUE (book_id, schedule_id, ordinal),
  CONSTRAINT subledger_impairments_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT subledger_impairments_impairment_minor_check CHECK (impairment_minor::numeric > 0::numeric),
  CONSTRAINT subledger_impairments_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT subledger_impairments_schedule_revision_check CHECK (schedule_revision >= 2 AND schedule_revision <= 20),
  CONSTRAINT subledger_impairments_book_id_accumulated_impairment_accou_fkey FOREIGN KEY (book_id, accumulated_impairment_account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT subledger_impairments_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.subledger_impairment_approvals(book_id, id, review_id),
  CONSTRAINT subledger_impairments_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT subledger_impairments_book_id_loss_account_id_fkey FOREIGN KEY (book_id, loss_account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT subledger_impairments_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT subledger_impairments_book_id_review_id_schedule_id_fkey FOREIGN KEY (book_id, review_id, schedule_id) REFERENCES openerp.subledger_impairment_reviews(book_id, id, schedule_id),
  CONSTRAINT subledger_impairments_book_id_voucher_id_accumulated_impai_fkey FOREIGN KEY (book_id, voucher_id, accumulated_impairment_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT subledger_impairments_book_id_voucher_id_loss_line_id_fkey FOREIGN KEY (book_id, voucher_id, loss_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.subledger_schedule_revisions (
  book_id text NOT NULL,
  schedule_id text NOT NULL,
  revision integer NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT subledger_schedule_revisions_pkey PRIMARY KEY (book_id, schedule_id, revision),
  CONSTRAINT subledger_schedule_revisions_revision_check CHECK (revision >= 1 AND revision <= 20),
  CONSTRAINT subledger_schedule_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT subledger_schedule_revisions_book_id_schedule_id_fkey FOREIGN KEY (book_id, schedule_id) REFERENCES openerp.subledger_schedules(book_id, id)
);
CREATE TABLE openerp.subledger_preparations (
  book_id text NOT NULL,
  schedule_id text NOT NULL,
  revision integer NOT NULL,
  ordinal integer NOT NULL,
  attempt integer NOT NULL,
  change_set_id text NOT NULL,
  basis_dependency jsonb,
  CONSTRAINT subledger_preparations_pkey PRIMARY KEY (book_id, schedule_id, ordinal, attempt),
  CONSTRAINT subledger_preparations_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT subledger_preparations_attempt_check CHECK (attempt >= 1 AND attempt <= 100),
  CONSTRAINT subledger_preparations_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 120),
  CONSTRAINT subledger_preparations_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT subledger_preparations_book_id_schedule_id_revision_fkey FOREIGN KEY (book_id, schedule_id, revision) REFERENCES openerp.subledger_schedule_revisions(book_id, schedule_id, revision)
);
CREATE TABLE openerp.superseded_historical_openings (
  book_id text NOT NULL,
  change_set_id text NOT NULL,
  replacement_id text NOT NULL,
  CONSTRAINT superseded_historical_openings_pkey PRIMARY KEY (book_id, change_set_id),
  CONSTRAINT superseded_historical_openings_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT superseded_historical_openings_book_id_replacement_id_fkey FOREIGN KEY (book_id, replacement_id) REFERENCES openerp.change_sets(book_id, id)
);
CREATE TABLE openerp.supplier_invoice_drafts (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_key text COLLATE "C" NOT NULL,
  current_revision bigint NOT NULL,
  CONSTRAINT supplier_invoice_drafts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_invoice_drafts_book_id_draft_key_key UNIQUE (book_id, draft_key),
  CONSTRAINT supplier_invoice_drafts_current_revision_check CHECK (current_revision >= 1 AND current_revision <= 50),
  CONSTRAINT supplier_invoice_drafts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.supplier_invoice_draft_revisions (
  book_id text NOT NULL,
  draft_id text NOT NULL,
  revision bigint NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_invoice_draft_revisions_pkey PRIMARY KEY (book_id, draft_id, revision),
  CONSTRAINT supplier_invoice_draft_revisions_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT supplier_invoice_draft_revisions_check CHECK (body ->> 'id'::text = draft_id AND body ->> 'revision'::text = revision::text),
  CONSTRAINT supplier_invoice_draft_revisions_revision_check CHECK (revision >= 1 AND revision <= 50),
  CONSTRAINT supplier_invoice_draft_revisions_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.supplier_invoice_drafts(book_id, id)
);
CREATE TABLE openerp.supplier_acceptance_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_acceptance_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_acceptance_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT supplier_acceptance_reviews_book_id_draft_id_ordinal_key UNIQUE (book_id, draft_id, ordinal),
  CONSTRAINT supplier_acceptance_reviews_book_id_id_draft_id_draft_revis_key UNIQUE (book_id, id, draft_id, draft_revision),
  CONSTRAINT supplier_acceptance_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT supplier_acceptance_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT supplier_acceptance_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT supplier_acceptance_reviews_book_id_draft_id_draft_revisio_fkey FOREIGN KEY (book_id, draft_id, draft_revision) REFERENCES openerp.supplier_invoice_draft_revisions(book_id, draft_id, revision),
  CONSTRAINT supplier_acceptance_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT supplier_acceptance_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.supplier_acceptance_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_acceptance_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_acceptance_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT supplier_acceptance_approvals_book_id_review_id_ordinal_key UNIQUE (book_id, review_id, ordinal),
  CONSTRAINT supplier_acceptance_approvals_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT supplier_acceptance_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_acceptance_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_acceptance_reviews(book_id, id)
);
CREATE TABLE openerp.supplier_acceptances (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  posting_receipt_id text NOT NULL,
  register_invoice_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_acceptances_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_acceptances_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT supplier_acceptances_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT supplier_acceptances_book_id_posting_receipt_id_key UNIQUE (book_id, posting_receipt_id),
  CONSTRAINT supplier_acceptances_book_id_register_invoice_id_key UNIQUE (book_id, register_invoice_id),
  CONSTRAINT supplier_acceptances_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT supplier_acceptances_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.supplier_acceptance_approvals(book_id, id, review_id),
  CONSTRAINT supplier_acceptances_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT supplier_acceptances_book_id_register_invoice_id_fkey FOREIGN KEY (book_id, register_invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT supplier_acceptances_book_id_review_id_draft_id_draft_revi_fkey FOREIGN KEY (book_id, review_id, draft_id, draft_revision) REFERENCES openerp.supplier_acceptance_reviews(book_id, id, draft_id, draft_revision)
);
CREATE TABLE openerp.supplier_credit_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  invoice_id text NOT NULL,
  change_set_id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_credit_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_credit_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT supplier_credit_reviews_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT supplier_credit_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT supplier_credit_reviews_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.events(book_id, id),
  CONSTRAINT supplier_credit_reviews_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_credit_reviews_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);
CREATE TABLE openerp.supplier_credit_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  digest text NOT NULL,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_credit_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_credit_approvals_book_id_id_review_id_key UNIQUE (book_id, id, review_id),
  CONSTRAINT supplier_credit_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_credit_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_credit_reviews(book_id, id)
);
CREATE TABLE openerp.supplier_credits (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  invoice_id text NOT NULL,
  counterparty_id text NOT NULL,
  document_number text COLLATE "C" NOT NULL,
  credit_date date NOT NULL,
  amount_minor openerp.minor_units NOT NULL,
  voucher_id text NOT NULL,
  control_line_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_credits_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_credits_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT supplier_credits_book_id_counterparty_id_document_number_key UNIQUE (book_id, counterparty_id, document_number),
  CONSTRAINT supplier_credits_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT supplier_credits_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT supplier_credits_amount_minor_check CHECK (amount_minor::numeric > 0::numeric),
  CONSTRAINT supplier_credits_book_id_approval_id_review_id_fkey FOREIGN KEY (book_id, approval_id, review_id) REFERENCES openerp.supplier_credit_approvals(book_id, id, review_id),
  CONSTRAINT supplier_credits_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_credits_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id),
  CONSTRAINT supplier_credits_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.supplier_credit_reviews(book_id, id),
  CONSTRAINT supplier_credits_book_id_voucher_id_control_line_id_fkey FOREIGN KEY (book_id, voucher_id, control_line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.supplier_inbox (
  book_id text NOT NULL,
  occurrence_id text NOT NULL,
  channel text NOT NULL,
  message_identity text,
  draft_id text,
  review_reason text,
  review_attempt_id text,
  CONSTRAINT supplier_inbox_pkey PRIMARY KEY (book_id, occurrence_id),
  CONSTRAINT supplier_inbox_book_id_channel_message_identity_key UNIQUE (book_id, channel, message_identity),
  CONSTRAINT supplier_inbox_book_id_draft_id_key UNIQUE (book_id, draft_id),
  CONSTRAINT supplier_inbox_channel_check CHECK (channel = ANY (ARRAY['upload'::text, 'email'::text])),
  CONSTRAINT supplier_inbox_check CHECK (channel = 'upload'::text OR message_identity IS NOT NULL),
  CONSTRAINT supplier_inbox_review_reason_check CHECK (review_reason IS NULL OR length(review_reason) >= 1 AND length(review_reason) <= 2000),
  CONSTRAINT supplier_inbox_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.supplier_invoice_drafts(book_id, id),
  CONSTRAINT supplier_inbox_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT supplier_inbox_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.intake_occurrences(book_id, id)
);
CREATE TABLE openerp.supplier_extraction_attempts (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_extraction_attempts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_extraction_attempts_book_id_occurrence_id_ordinal_key UNIQUE (book_id, occurrence_id, ordinal),
  CONSTRAINT supplier_extraction_attempts_body_check CHECK (octet_length(body::text) <= 65536),
  CONSTRAINT supplier_extraction_attempts_check CHECK (body ->> 'id'::text = id AND body ->> 'occurrenceId'::text = occurrence_id),
  CONSTRAINT supplier_extraction_attempts_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT supplier_extraction_attempts_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.supplier_inbox(book_id, occurrence_id)
);
CREATE TABLE openerp.supplier_payee_proposals (
  book_id text NOT NULL,
  id text NOT NULL,
  counterparty_id text NOT NULL,
  counterparty_revision bigint NOT NULL,
  actor_id text NOT NULL,
  evidence_id text NOT NULL,
  creditor_name text NOT NULL,
  creditor_iban text NOT NULL,
  creditor_bic text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_payee_proposals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_payee_proposals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_payee_proposals_book_id_counterparty_id_counterpa_fkey FOREIGN KEY (book_id, counterparty_id, counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision),
  CONSTRAINT supplier_payee_proposals_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.supplier_payee_verifications (
  book_id text NOT NULL,
  id text NOT NULL,
  proposal_id text NOT NULL,
  counterparty_id text NOT NULL,
  counterparty_revision bigint NOT NULL,
  evidence_id text NOT NULL,
  creditor_name text NOT NULL,
  creditor_iban text NOT NULL,
  creditor_bic text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_payee_verifications_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_payee_verifications_book_id_proposal_id_key UNIQUE (book_id, proposal_id),
  CONSTRAINT supplier_payee_verifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_payee_verifications_book_id_counterparty_id_count_fkey FOREIGN KEY (book_id, counterparty_id, counterparty_revision) REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision),
  CONSTRAINT supplier_payee_verifications_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_payee_verifications_book_id_proposal_id_fkey FOREIGN KEY (book_id, proposal_id) REFERENCES openerp.supplier_payee_proposals(book_id, id)
);
CREATE TABLE openerp.supplier_payment_batch_previews (
  book_id text NOT NULL,
  id text NOT NULL,
  actor_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_payment_batch_previews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_payment_batch_previews_body_check CHECK (octet_length(body::text) <= 131072),
  CONSTRAINT supplier_payment_batch_previews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_payment_batch_previews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.supplier_payment_batch_exports (
  book_id text NOT NULL,
  id text NOT NULL,
  preview_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_payment_batch_exports_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_payment_batch_exports_book_id_preview_id_key UNIQUE (book_id, preview_id),
  CONSTRAINT supplier_payment_batch_exports_book_id_preview_id_fkey FOREIGN KEY (book_id, preview_id) REFERENCES openerp.supplier_payment_batch_previews(book_id, id)
);
CREATE TABLE openerp.supplier_payment_batch_items (
  book_id text NOT NULL,
  export_id text NOT NULL,
  invoice_id text NOT NULL,
  CONSTRAINT supplier_payment_batch_items_pkey PRIMARY KEY (book_id, export_id, invoice_id),
  CONSTRAINT supplier_payment_batch_items_book_id_invoice_id_key UNIQUE (book_id, invoice_id),
  CONSTRAINT supplier_payment_batch_items_book_id_export_id_fkey FOREIGN KEY (book_id, export_id) REFERENCES openerp.supplier_payment_batch_exports(book_id, id),
  CONSTRAINT supplier_payment_batch_items_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id)
);
CREATE TABLE openerp.supplier_payment_outcomes (
  book_id text NOT NULL,
  id text NOT NULL,
  export_id text NOT NULL,
  ordinal integer NOT NULL,
  actor_id text NOT NULL,
  evidence_id text NOT NULL,
  status text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_payment_outcomes_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_payment_outcomes_book_id_export_id_ordinal_key UNIQUE (book_id, export_id, ordinal),
  CONSTRAINT supplier_payment_outcomes_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT supplier_payment_outcomes_status_check CHECK (status = ANY (ARRAY['unknown'::text, 'reported_accepted'::text, 'reported_settled'::text, 'reported_rejected'::text])),
  CONSTRAINT supplier_payment_outcomes_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT supplier_payment_outcomes_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT supplier_payment_outcomes_book_id_export_id_fkey FOREIGN KEY (book_id, export_id) REFERENCES openerp.supplier_payment_batch_exports(book_id, id)
);
CREATE TABLE openerp.tax_account_sources (
  book_id text NOT NULL,
  account_id text NOT NULL,
  source_key text NOT NULL,
  CONSTRAINT tax_account_sources_pkey PRIMARY KEY (book_id, account_id),
  CONSTRAINT tax_account_sources_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT tax_account_sources_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id)
);
CREATE TABLE openerp.tax_account_statements (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  statement_key text NOT NULL,
  evidence_id text NOT NULL,
  review_evidence_id text NOT NULL,
  evidence_sha256 text NOT NULL,
  source_locator text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT tax_account_statements_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_statements_book_id_account_id_evidence_sha256_s_key UNIQUE (book_id, account_id, evidence_sha256, source_locator),
  CONSTRAINT tax_account_statements_book_id_account_id_statement_key_key UNIQUE (book_id, account_id, statement_key),
  CONSTRAINT tax_account_statements_book_id_id_account_id_key UNIQUE (book_id, id, account_id),
  CONSTRAINT tax_account_statements_check CHECK (starts_on <= ends_on),
  CONSTRAINT tax_account_statements_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.tax_account_sources(book_id, account_id),
  CONSTRAINT tax_account_statements_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT tax_account_statements_book_id_review_evidence_id_fkey FOREIGN KEY (book_id, review_evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.tax_account_events (
  book_id text NOT NULL,
  id text NOT NULL,
  account_id text NOT NULL,
  event_key text NOT NULL,
  statement_id text NOT NULL,
  ordinal integer NOT NULL,
  CONSTRAINT tax_account_events_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_events_book_id_account_id_event_key_key UNIQUE (book_id, account_id, event_key),
  CONSTRAINT tax_account_events_book_id_statement_id_ordinal_key UNIQUE (book_id, statement_id, ordinal),
  CONSTRAINT tax_account_events_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 1000),
  CONSTRAINT tax_account_events_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.tax_account_sources(book_id, account_id),
  CONSTRAINT tax_account_events_book_id_statement_id_account_id_fkey FOREIGN KEY (book_id, statement_id, account_id) REFERENCES openerp.tax_account_statements(book_id, id, account_id)
);
CREATE TABLE openerp.tax_account_classification_resolutions (
  book_id text NOT NULL,
  id text NOT NULL,
  event_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT tax_account_classification_resolutions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_classification_resolutions_book_id_event_id_key UNIQUE (book_id, event_id),
  CONSTRAINT tax_account_classification_resolutions_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.tax_account_events(book_id, id),
  CONSTRAINT tax_account_classification_resolutions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.tax_account_controls (
  book_id text NOT NULL,
  id text NOT NULL,
  body jsonb NOT NULL,
  content text NOT NULL,
  sha256 text NOT NULL,
  byte_length integer NOT NULL,
  CONSTRAINT tax_account_controls_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_controls_byte_length_check CHECK (byte_length >= 1 AND byte_length <= 8388608),
  CONSTRAINT tax_account_controls_check CHECK (byte_length = octet_length(convert_to(content, 'UTF8'::name))),
  CONSTRAINT tax_account_controls_check1 CHECK (sha256 = encode(sha256(convert_to(content, 'UTF8'::name)), 'hex'::text)),
  CONSTRAINT tax_account_controls_sha256_check CHECK (sha256 ~ '^[a-f0-9]{64}$'::text),
  CONSTRAINT tax_account_controls_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.tax_account_matches (
  book_id text NOT NULL,
  id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT tax_account_matches_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_matches_book_id_id_event_id_voucher_id_line_id_key UNIQUE (book_id, id, event_id, voucher_id, line_id),
  CONSTRAINT tax_account_matches_book_id_event_id_fkey FOREIGN KEY (book_id, event_id) REFERENCES openerp.tax_account_events(book_id, id),
  CONSTRAINT tax_account_matches_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT tax_account_matches_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id)
);
CREATE TABLE openerp.tax_account_match_capacity (
  book_id text NOT NULL,
  match_id text NOT NULL,
  event_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  CONSTRAINT tax_account_match_capacity_pkey PRIMARY KEY (book_id, match_id),
  CONSTRAINT tax_account_match_capacity_book_id_event_id_key UNIQUE (book_id, event_id),
  CONSTRAINT tax_account_match_capacity_book_id_voucher_id_line_id_key UNIQUE (book_id, voucher_id, line_id),
  CONSTRAINT tax_account_match_capacity_book_id_match_id_event_id_vouch_fkey FOREIGN KEY (book_id, match_id, event_id, voucher_id, line_id) REFERENCES openerp.tax_account_matches(book_id, id, event_id, voucher_id, line_id)
);
CREATE TABLE openerp.tax_account_unmatches (
  book_id text NOT NULL,
  id text NOT NULL,
  match_id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT tax_account_unmatches_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT tax_account_unmatches_book_id_match_id_key UNIQUE (book_id, match_id),
  CONSTRAINT tax_account_unmatches_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT tax_account_unmatches_book_id_match_id_fkey FOREIGN KEY (book_id, match_id) REFERENCES openerp.tax_account_matches(book_id, id)
);
CREATE TABLE openerp.vat_control_profiles (
  book_id text NOT NULL,
  id text NOT NULL,
  identity_key text COLLATE "C" NOT NULL,
  role_evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_control_profiles_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_control_profiles_book_id_identity_key_key UNIQUE (book_id, identity_key),
  CONSTRAINT vat_control_profiles_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_control_profiles_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_control_profiles_book_id_role_evidence_id_fkey FOREIGN KEY (book_id, role_evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.vat_control_account_roles (
  book_id text NOT NULL,
  profile_id text NOT NULL,
  role text NOT NULL,
  account_id text NOT NULL,
  account_version bigint NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL,
  CONSTRAINT vat_control_account_roles_pkey PRIMARY KEY (book_id, profile_id, role),
  CONSTRAINT vat_control_account_roles_book_id_profile_id_role_account_i_key UNIQUE (book_id, profile_id, role, account_id),
  CONSTRAINT vat_control_account_roles_account_version_check CHECK (account_version > 0),
  CONSTRAINT vat_control_account_roles_role_check CHECK (role = ANY (ARRAY['output_vat_control'::text, 'input_vat_control'::text, 'vat_settlement_control'::text])),
  CONSTRAINT vat_control_account_roles_book_id_account_id_fkey FOREIGN KEY (book_id, account_id) REFERENCES openerp.accounts(book_id, id),
  CONSTRAINT vat_control_account_roles_book_id_profile_id_fkey FOREIGN KEY (book_id, profile_id) REFERENCES openerp.vat_control_profiles(book_id, id)
);
CREATE TABLE openerp.vat_return_drafts (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_return_drafts_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_return_drafts_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT vat_return_drafts_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 500),
  CONSTRAINT vat_return_drafts_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.vat_reporting_obligations (
  book_id text NOT NULL,
  id text NOT NULL,
  registration_namespace text NOT NULL,
  registration_id text NOT NULL,
  jurisdiction text NOT NULL,
  scheme text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  period_evidence_id text,
  period_evidence_sha256 text,
  body jsonb NOT NULL,
  digest text NOT NULL,
  CONSTRAINT vat_reporting_obligations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_reporting_obligations_book_id_registration_namespace_re_key UNIQUE (book_id, registration_namespace, registration_id, jurisdiction, scheme, starts_on, ends_on),
  CONSTRAINT vat_reporting_obligations_check CHECK (starts_on <= ends_on),
  CONSTRAINT vat_reporting_obligations_check1 CHECK ((period_evidence_id IS NULL) = (period_evidence_sha256 IS NULL)),
  CONSTRAINT vat_reporting_obligations_check2 CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_reporting_obligations_digest_check CHECK (digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT vat_reporting_obligations_jurisdiction_check CHECK (jurisdiction = 'SE'::text),
  CONSTRAINT vat_reporting_obligations_registration_namespace_check CHECK (registration_namespace = 'synthetic'::text),
  CONSTRAINT vat_reporting_obligations_scheme_check CHECK (scheme = 'synthetic_output_input_v1'::text),
  CONSTRAINT vat_reporting_obligations_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_reporting_obligations_book_id_period_evidence_id_fkey FOREIGN KEY (book_id, period_evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.vat_control_reclassification_reviews (
  book_id text NOT NULL,
  id text NOT NULL,
  obligation_id text NOT NULL,
  profile_id text NOT NULL,
  draft_id text NOT NULL,
  actor_id text NOT NULL,
  ordinal integer NOT NULL,
  change_set_id text,
  body jsonb NOT NULL,
  CONSTRAINT vat_control_reclassification_reviews_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_control_reclassification_reviews_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT vat_control_reclassification_reviews_body_check CHECK (octet_length(body::text) <= 1048576),
  CONSTRAINT vat_control_reclassification_reviews_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_control_reclassification_reviews_check1 CHECK ((body -> 'postingPlan'::text = 'null'::jsonb) = (change_set_id IS NULL)),
  CONSTRAINT vat_control_reclassification_reviews_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 20),
  CONSTRAINT vat_control_reclassification_reviews_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT vat_control_reclassification_reviews_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT vat_control_reclassification_reviews_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.vat_return_drafts(book_id, id),
  CONSTRAINT vat_control_reclassification_reviews_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_control_reclassification_reviews_book_id_obligation_id_fkey FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.vat_reporting_obligations(book_id, id),
  CONSTRAINT vat_control_reclassification_reviews_book_id_profile_id_fkey FOREIGN KEY (book_id, profile_id) REFERENCES openerp.vat_control_profiles(book_id, id)
);
CREATE TABLE openerp.vat_control_reclassification_approvals (
  book_id text NOT NULL,
  id text NOT NULL,
  review_id text NOT NULL,
  actor_id text NOT NULL,
  review_digest text NOT NULL,
  kernel_approval_id text,
  expires_at timestamptz NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_control_reclassification_approvals_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_control_reclassification_approvals_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_control_reclassification_approvals_check CHECK ((kernel_approval_id IS NULL) = (body -> 'kernelApproval'::text = 'null'::jsonb)),
  CONSTRAINT vat_control_reclassification_approvals_check1 CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_control_reclassification_ap_book_id_kernel_approval_id_fkey FOREIGN KEY (book_id, kernel_approval_id) REFERENCES openerp.approvals(book_id, id),
  CONSTRAINT vat_control_reclassification_approvals_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp.actors(id),
  CONSTRAINT vat_control_reclassification_approvals_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_control_reclassification_approvals_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.vat_control_reclassification_reviews(book_id, id)
);
CREATE TABLE openerp.vat_fact_components (
  book_id text NOT NULL,
  id text NOT NULL,
  source_key text NOT NULL,
  record_class text NOT NULL,
  CONSTRAINT vat_fact_components_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_fact_components_book_id_source_key_key UNIQUE (book_id, source_key),
  CONSTRAINT vat_fact_components_record_class_check CHECK (record_class = ANY (ARRAY['actual_company'::text, 'synthetic'::text])),
  CONSTRAINT vat_fact_components_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.vat_fact_revisions (
  book_id text NOT NULL,
  fact_id text NOT NULL,
  revision integer NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  review_evidence_id text NOT NULL,
  voucher_id text,
  body jsonb NOT NULL,
  CONSTRAINT vat_fact_revisions_pkey PRIMARY KEY (book_id, fact_id, revision),
  CONSTRAINT vat_fact_revision_identity UNIQUE (book_id, id, fact_id),
  CONSTRAINT vat_fact_revisions_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT vat_fact_revisions_revision_check CHECK (revision >= 1 AND revision <= 20),
  CONSTRAINT vat_fact_revisions_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT vat_fact_revisions_book_id_fact_id_fkey FOREIGN KEY (book_id, fact_id) REFERENCES openerp.vat_fact_components(book_id, id),
  CONSTRAINT vat_fact_revisions_book_id_review_evidence_id_fkey FOREIGN KEY (book_id, review_evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT vat_fact_revisions_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.vat_control_reclassification_effects (
  book_id text NOT NULL,
  id text NOT NULL,
  obligation_id text NOT NULL,
  review_id text NOT NULL,
  approval_id text NOT NULL,
  draft_id text NOT NULL,
  outcome text NOT NULL,
  change_set_id text,
  voucher_id text,
  posting_receipt_id text,
  posting_date date NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_control_reclassification_effects_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_approval_id_key UNIQUE (book_id, approval_id),
  CONSTRAINT vat_control_reclassification_effects_book_id_change_set_id_key UNIQUE (book_id, change_set_id),
  CONSTRAINT vat_control_reclassification_effects_book_id_obligation_id_key UNIQUE (book_id, obligation_id),
  CONSTRAINT vat_control_reclassification_effects_book_id_review_id_key UNIQUE (book_id, review_id),
  CONSTRAINT vat_control_reclassification_effects_book_id_voucher_id_key UNIQUE (book_id, voucher_id),
  CONSTRAINT vat_control_reclassification_effects_body_check CHECK (octet_length(body::text) <= 262144),
  CONSTRAINT vat_control_reclassification_effects_check CHECK ((outcome = 'posted'::text) = (change_set_id IS NOT NULL AND voucher_id IS NOT NULL AND posting_receipt_id IS NOT NULL)),
  CONSTRAINT vat_control_reclassification_effects_check1 CHECK ((outcome = 'no_effect'::text) = (change_set_id IS NULL AND voucher_id IS NULL AND posting_receipt_id IS NULL)),
  CONSTRAINT vat_control_reclassification_effects_check2 CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_control_reclassification_effects_outcome_check CHECK (outcome = ANY (ARRAY['posted'::text, 'no_effect'::text])),
  CONSTRAINT vat_control_reclassification_ef_book_id_posting_receipt_id_fkey FOREIGN KEY (book_id, posting_receipt_id) REFERENCES openerp.execution_receipts(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_approval_id_fkey FOREIGN KEY (book_id, approval_id) REFERENCES openerp.vat_control_reclassification_approvals(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_change_set_id_fkey FOREIGN KEY (book_id, change_set_id) REFERENCES openerp.change_sets(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.vat_return_drafts(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_control_reclassification_effects_book_id_obligation_id_fkey FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.vat_reporting_obligations(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_review_id_fkey FOREIGN KEY (book_id, review_id) REFERENCES openerp.vat_control_reclassification_reviews(book_id, id),
  CONSTRAINT vat_control_reclassification_effects_book_id_voucher_id_fkey FOREIGN KEY (book_id, voucher_id) REFERENCES openerp.vouchers(book_id, id)
);
CREATE TABLE openerp.vat_control_reclassification_contributions (
  book_id text NOT NULL,
  id text NOT NULL,
  effect_id text NOT NULL,
  ordinal integer NOT NULL,
  fact_id text NOT NULL,
  fact_revision_id text NOT NULL,
  voucher_id text NOT NULL,
  line_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_control_reclassification_contributions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_control_reclassification__book_id_effect_id_voucher_id__key UNIQUE (book_id, effect_id, voucher_id, line_id),
  CONSTRAINT vat_control_reclassification_con_book_id_voucher_id_line_id_key UNIQUE (book_id, voucher_id, line_id),
  CONSTRAINT vat_control_reclassification_cont_book_id_effect_id_ordinal_key UNIQUE (book_id, effect_id, ordinal),
  CONSTRAINT vat_control_reclassification_contributions_check CHECK (NOT body ->> 'factId'::text IS DISTINCT FROM fact_id),
  CONSTRAINT vat_control_reclassification_contributions_check1 CHECK (NOT body ->> 'factRevisionId'::text IS DISTINCT FROM fact_revision_id),
  CONSTRAINT vat_control_reclassification_contributions_check2 CHECK (NOT body ->> 'voucherId'::text IS DISTINCT FROM voucher_id),
  CONSTRAINT vat_control_reclassification_contributions_check3 CHECK (NOT body ->> 'lineId'::text IS DISTINCT FROM line_id),
  CONSTRAINT vat_control_reclassification_contributions_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 500),
  CONSTRAINT vat_contribution_fact_revision FOREIGN KEY (book_id, fact_revision_id, fact_id) REFERENCES openerp.vat_fact_revisions(book_id, id, fact_id),
  CONSTRAINT vat_control_reclassification_co_book_id_voucher_id_line_id_fkey FOREIGN KEY (book_id, voucher_id, line_id) REFERENCES openerp.journal_lines(book_id, voucher_id, id),
  CONSTRAINT vat_control_reclassification_contributio_book_id_effect_id_fkey FOREIGN KEY (book_id, effect_id) REFERENCES openerp.vat_control_reclassification_effects(book_id, id),
  CONSTRAINT vat_control_reclassification_contributions_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id)
);
CREATE TABLE openerp.vat_draft_amendments (
  book_id text NOT NULL,
  id text NOT NULL,
  ordinal integer NOT NULL,
  original_draft_id text NOT NULL,
  replacement_draft_id text NOT NULL,
  review_evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_draft_amendments_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT vat_draft_amendments_book_id_ordinal_key UNIQUE (book_id, ordinal),
  CONSTRAINT vat_draft_amendments_book_id_original_draft_id_replacement__key UNIQUE (book_id, original_draft_id, replacement_draft_id),
  CONSTRAINT vat_draft_amendments_check CHECK (original_draft_id <> replacement_draft_id),
  CONSTRAINT vat_draft_amendments_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 500),
  CONSTRAINT vat_draft_amendments_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT vat_draft_amendments_book_id_original_draft_id_fkey FOREIGN KEY (book_id, original_draft_id) REFERENCES openerp.vat_return_drafts(book_id, id),
  CONSTRAINT vat_draft_amendments_book_id_replacement_draft_id_fkey FOREIGN KEY (book_id, replacement_draft_id) REFERENCES openerp.vat_return_drafts(book_id, id),
  CONSTRAINT vat_draft_amendments_book_id_review_evidence_id_fkey FOREIGN KEY (book_id, review_evidence_id) REFERENCES openerp.evidence(book_id, id)
);
CREATE TABLE openerp.vat_fact_withdrawals (
  book_id text NOT NULL,
  fact_id text NOT NULL,
  revision integer NOT NULL,
  id text NOT NULL,
  evidence_id text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT vat_fact_withdrawals_pkey PRIMARY KEY (book_id, fact_id),
  CONSTRAINT vat_fact_withdrawals_book_id_id_key UNIQUE (book_id, id),
  CONSTRAINT vat_fact_withdrawals_check CHECK (NOT body ->> 'id'::text IS DISTINCT FROM id),
  CONSTRAINT vat_fact_withdrawals_check1 CHECK (NOT body ->> 'factId'::text IS DISTINCT FROM fact_id),
  CONSTRAINT vat_fact_withdrawals_check2 CHECK (NOT body -> 'scope'::text ->> 'bookId'::text IS DISTINCT FROM book_id),
  CONSTRAINT vat_fact_withdrawals_book_id_evidence_id_fkey FOREIGN KEY (book_id, evidence_id) REFERENCES openerp.evidence(book_id, id),
  CONSTRAINT vat_fact_withdrawals_book_id_fact_id_revision_fkey FOREIGN KEY (book_id, fact_id, revision) REFERENCES openerp.vat_fact_revisions(book_id, fact_id, revision)
);
CREATE TABLE openerp.workspace_assignments (
  book_id text NOT NULL,
  kind text NOT NULL,
  record_id text NOT NULL,
  revision integer NOT NULL,
  assignee_id text,
  due_on date,
  note text NOT NULL,
  updated_at timestamptz DEFAULT clock_timestamp() NOT NULL,
  updated_by text NOT NULL,
  CONSTRAINT workspace_assignments_pkey PRIMARY KEY (book_id, kind, record_id, revision),
  CONSTRAINT workspace_assignments_kind_check CHECK (kind = ANY (ARRAY['journal'::text, 'invoice'::text, 'expense'::text])),
  CONSTRAINT workspace_assignments_note_check CHECK (length(note) <= 2000),
  CONSTRAINT workspace_assignments_revision_check CHECK (revision > 0),
  CONSTRAINT workspace_assignments_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES openerp.actors(id),
  CONSTRAINT workspace_assignments_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT workspace_assignments_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp.workspace_views (
  book_id text NOT NULL,
  id text NOT NULL,
  owner_id text NOT NULL,
  name text NOT NULL,
  visibility text NOT NULL,
  filters jsonb NOT NULL,
  CONSTRAINT workspace_views_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT workspace_views_filters_check CHECK (jsonb_typeof(filters) = 'object'::text),
  CONSTRAINT workspace_views_name_check CHECK (length(btrim(name)) >= 1 AND length(btrim(name)) <= 80),
  CONSTRAINT workspace_views_visibility_check CHECK (visibility = ANY (ARRAY['personal'::text, 'team'::text])),
  CONSTRAINT workspace_views_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT workspace_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES openerp.actors(id)
);

-- Better Auth owns browser identity. These tables sit after the accounting schema
-- because a user is an actor.
CREATE TABLE openerp_auth."user" (
  id text NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean DEFAULT FALSE NOT NULL,
  image text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT user_pkey PRIMARY KEY (id),
  CONSTRAINT user_email_key UNIQUE (email),
  CONSTRAINT user_email_check CHECK (email = lower(email)),
  CONSTRAINT user_id_fkey FOREIGN KEY (id) REFERENCES openerp.actors(id)
);
CREATE TABLE openerp_auth.account (
  id text NOT NULL,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT account_pkey PRIMARY KEY (id),
  CONSTRAINT account_provider_identity_key UNIQUE (provider_id, account_id),
  CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES openerp_auth."user"(id) ON DELETE CASCADE
);
CREATE TABLE openerp_auth.rate_limit (
  id text NOT NULL,
  key text NOT NULL,
  count integer NOT NULL,
  last_request bigint NOT NULL,
  CONSTRAINT rate_limit_pkey PRIMARY KEY (id),
  CONSTRAINT rate_limit_key_key UNIQUE (key)
);
CREATE TABLE openerp_auth.session (
  id text NOT NULL,
  token text NOT NULL,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  ip_address text,
  user_agent text,
  CONSTRAINT session_pkey PRIMARY KEY (id),
  CONSTRAINT session_token_key UNIQUE (token),
  CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES openerp_auth."user"(id) ON DELETE CASCADE
);
CREATE TABLE openerp_auth.verification (
  id text NOT NULL,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT verification_pkey PRIMARY KEY (id)
);

-- Additional checks and foreign keys that close reference cycles or cross schemas.
ALTER TABLE openerp.collection_events
  ADD CONSTRAINT collection_event_reminder_send_unauthorized CHECK (kind <> 'reminder_prepared'::text OR body @> '{"sendAuthorized": false}'::jsonb);
ALTER TABLE openerp.invoice_draft_revisions
  ADD CONSTRAINT invoice_draft_revisions_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.invoice_drafts(book_id, id);
ALTER TABLE openerp.commerce_counterparties
  ADD CONSTRAINT commerce_counterparties_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.commerce_counterparty_revisions(book_id, counterparty_id, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.commerce_invoice_revisions
  ADD CONSTRAINT commerce_invoice_revisions_book_id_invoice_id_fkey FOREIGN KEY (book_id, invoice_id) REFERENCES openerp.commerce_invoices(book_id, id);
ALTER TABLE openerp.catalog_articles
  ADD CONSTRAINT catalog_articles_book_id_code_current_revision_fkey FOREIGN KEY (book_id, code, current_revision) REFERENCES openerp.catalog_article_revisions(book_id, code, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.dimensions
  ADD CONSTRAINT dimension_current_revision_fk FOREIGN KEY (book_id, code, current_revision) REFERENCES openerp.dimension_revisions(book_id, code, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.dimension_values
  ADD CONSTRAINT dimension_value_current_revision_fk FOREIGN KEY (book_id, dimension_code, code, current_revision) REFERENCES openerp.dimension_value_revisions(book_id, dimension_code, code, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.firm_clients
  ADD CONSTRAINT firm_clients_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES openerp_auth."user"(id);
ALTER TABLE openerp.firm_members
  ADD CONSTRAINT firm_members_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp_auth."user"(id);
ALTER TABLE openerp.identity_admissions
  ADD CONSTRAINT identity_admissions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES openerp_auth."user"(id);
ALTER TABLE openerp.invoice_cancellations
  ADD CONSTRAINT invoice_cancellations_book_id_review_id_approval_id_fkey FOREIGN KEY (book_id, review_id, approval_id) REFERENCES openerp.invoice_cancellation_executions(book_id, review_id, approval_id);
ALTER TABLE openerp.owner_revisions
  ADD CONSTRAINT owner_revisions_book_id_record_id_fkey FOREIGN KEY (book_id, record_id) REFERENCES openerp.owner_records(book_id, id);
ALTER TABLE openerp.sales_documents
  ADD CONSTRAINT sales_documents_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.sales_document_revisions(book_id, document_id, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.supplier_invoice_drafts
  ADD CONSTRAINT supplier_invoice_drafts_book_id_id_current_revision_fkey FOREIGN KEY (book_id, id, current_revision) REFERENCES openerp.supplier_invoice_draft_revisions(book_id, draft_id, revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE openerp.supplier_inbox
  ADD CONSTRAINT supplier_inbox_review_attempt_fk FOREIGN KEY (book_id, review_attempt_id) REFERENCES openerp.supplier_extraction_attempts(book_id, id);

-- effect-mq 0.7.0 PostgreSQL store; names mirror its schema factories.
CREATE TABLE public.effect_mq_dedupe (
  name text NOT NULL,
  key text NOT NULL,
  job_id text NOT NULL,
  window_expires_at timestamptz,
  CONSTRAINT effect_mq_dedupe_pkey PRIMARY KEY (name, key)
);
CREATE TABLE public.effect_mq_flow_children (
  flow_id text NOT NULL,
  child_key text NOT NULL,
  name text NOT NULL,
  store_key text NOT NULL,
  spec jsonb NOT NULL,
  status text NOT NULL,
  exit jsonb,
  failed_reason text,
  cascaded boolean NOT NULL,
  pending_since timestamptz NOT NULL,
  CONSTRAINT effect_mq_flow_children_pkey PRIMARY KEY (flow_id, child_key)
);
CREATE TABLE public.effect_mq_flow_outbox (
  id bigserial NOT NULL,
  flow_name text NOT NULL,
  parent_store_key text NOT NULL,
  report jsonb NOT NULL,
  CONSTRAINT effect_mq_flow_outbox_pkey PRIMARY KEY (id)
);
CREATE TABLE public.effect_mq_jobs (
  id text NOT NULL,
  name text NOT NULL,
  queue text NOT NULL,
  state text NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  seq bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  payload jsonb,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  attempts_max integer NOT NULL,
  attempts_made integer DEFAULT 0 NOT NULL,
  stalled_count integer DEFAULT 0 NOT NULL,
  backoff jsonb,
  keep jsonb,
  timeout_ms bigint,
  cancel_requested boolean DEFAULT FALSE NOT NULL,
  dedupe_key text,
  trace jsonb,
  parent jsonb,
  flow_fail_fast boolean,
  flow_pending integer,
  flow_completed integer,
  flow_failed integer,
  flow_cancelled integer,
  run_at timestamptz NOT NULL,
  enqueued_at timestamptz NOT NULL,
  processed_at timestamptz,
  finished_at timestamptz,
  exit jsonb,
  failed_reason text,
  lock_token text,
  lock_expires_at timestamptz,
  CONSTRAINT effect_mq_jobs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.effect_mq_job_attempts (
  job_id text NOT NULL,
  attempt integer NOT NULL,
  outcome text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz NOT NULL,
  exit jsonb,
  CONSTRAINT effect_mq_job_attempts_pkey PRIMARY KEY (job_id, attempt),
  CONSTRAINT effect_mq_job_attempts_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.effect_mq_jobs(id) ON DELETE CASCADE
);
CREATE TABLE public.effect_mq_queue_control (
  queue text NOT NULL,
  paused boolean DEFAULT FALSE NOT NULL,
  CONSTRAINT effect_mq_queue_control_pkey PRIMARY KEY (queue)
);
CREATE TABLE public.effect_mq_schedules (
  key text NOT NULL,
  job_name text NOT NULL,
  queue text NOT NULL,
  cron text,
  tz text,
  every_ms bigint,
  payload jsonb,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  attempts_max integer NOT NULL,
  backoff jsonb,
  keep jsonb,
  timeout_ms bigint,
  group_name text,
  next_run_at timestamptz NOT NULL,
  CONSTRAINT effect_mq_schedules_pkey PRIMARY KEY (key)
);

-- effect-mq queue indexes.
CREATE INDEX effect_mq_flow_children_cascade_idx ON public.effect_mq_flow_children (flow_id) WHERE ((status = 'cancelled'::text) AND (NOT cascaded));
CREATE INDEX effect_mq_flow_children_pending_idx ON public.effect_mq_flow_children (pending_since) WHERE (status = 'pending'::text);
CREATE INDEX effect_mq_jobs_active_idx ON public.effect_mq_jobs (lock_expires_at) WHERE (state = 'active'::text);
CREATE INDEX effect_mq_jobs_delayed_idx ON public.effect_mq_jobs (queue, run_at) WHERE (state = 'delayed'::text);
CREATE INDEX effect_mq_jobs_history_idx ON public.effect_mq_jobs (name, state, finished_at);
CREATE INDEX effect_mq_jobs_listing_idx ON public.effect_mq_jobs (enqueued_at DESC, id DESC);
CREATE INDEX effect_mq_jobs_metadata_idx ON public.effect_mq_jobs USING gin (metadata jsonb_path_ops);
CREATE INDEX effect_mq_jobs_ready_idx ON public.effect_mq_jobs (queue, priority DESC, seq) WHERE (state = 'waiting'::text);
CREATE INDEX effect_mq_schedules_due_idx ON public.effect_mq_schedules (next_run_at);

-- Views over the posting and allocation history.

CREATE VIEW openerp.bank_active_allocation_legs AS
   SELECT book_id,
      plan_id,
      ordinal,
      statement_id,
      row_ordinal,
      voucher_id,
      line_id,
      amount_minor
     FROM openerp.bank_allocation_legs a
    WHERE NOT (EXISTS ( SELECT
             FROM openerp.bank_match_reversals r
            WHERE r.book_id = a.book_id AND r.allocation_plan_id = a.plan_id));;
CREATE VIEW openerp.bank_active_matches AS
   SELECT book_id,
      statement_id,
      row_ordinal,
      voucher_id,
      line_id,
      origin,
      actor_id
     FROM openerp.bank_matches m
    WHERE NOT (EXISTS ( SELECT
             FROM openerp.bank_match_reversals r
            WHERE r.book_id = m.book_id AND r.statement_id = m.statement_id AND r.row_ordinal = m.row_ordinal));;
CREATE VIEW openerp.commerce_active_allocation_legs AS
   SELECT book_id,
      receipt_id,
      ordinal,
      invoice_id,
      payment_voucher_id,
      payment_line_id,
      amount_minor
     FROM openerp.commerce_allocation_legs l
    WHERE NOT (EXISTS ( SELECT
             FROM openerp.commerce_allocation_reversals r
            WHERE r.book_id = l.book_id AND r.receipt_id = l.receipt_id));;

-- Accounting indexes.
CREATE UNIQUE INDEX ar_legal_delivery_destination ON openerp.ar_legal_delivery_requests (book_id, capture_id, channel, (((body -> 'input'::text) ->> 'destination'::text)));
CREATE INDEX bank_allocation_line ON openerp.bank_allocation_legs (book_id, voucher_id, line_id);
CREATE INDEX bank_allocation_source ON openerp.bank_allocation_legs (book_id, statement_id, row_ordinal);
CREATE INDEX bank_connector_batches_chronology ON openerp.bank_connector_batches (book_id, consent_id, ((body ->> 'receivedAt'::text)) DESC, id DESC);
CREATE INDEX bank_connector_batches_consent_inventory ON openerp.bank_connector_batches (book_id, consent_id, id);
CREATE INDEX bank_connector_records_external ON openerp.bank_connector_records (book_id, consent_id, external_id);
CREATE INDEX case_plan_event ON openerp.change_sets (book_id, ((plan #>> '{groups,0,actions,0,eventId}'::text[])));
CREATE INDEX posting_recovery_change_order ON openerp.change_sets (book_id, created_at DESC, id DESC);
CREATE INDEX closing_proposals_discovery ON openerp.closing_proposals (book_id, period_id, id COLLATE "C");
CREATE INDEX collection_dispute_history ON openerp.collection_disputes (book_id, customer_id, ((body ->> 'createdAt'::text)) COLLATE "C", id COLLATE "C");
CREATE INDEX collection_dispute_invoice ON openerp.collection_disputes (book_id, invoice_id);
CREATE INDEX collection_action_history ON openerp.collection_events (book_id, customer_id, ((body ->> 'createdAt'::text)) COLLATE "C", id COLLATE "C");
CREATE INDEX collection_event_customer ON openerp.collection_events (book_id, customer_id);
CREATE INDEX collection_statement_history ON openerp.collection_statements (book_id, customer_id, ((body ->> 'createdAt'::text)) COLLATE "C", id COLLATE "C");
CREATE INDEX posting_recovery_command_change ON openerp.command_receipts (book_id, COALESCE((result ->> 'changeSetId'::text), (result ->> 'id'::text)), recorded_at DESC, key DESC) WHERE (operation = ANY (ARRAY['prepare_journal'::text, 'prepare_correction'::text, 'validate_change'::text, 'approve_change'::text, 'execute_change'::text]));
CREATE INDEX commerce_allocation_invoice ON openerp.commerce_allocation_legs (book_id, invoice_id);
CREATE INDEX commerce_allocation_payment ON openerp.commerce_allocation_legs (book_id, payment_voucher_id, payment_line_id);
CREATE INDEX commerce_unallocation_target ON openerp.commerce_allocation_reversal_plans (book_id, receipt_id);
CREATE INDEX commerce_fx_item_status ON openerp.commerce_fx_items (book_id, event_id);
CREATE INDEX commerce_fx_correction_settlement ON openerp.commerce_fx_settlement_corrections (book_id, settlement_id);
CREATE INDEX commerce_fx_settlement_item ON openerp.commerce_fx_settlements (book_id, item_id);
CREATE INDEX commerce_fx_settlement_profile_item ON openerp.commerce_fx_settlements (book_id, item_id, profile, leg_ordinal);
CREATE INDEX commerce_invoice_account ON openerp.commerce_invoices (book_id, control_account_id);
CREATE INDEX crm_party_annotations_party ON openerp.crm_party_annotations (book_id, party_id, id);
CREATE INDEX deadline_activity_history_obligation ON openerp.deadline_activity_history (book_id, obligation_id, recorded_at, id);
CREATE INDEX deadline_due ON openerp.deadline_obligations (book_id, due_at);
CREATE INDEX firm_member_actor ON openerp.firm_members (actor_id, firm_id);
CREATE UNIQUE INDEX invoice_delivery_unique_destination ON openerp.invoice_delivery_requests (book_id, capture_id, channel, (((body -> 'input'::text) ->> 'destination'::text)));
CREATE INDEX invoice_issue_review_event ON openerp.invoice_issue_reviews (book_id, event_id);
CREATE INDEX invoice_issue_review_evidence ON openerp.invoice_issue_reviews (book_id, evidence_id);
CREATE INDEX owner_allocation_claim ON openerp.owner_allocation_legs (book_id, claim_id);
CREATE INDEX owner_allocation_settlement ON openerp.owner_allocation_legs (book_id, settlement_id);
CREATE INDEX owner_effect_account ON openerp.owner_effects (book_id, account_id, posting_date);
CREATE INDEX owner_record_owner ON openerp.owner_records (book_id, owner_id, occurred_on);
CREATE INDEX payroll_revisions_employee ON openerp.payroll_revisions (book_id, employee_id, kind, effective_on, id);
CREATE INDEX posting_saved_order ON openerp.posting_saved_requests (book_id, saved_at DESC, key DESC);
CREATE UNIQUE INDEX one_preparation_job ON openerp.preparation_jobs (book_id, run_id) WHERE (state = 'ready'::text);
CREATE INDEX preparation_job_dispatch ON openerp.preparation_jobs (executor_id, checked_at) WHERE (state = 'ready'::text);
CREATE INDEX sie_financial_proposals_cursor ON openerp.sie_financial_proposals (book_id, run_id, ordinal, created_at DESC);
CREATE UNIQUE INDEX one_live_sie_financial_run ON openerp.sie_financial_runs (book_id) WHERE (status = ANY (ARRAY['running'::text, 'paused'::text]));
CREATE INDEX supplier_acceptance_review_event ON openerp.supplier_acceptance_reviews (book_id, event_id);
CREATE INDEX supplier_acceptance_review_evidence ON openerp.supplier_acceptance_reviews (book_id, evidence_id);
CREATE INDEX supplier_credits_invoice ON openerp.supplier_credits (book_id, invoice_id);
CREATE INDEX vat_control_approval_review ON openerp.vat_control_reclassification_approvals (book_id, review_id, expires_at);
CREATE INDEX vat_control_contribution_fact ON openerp.vat_control_reclassification_contributions (book_id, fact_id, voucher_id, line_id);
CREATE INDEX vat_control_contribution_voucher ON openerp.vat_control_reclassification_contributions (book_id, voucher_id, line_id);
CREATE INDEX vat_control_review_obligation ON openerp.vat_control_reclassification_reviews (book_id, obligation_id, ordinal);
CREATE INDEX vat_control_obligation_interval ON openerp.vat_reporting_obligations (book_id, starts_on, ends_on);
CREATE UNIQUE INDEX one_reversal_per_voucher ON openerp.vouchers (book_id, corrects_voucher_id) WHERE (posting_purpose = 'reversal'::text);

-- Better Auth indexes.
CREATE INDEX account_user_id_idx ON openerp_auth.account (user_id);
CREATE INDEX session_user_id_idx ON openerp_auth.session (user_id);
CREATE INDEX verification_identifier_idx ON openerp_auth.verification (identifier);
