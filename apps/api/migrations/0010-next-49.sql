-- NEXT-49: rule-change impact and evidence-backed obligation fulfillment.
-- Forward migration on the reviewed 0001-0003 baseline plus 0004-next-02.sql.
-- The baseline is not renumbered or revived.
--
-- A statutory due date is a qualified input, never a computed default. The
-- obligation retains the reviewed rule and calendar release that produced it,
-- the environment it may be fulfilled in, and the amendment it supersedes.
--
-- Fulfillment replaces an arbitrary operator string with a typed link whose
-- reference is resolved against the record's own owner. A rule change records
-- an immutable notice, a frozen target snapshot and reviewed decisions. Nothing
-- here rewrites a committed artifact or a historical report.
--
-- The application owns selection, classification, verification and policy. This
-- file carries structure, the reviewed immutable-row guard and the runtime
-- grants only: no function, no calculator, no dispatcher, no session context.

CREATE TABLE openerp.rule_change_notices (
  book_id text NOT NULL,
  id text NOT NULL,
  old_release_id text NOT NULL,
  new_release_id text NOT NULL,
  change_kind text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  reason text NOT NULL,
  qualification_evidence jsonb NOT NULL,
  changed_selectors text[] NOT NULL,
  captured_by text NOT NULL,
  captured_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT rule_change_notices_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT rule_change_notices_release_key UNIQUE (book_id, old_release_id, new_release_id),
  CONSTRAINT rule_change_notices_change_kind_check CHECK (change_kind = ANY (ARRAY['applicability'::text, 'calculation'::text, 'schedule'::text])),
  CONSTRAINT rule_change_notices_release_check CHECK (old_release_id <> new_release_id),
  CONSTRAINT rule_change_notices_interval_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT rule_change_notices_selectors_check CHECK (cardinality(changed_selectors) BETWEEN 1 AND 20 AND array_position(changed_selectors, NULL) IS NULL),
  CONSTRAINT rule_change_notices_evidence_check CHECK (jsonb_typeof(qualification_evidence) = 'object'::text AND octet_length(qualification_evidence::text) <= 16384),
  CONSTRAINT rule_change_notices_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT rule_change_notices_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'oldReleaseId'::text = old_release_id AND body ->> 'newReleaseId'::text = new_release_id AND body ->> 'changeKind'::text = change_kind),
  CONSTRAINT rule_change_notices_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT rule_change_notices_old_release_id_fkey FOREIGN KEY (old_release_id) REFERENCES openerp.rule_releases(id),
  CONSTRAINT rule_change_notices_new_release_id_fkey FOREIGN KEY (new_release_id) REFERENCES openerp.rule_releases(id),
  CONSTRAINT rule_change_notices_captured_by_fkey FOREIGN KEY (captured_by) REFERENCES openerp.actors(id)
);

-- A snapshot freezes target identity, revision and cutoff before any paging, so a
-- later posting cannot change what one captured impact already means.
CREATE TABLE openerp.rule_impact_snapshots (
  book_id text NOT NULL,
  id text NOT NULL,
  notice_id text NOT NULL,
  recorded_cutoff timestamptz NOT NULL,
  complete_target_membership boolean NOT NULL,
  total_targets integer NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT rule_impact_snapshots_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT rule_impact_snapshots_total_check CHECK (total_targets >= 0),
  CONSTRAINT rule_impact_snapshots_complete_check CHECK (complete_target_membership = (total_targets <= 500)),
  CONSTRAINT rule_impact_snapshots_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'noticeId'::text = notice_id AND NOT (body ->> 'totalTargets'::text) IS DISTINCT FROM total_targets::text),
  CONSTRAINT rule_impact_snapshots_book_id_notice_id_fkey FOREIGN KEY (book_id, notice_id) REFERENCES openerp.rule_change_notices(book_id, id)
);

CREATE TABLE openerp.rule_impact_targets (
  book_id text NOT NULL,
  snapshot_id text NOT NULL,
  ordinal integer NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  target_revision text NOT NULL,
  family text NOT NULL,
  period_id text,
  period_starts_on date,
  period_ends_on date,
  used_rule text NOT NULL,
  basis_digest text NOT NULL,
  impact_kind text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT rule_impact_targets_pkey PRIMARY KEY (book_id, snapshot_id, ordinal),
  CONSTRAINT rule_impact_targets_target_key UNIQUE (book_id, snapshot_id, target_kind, target_id),
  CONSTRAINT rule_impact_targets_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT rule_impact_targets_kind_check CHECK (target_kind = ANY (ARRAY['deadline_obligation'::text, 'company_activation'::text])),
  CONSTRAINT rule_impact_targets_family_check CHECK (family = ANY (ARRAY['posting_eligibility'::text, 'vat'::text, 'payroll'::text, 'statements'::text, 'legal_ar'::text])),
  CONSTRAINT rule_impact_targets_impact_kind_check CHECK (impact_kind = ANY (ARRAY['outside_effective_scope'::text, 'applicability_changed'::text, 'calculation_changed'::text, 'schedule_changed'::text, 'undetermined'::text])),
  CONSTRAINT rule_impact_targets_period_check CHECK ((period_starts_on IS NULL) = (period_ends_on IS NULL) AND (period_starts_on IS NULL OR period_ends_on >= period_starts_on)),
  CONSTRAINT rule_impact_targets_body_check CHECK (body ->> 'targetId'::text = target_id AND body ->> 'impactKind'::text = impact_kind AND body -> 'scope'::text ->> 'bookId'::text = book_id),
  CONSTRAINT rule_impact_targets_book_id_snapshot_id_fkey FOREIGN KEY (book_id, snapshot_id) REFERENCES openerp.rule_impact_snapshots(book_id, id)
);
CREATE INDEX rule_impact_targets_scan ON openerp.rule_impact_targets (book_id, snapshot_id, ordinal);

-- One decided case per notice, target and revision, so a restart converges
-- instead of opening a duplicate amendment case.
CREATE TABLE openerp.rule_impact_decisions (
  book_id text NOT NULL,
  id text NOT NULL,
  snapshot_id text NOT NULL,
  notice_id text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  target_revision text NOT NULL,
  decision_kind text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL,
  proposed_successor jsonb,
  reviewer text NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT rule_impact_decisions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT rule_impact_decisions_case_key UNIQUE (book_id, notice_id, target_kind, target_id, target_revision),
  CONSTRAINT rule_impact_decisions_kind_check CHECK (decision_kind = ANY (ARRAY['unaffected_with_reason'::text, 'reprepare'::text, 'amend'::text, 'human_review'::text])),
  CONSTRAINT rule_impact_decisions_successor_check CHECK ((decision_kind = 'amend'::text) = (proposed_successor IS NOT NULL)),
  CONSTRAINT rule_impact_decisions_successor_object_check CHECK (proposed_successor IS NULL OR jsonb_typeof(proposed_successor) = 'object'::text),
  CONSTRAINT rule_impact_decisions_evidence_check CHECK (jsonb_typeof(evidence) = 'object'::text AND octet_length(evidence::text) <= 8192),
  CONSTRAINT rule_impact_decisions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT rule_impact_decisions_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'decisionKind'::text = decision_kind AND body ->> 'targetId'::text = target_id),
  CONSTRAINT rule_impact_decisions_book_id_snapshot_id_fkey FOREIGN KEY (book_id, snapshot_id) REFERENCES openerp.rule_impact_snapshots(book_id, id),
  CONSTRAINT rule_impact_decisions_target_fkey FOREIGN KEY (book_id, snapshot_id, target_kind, target_id) REFERENCES openerp.rule_impact_targets(book_id, snapshot_id, target_kind, target_id),
  CONSTRAINT rule_impact_decisions_reviewer_fkey FOREIGN KEY (reviewer) REFERENCES openerp.actors(id)
);

-- A fulfillment is evidence, not truth. It records what the reference's own owner
-- was observed to mean, so an unverified observation stays an unverified note.
CREATE TABLE openerp.deadline_fulfillments (
  book_id text NOT NULL,
  id text NOT NULL,
  obligation_id text NOT NULL,
  obligation_revision bigint NOT NULL,
  reference_digest text NOT NULL,
  outcome_kind text NOT NULL,
  reference_kind text NOT NULL,
  reference jsonb NOT NULL,
  environment text NOT NULL,
  verification text NOT NULL,
  reason text NOT NULL,
  witness jsonb NOT NULL,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT deadline_fulfillments_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT deadline_fulfillments_reference_key UNIQUE (book_id, obligation_id, reference_digest),
  CONSTRAINT deadline_fulfillments_obligation_revision_check CHECK (obligation_revision >= 1),
  CONSTRAINT deadline_fulfillments_reference_digest_check CHECK (reference_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT deadline_fulfillments_outcome_kind_check CHECK (outcome_kind = ANY (ARRAY['prepared'::text, 'submitted'::text, 'accepted'::text])),
  CONSTRAINT deadline_fulfillments_reference_kind_check CHECK (reference_kind = ANY (ARRAY['local_prepared_artifact'::text, 'submitted_attempt'::text, 'authority_outcome'::text, 'reviewed_external_evidence'::text])),
  CONSTRAINT deadline_fulfillments_environment_check CHECK (environment = ANY (ARRAY['production'::text, 'sandbox'::text])),
  CONSTRAINT deadline_fulfillments_verification_check CHECK (verification = ANY (ARRAY['satisfied'::text, 'pending'::text, 'mismatch'::text])),
  CONSTRAINT deadline_fulfillments_witness_check CHECK (jsonb_typeof(witness) = 'object'::text AND octet_length(witness::text) <= 8192),
  CONSTRAINT deadline_fulfillments_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT deadline_fulfillments_body_check CHECK (body ->> 'id'::text = id AND body -> 'scope'::text ->> 'bookId'::text = book_id AND body ->> 'obligationId'::text = obligation_id AND body ->> 'verification'::text = verification),
  CONSTRAINT deadline_fulfillments_book_id_obligation_id_fkey FOREIGN KEY (book_id, obligation_id) REFERENCES openerp.deadline_obligations(book_id, id),
  CONSTRAINT deadline_fulfillments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES openerp.actors(id)
);
CREATE INDEX deadline_fulfillments_obligation ON openerp.deadline_fulfillments (book_id, obligation_id, recorded_at, id);
CREATE INDEX deadline_fulfillments_reference ON openerp.deadline_fulfillments (book_id, reference_kind, reference ->> 'owner');

-- The retained qualified basis, the fulfillment environment and the amendment
-- link. Nullable so a released database upgrades; the application refuses an
-- obligation whose qualified input is missing rather than defaulting it.
ALTER TABLE openerp.deadline_obligations
  ADD COLUMN jurisdiction text,
  ADD COLUMN statutory_basis jsonb,
  ADD COLUMN required_environment text,
  ADD COLUMN amends_obligation_id text,
  ADD COLUMN amendment_notice_id text,
  ADD COLUMN amended_outcome_kind text,
  ADD COLUMN amended_outcome_reference text;

ALTER TABLE openerp.deadline_obligations
  ADD CONSTRAINT deadline_obligations_jurisdiction_check CHECK (jurisdiction IS NULL OR jurisdiction ~ '^[A-Z]{2}$'::text),
  ADD CONSTRAINT deadline_obligations_required_environment_check CHECK (required_environment IS NULL OR required_environment = ANY (ARRAY['production'::text, 'sandbox'::text])),
  ADD CONSTRAINT deadline_obligations_amended_outcome_check CHECK (amended_outcome_reference IS NULL OR amended_outcome_kind = ANY (ARRAY['prepared'::text, 'submitted'::text, 'accepted'::text])),
  ADD CONSTRAINT deadline_obligations_amendment_pair_check CHECK ((amends_obligation_id IS NULL) = (amendment_notice_id IS NULL)),
  ADD CONSTRAINT deadline_obligations_statutory_basis_check CHECK (statutory_basis IS NULL OR (statutory_basis ?& ARRAY['jurisdiction'::text, 'family'::text, 'ruleReference'::text, 'ruleVersion'::text, 'calendarReference'::text, 'periodId'::text, 'basisDueAt'::text] AND octet_length(statutory_basis::text) <= 8192)),
  ADD CONSTRAINT deadline_obligations_amends_obligation_id_fkey FOREIGN KEY (book_id, amends_obligation_id) REFERENCES openerp.deadline_obligations(book_id, id),
  ADD CONSTRAINT deadline_obligations_amendment_notice_id_fkey FOREIGN KEY (book_id, amendment_notice_id) REFERENCES openerp.rule_change_notices(book_id, id);

-- The one real retained reference to the rule that produced a due date.
CREATE INDEX deadline_obligations_rule_reference
  ON openerp.deadline_obligations (book_id, ((statutory_basis ->> 'ruleReference'::text)))
  WHERE statutory_basis IS NOT NULL;
CREATE INDEX deadline_obligations_period ON openerp.deadline_obligations (book_id, period_id, id);

-- Immutable history. The guard function is the one 0001-0003 already reviewed;
-- this migration declares no function.
CREATE TRIGGER immutable_rule_change_notice BEFORE DELETE OR UPDATE ON openerp.rule_change_notices FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_rule_impact_snapshot BEFORE DELETE OR UPDATE ON openerp.rule_impact_snapshots FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_rule_impact_target BEFORE DELETE OR UPDATE ON openerp.rule_impact_targets FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_rule_impact_decision BEFORE DELETE OR UPDATE ON openerp.rule_impact_decisions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_deadline_fulfillment BEFORE DELETE OR UPDATE ON openerp.deadline_fulfillments FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role receives only the tables and columns this release writes.
-- Rule releases stay read-only: no application operation writes one.
GRANT SELECT, INSERT ON TABLE openerp.rule_change_notices, openerp.rule_impact_snapshots,
  openerp.rule_impact_targets, openerp.rule_impact_decisions,
  openerp.deadline_fulfillments TO openerp_runtime;
GRANT UPDATE (jurisdiction, statutory_basis, required_environment, amends_obligation_id,
  amendment_notice_id, amended_outcome_kind, amended_outcome_reference)
  ON TABLE openerp.deadline_obligations TO openerp_runtime;
