-- NEXT-26 supplier extraction requests and field-level reviewed merge. Forward
-- migration on the reviewed 0001-0003 baseline plus 0004/0005, which are not
-- renumbered or revived.
--
-- The application owns the extraction lifecycle, provenance rules, the three-way
-- merge and the human review. This file carries structure, the existing
-- immutable-record guards and the runtime grants only: no feature procedure, no
-- calculator, no dispatcher and no session context.
--
-- One request names the exact retained original, engine release and page
-- selection it was admitted against. One immutable attempt result exists per
-- request and source hash, so a redelivered job cannot record a second result
-- identity. Field decisions are immutable human facts, never a second draft
-- authority: the reviewed draft stays with the existing supplier draft owner and
-- an accepted economic document is never revised here.

-- The admitted basis of one extraction request. Fully immutable: the original
-- hash, byte length, engine release, page selection and attempt identity that a
-- request was admitted against can never be rewritten after the fact. The engine
-- release is a reviewed code release, not a data row, so changing the extraction
-- algorithm requires a new contract literal rather than a new record.
CREATE TABLE openerp.supplier_extraction_requests (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  generation integer NOT NULL,
  original_hash text NOT NULL,
  original_bytes bigint NOT NULL,
  engine_release text NOT NULL,
  attempt_identity text NOT NULL,
  requested_by text NOT NULL,
  requested_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_extraction_requests_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_extraction_requests_book_id_occurrence_id_generation_key UNIQUE (book_id, occurrence_id, generation),
  CONSTRAINT supplier_extraction_requests_generation_check CHECK (generation >= 1 AND generation <= 1000),
  CONSTRAINT supplier_extraction_requests_original_bytes_check CHECK (original_bytes >= 1),
  CONSTRAINT supplier_extraction_requests_original_hash_check CHECK (original_hash ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT supplier_extraction_requests_attempt_identity_check CHECK (attempt_identity ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT supplier_extraction_requests_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT supplier_extraction_requests_body_check CHECK (body ->> 'id'::text = id AND body ->> 'occurrenceId'::text = occurrence_id AND body ->> 'generation'::text = generation::text AND body ->> 'engineRelease'::text = engine_release AND body ->> 'originalHash'::text = original_hash AND body ->> 'attemptIdentity'::text = attempt_identity),
  CONSTRAINT supplier_extraction_requests_body_size_check CHECK (octet_length(body::text) <= 16384),
  CONSTRAINT supplier_extraction_requests_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT supplier_extraction_requests_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.supplier_inbox(book_id, occurrence_id),
  CONSTRAINT supplier_extraction_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES openerp.actors(id)
);
CREATE INDEX supplier_extraction_requests_occurrence_idx
  ON openerp.supplier_extraction_requests (book_id, occurrence_id, generation);

-- The one mutable record per request: the application-owned durable intent the
-- effect-mq runner rediscovers, plus its cancellation fence. Split from the
-- admitted basis so the basis stays append-only under the same reviewed
-- immutable_row guard the rest of this schema uses.
CREATE TABLE openerp.supplier_extraction_request_states (
  book_id text NOT NULL,
  request_id text NOT NULL,
  state text NOT NULL,
  cancel_version integer NOT NULL,
  attempts_made integer NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT supplier_extraction_request_states_pkey PRIMARY KEY (book_id, request_id),
  CONSTRAINT supplier_extraction_request_states_state_check CHECK (state = ANY (ARRAY['ready'::text, 'completed'::text, 'unknown'::text, 'superseded'::text, 'cancelled'::text])),
  CONSTRAINT supplier_extraction_request_states_cancel_version_check CHECK (cancel_version >= 0 AND cancel_version <= 1000),
  CONSTRAINT supplier_extraction_request_states_attempts_made_check CHECK (attempts_made >= 0 AND attempts_made <= 1000),
  CONSTRAINT supplier_extraction_request_states_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.supplier_extraction_requests(book_id, id)
);
-- Bounded dispatch rediscovery over ready work only; the runner claims with SKIP
-- LOCKED, which is dispatch work and never a contended financial record.
CREATE INDEX supplier_extraction_request_states_dispatch_idx
  ON openerp.supplier_extraction_request_states (book_id, state)
  WHERE state = 'ready'::text;

-- One immutable human field decision per review, field and draft line position.
-- The retained base, current and suggested values are the exact typed values the
-- three-way merge compared, so a later draft revision cannot rewrite the record
-- of what a reviewer actually chose.
CREATE TABLE openerp.supplier_field_decisions (
  book_id text NOT NULL,
  id text NOT NULL,
  occurrence_id text NOT NULL,
  request_id text NOT NULL,
  attempt_id text NOT NULL,
  draft_id text NOT NULL,
  draft_revision bigint NOT NULL,
  line_ordinal integer NOT NULL,
  field_key text NOT NULL,
  decision_kind text NOT NULL,
  reviewer text NOT NULL,
  recorded_at timestamptz NOT NULL,
  digest text NOT NULL,
  body jsonb NOT NULL,
  CONSTRAINT supplier_field_decisions_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT supplier_field_decisions_field_key UNIQUE (book_id, attempt_id, draft_id, draft_revision, line_ordinal, field_key),
  CONSTRAINT supplier_field_decisions_line_ordinal_check CHECK (line_ordinal >= 0 AND line_ordinal <= 50),
  CONSTRAINT supplier_field_decisions_draft_revision_check CHECK (draft_revision >= 1 AND draft_revision <= 50),
  CONSTRAINT supplier_field_decisions_decision_kind_check CHECK (decision_kind = ANY (ARRAY['accepted_suggestion'::text, 'retained_reviewed'::text, 'resolved_conflict'::text])),
  CONSTRAINT supplier_field_decisions_digest_check CHECK (digest = openerp.digest(body - 'digest'::text)),
  CONSTRAINT supplier_field_decisions_body_check CHECK (body ->> 'id'::text = id AND body ->> 'occurrenceId'::text = occurrence_id AND body ->> 'attemptId'::text = attempt_id AND body ->> 'requestId'::text = request_id AND body ->> 'draftId'::text = draft_id AND body ->> 'draftRevision'::text = draft_revision::text AND body ->> 'lineOrdinal'::text = line_ordinal::text AND body ->> 'fieldKey'::text = field_key AND body ->> 'decisionKind'::text = decision_kind AND body ->> 'reviewer'::text = reviewer),
  CONSTRAINT supplier_field_decisions_body_size_check CHECK (octet_length(body::text) <= 32768),
  CONSTRAINT supplier_field_decisions_book_id_fkey FOREIGN KEY (book_id) REFERENCES openerp.books(id),
  CONSTRAINT supplier_field_decisions_book_id_occurrence_id_fkey FOREIGN KEY (book_id, occurrence_id) REFERENCES openerp.supplier_inbox(book_id, occurrence_id),
  CONSTRAINT supplier_field_decisions_book_id_request_id_fkey FOREIGN KEY (book_id, request_id) REFERENCES openerp.supplier_extraction_requests(book_id, id),
  CONSTRAINT supplier_field_decisions_book_id_attempt_id_fkey FOREIGN KEY (book_id, attempt_id) REFERENCES openerp.supplier_extraction_attempts(book_id, id),
  CONSTRAINT supplier_field_decisions_book_id_draft_id_fkey FOREIGN KEY (book_id, draft_id) REFERENCES openerp.supplier_invoice_drafts(book_id, id),
  CONSTRAINT supplier_field_decisions_reviewer_fkey FOREIGN KEY (reviewer) REFERENCES openerp.actors(id)
);
CREATE INDEX supplier_field_decisions_draft_idx
  ON openerp.supplier_field_decisions (book_id, draft_id, line_ordinal, field_key);

-- One recorded result identity per request and verified source hash. Redelivering
-- the same job converges on the retained attempt instead of appending a second
-- one. A caller-recorded attempt carries no request and is outside this identity.
CREATE UNIQUE INDEX supplier_extraction_attempts_request_source_key
  ON openerp.supplier_extraction_attempts (book_id, (body ->> 'requestId'::text), (body ->> 'sourceHash'::text))
  WHERE body ->> 'requestId'::text IS NOT NULL;

-- Immutable history. The guard functions and the canonicalization helpers are the
-- ones 0001-0003 already reviewed; this migration declares no function.
CREATE TRIGGER immutable_supplier_extraction_request
  BEFORE DELETE OR UPDATE ON openerp.supplier_extraction_requests
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_supplier_field_decision
  BEFORE DELETE OR UPDATE ON openerp.supplier_field_decisions
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role receives only the records this release uses. The admitted
-- request basis is append-only; the lifecycle row is column-scoped.
GRANT SELECT, INSERT ON TABLE openerp.supplier_extraction_requests,
  openerp.supplier_field_decisions TO openerp_runtime;
GRANT SELECT, INSERT ON TABLE openerp.supplier_extraction_request_states
  TO openerp_runtime;
GRANT UPDATE (state, cancel_version, attempts_made, updated_at)
  ON TABLE openerp.supplier_extraction_request_states TO openerp_runtime;
