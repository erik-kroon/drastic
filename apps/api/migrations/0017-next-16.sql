-- NEXT-16: the period-work manifest, its children, and the fixed approval batch.
--
-- A period-work manifest is a frozen selection. It records the requested
-- interval, the cutoff, the exact source coverage the selection was cut from
-- and every child it selected, each child carrying its own economic identity
-- and the exact source revision it was selected at. A source that arrives after
-- the manifest was sealed is simply not in it; selecting it requires a new
-- manifest rather than an edit to this one, which is why the manifest is
-- immutable.
--
-- A child row is the mutable run-owned progress of one unit of work. It
-- distinguishes a child that is prepared, committed, refused, waiting on a
-- predecessor and needing review, because those are different facts and an
-- operator reads them differently. The child revision fence is what lets a
-- queue redelivery be rejected rather than double-published; the run
-- cancellation version is what stops a stale handler publishing new work.
--
-- An approval batch is an explicit fixed manifest of already sealed member
-- plans. It records the exact plan identity and digest a human approved, so one
-- gesture covers exactly those members and never a later arrival. The
-- batch-to-child-approval membership is retained so a later read can prove which
-- gesture covered which child.
--
-- This file declares no function, no policy, no default value and no
-- dispatcher. It holds scoped references, storage uniqueness, ordinary shape
-- checks, the immutability of a sealed manifest and batch, and the exact
-- digests the application computed. Which owner a child routes to, which rule
-- applies, whether a predecessor has committed and whether a plan is stale are
-- application-owned decisions in apps/api/src/application/period-work and
-- @open-erp/domain/period-work.

-- The frozen selection. Immutable once written.
CREATE TABLE openerp.period_work_manifests (
  book_id text NOT NULL,
  id text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  -- The cutoff the selection was captured at, distinct from the interval the
  -- work covers. A later cutoff is a later manifest.
  cutoff date NOT NULL,
  -- Whether the population this selection was cut from was complete. A run
  -- whose children are all visited is still not a reconciled period, and this
  -- column is how that is stated rather than implied.
  population_complete boolean NOT NULL,
  selected_count integer NOT NULL,
  -- The children and the coverage, exactly as the application computed them.
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_work_manifests_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT period_work_manifests_interval_check CHECK (starts_on <= ends_on),
  CONSTRAINT period_work_manifests_cutoff_check CHECK (cutoff >= ends_on),
  CONSTRAINT period_work_manifests_selected_count_check CHECK (selected_count >= 0 AND selected_count <= 500),
  CONSTRAINT period_work_manifests_id_check CHECK (id ~ '^period_work_manifest_[0-9a-f]{32}$'::text),
  -- The stored bytes are exactly what was digested. A generic JSON digest and a
  -- versioned canonical-document digest are not interchangeable.
  CONSTRAINT period_work_manifests_digest_check CHECK (openerp.digest(body - 'digest') = digest)
);

-- The mutable run-owned progress of one unit of work. This is the checkpoint a
-- redelivered queue message is fenced against.
CREATE TABLE openerp.period_work_children (
  book_id text NOT NULL,
  work_identity text NOT NULL,
  manifest_id text NOT NULL,
  -- The economic identity and the exact source revision this child was frozen
  -- at. Both are copied from the manifest, never re-derived at execution.
  economic_identity text NOT NULL,
  source_revision text NOT NULL,
  state text NOT NULL,
  -- Incremented on every accepted state change. A handler that captured an
  -- older revision is stale and its result is not published.
  revision bigint NOT NULL DEFAULT 1,
  -- Incremented when an operator cancels the run. A stale handler holding an
  -- older cancellation version cannot publish new work or execute anything.
  cancel_version bigint NOT NULL DEFAULT 0,
  -- The sealed plan this child prepared, and the receipt it committed or
  -- recovered. A committed child keeps its receipt even if the plan is later
  -- read as stale; an expired approval never erases a committed result.
  plan_id text,
  plan_digest text,
  receipt_id text,
  -- The exact missing facts when the child needs review, and the reason when it
  -- refused. Never free text standing in for a typed fact.
  missing_facts jsonb,
  refusal_reason text,
  -- The batch this child was approved under, so a read can prove which gesture
  -- covered it.
  batch_id text,
  -- The owning operation routing resolved to when this child was advanced, and
  -- the sealed plan and review that operation produced. Every value is a real
  -- named operation. A child that is waiting, needs review or refused has no
  -- owner, because nothing was dispatched.
  routed_owner text,
  owner_review_id text,
  owner_review_digest text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_work_children_pkey PRIMARY KEY (book_id, work_identity),
  CONSTRAINT period_work_children_state_check CHECK (state = ANY (ARRAY['pending'::text, 'waiting_predecessor'::text, 'needs_review'::text, 'prepared'::text, 'recovered'::text, 'committed'::text, 'refused'::text])),
  CONSTRAINT period_work_children_revision_check CHECK (revision >= 1 AND revision < 1000000000),
  CONSTRAINT period_work_children_cancel_version_check CHECK (cancel_version >= 0 AND cancel_version < 1000000000),
  CONSTRAINT period_work_children_routed_owner_check CHECK (routed_owner IS NULL OR routed_owner = ANY (ARRAY['purchases.recognition'::text, 'purchases.credits'::text, 'owner.operations'::text, 'commerce.invoice'::text])),
  -- A child names its routed owner and that owner's review together or names
  -- none of the three. A batch member is proved from the child, never from the
  -- batch's own claim about it.
  CONSTRAINT period_work_children_owner_shape_check CHECK ((routed_owner IS NULL) = (owner_review_id IS NULL) AND (owner_review_id IS NULL) = (owner_review_digest IS NULL)),
  -- A prepared child names its plan and its digest together or names neither.
  -- A committed or recovered child names a receipt.
  CONSTRAINT period_work_children_plan_shape_check CHECK ((plan_id IS NULL) = (plan_digest IS NULL)),
  CONSTRAINT period_work_children_prepared_shape_check CHECK (state <> 'prepared'::text OR (plan_id IS NOT NULL AND receipt_id IS NULL)),
  CONSTRAINT period_work_children_settled_shape_check CHECK (state NOT IN ('committed'::text, 'recovered'::text) OR receipt_id IS NOT NULL),
  -- A child that needs review names its missing facts; a child that refused
  -- names its reason. Neither is a nullable field standing in for silence.
  CONSTRAINT period_work_children_review_shape_check CHECK (state <> 'needs_review'::text OR missing_facts IS NOT NULL),
  CONSTRAINT period_work_children_refused_shape_check CHECK (state <> 'refused'::text OR refusal_reason IS NOT NULL),
  -- A batch is only meaningful for a child a batch actually moved.
  CONSTRAINT period_work_children_batch_shape_check CHECK (batch_id IS NULL OR state IN ('prepared'::text, 'committed'::text, 'recovered'::text, 'refused'::text)),
  CONSTRAINT period_work_children_manifest_fkey FOREIGN KEY (book_id, manifest_id) REFERENCES openerp.period_work_manifests(book_id, id),
  CONSTRAINT period_work_children_plan_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.change_sets(book_id, id)
);

CREATE INDEX period_work_children_manifest_order
  ON openerp.period_work_children (book_id, manifest_id, work_identity);
CREATE INDEX period_work_children_open
  ON openerp.period_work_children (book_id, manifest_id, state)
  WHERE state IN ('pending'::text, 'waiting_predecessor'::text, 'needs_review'::text, 'prepared'::text);

-- The sealed fixed manifest a human approved. Immutable once written.
CREATE TABLE openerp.period_work_batches (
  book_id text NOT NULL,
  id text NOT NULL,
  manifest_id text NOT NULL,
  member_count integer NOT NULL,
  -- Informational only, shown beside the members. It is never a journal line
  -- and never a balancing figure.
  combined_informational_minor numeric(38, 0) NOT NULL,
  body jsonb NOT NULL,
  digest text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_work_batches_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT period_work_batches_member_count_check CHECK (member_count >= 1 AND member_count <= 200),
  CONSTRAINT period_work_batches_id_check CHECK (id ~ '^period_work_batch_[0-9a-f]{32}$'::text),
  CONSTRAINT period_work_batches_digest_check CHECK (openerp.digest(body - 'digest') = digest),
  CONSTRAINT period_work_batches_manifest_fkey FOREIGN KEY (book_id, manifest_id) REFERENCES openerp.period_work_manifests(book_id, id)
);

-- The batch a child was approved under is a forward reference: the batch is
-- sealed after the children it moves, so its constraint is added once the
-- batch table exists.
ALTER TABLE openerp.period_work_children
  ADD CONSTRAINT period_work_children_batch_fkey
  FOREIGN KEY (book_id, batch_id) REFERENCES openerp.period_work_batches(book_id, id);

-- One immutable, deterministic member of a sealed batch.
CREATE TABLE openerp.period_work_batch_members (
  book_id text NOT NULL,
  batch_id text NOT NULL,
  ordinal integer NOT NULL,
  -- The owning operation this member is dispatched to. A batch never
  -- dispatches to an owner other than the member's own.
  owner text NOT NULL,
  plan_id text NOT NULL,
  plan_digest text NOT NULL,
  input_identity text NOT NULL,
  work_identity text NOT NULL,
  -- The owning operation's own review and review digest. The batch approval is a
  -- human gesture over these exact members; each member's own approval stays
  -- with its owner and is what that owner's execute consumes.
  owner_review_id text NOT NULL,
  owner_review_digest text NOT NULL,
  CONSTRAINT period_work_batch_members_pkey PRIMARY KEY (book_id, batch_id, ordinal),
  CONSTRAINT period_work_batch_members_ordinal_check CHECK (ordinal >= 1 AND ordinal <= 200),
  CONSTRAINT period_work_batch_members_owner_check CHECK (owner = ANY (ARRAY['purchases.recognition'::text, 'purchases.credits'::text, 'owner.operations'::text, 'commerce.invoice'::text])),
  CONSTRAINT period_work_batch_members_batch_fkey FOREIGN KEY (book_id, batch_id) REFERENCES openerp.period_work_batches(book_id, id),
  CONSTRAINT period_work_batch_members_plan_fkey FOREIGN KEY (book_id, plan_id) REFERENCES openerp.change_sets(book_id, id),
  -- A member names a child of a manifest. The same child cannot be a member of
  -- two batches, which is what stops one gesture covering a duplicate
  -- economic effect. The owner, plan and review are the ones the child itself
  -- recorded when it was advanced, so a batch cannot claim a different owner for
  -- a child than the one that actually prepared the plan.
  CONSTRAINT period_work_batch_members_work_fkey FOREIGN KEY (book_id, work_identity) REFERENCES openerp.period_work_children(book_id, work_identity)
);

-- The batch's own claim about a member must agree with the child's own record.
-- This is a calendar-relationship guard in the same shape as the reviewed
-- 0002 helpers: it never computes anything, it only refuses a claim the child
-- row does not support. It is not runtime-callable.
CREATE FUNCTION openerp.period_work_batch_member_agrees() RETURNS trigger
  SECURITY DEFINER
  LANGUAGE plpgsql
  VOLATILE
  PARALLEL UNSAFE
  SET search_path TO pg_catalog, openerp, pg_temp
AS $guard$

BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM openerp.period_work_children c
     WHERE c.book_id = NEW.book_id
       AND c.work_identity = NEW.work_identity
       AND c.routed_owner = NEW.owner
       AND c.plan_id = NEW.plan_id
       AND c.plan_digest = NEW.plan_digest
       AND c.owner_review_id = NEW.owner_review_id
       AND c.owner_review_digest = NEW.owner_review_digest
  ) THEN
    PERFORM openerp.fail('Forbidden', 'The batch member does not match the child that was advanced.');
    RETURN NULL;
  END IF;

  RETURN NEW;
END $guard$;

CREATE TRIGGER period_work_batch_member_agrees
  BEFORE INSERT ON openerp.period_work_batch_members
  FOR EACH ROW EXECUTE FUNCTION openerp.period_work_batch_member_agrees();

CREATE UNIQUE INDEX period_work_batch_members_work_uniq
  ON openerp.period_work_batch_members (book_id, work_identity);

-- Which exact gesture covered which exact batch member.
--
-- There is deliberately no foreign key to a shared approvals table. Each owner
-- keeps its own approval authority in its own table, and a batch member of one
-- owner is not an approval in another's. The owning operation mints the
-- approval this row names, through that owner's own rules and inside the
-- approving transaction; this table records the gesture and the reference, and
-- the authority itself stays where the owner put it.
CREATE TABLE openerp.period_work_batch_approvals (
  book_id text NOT NULL,
  batch_id text NOT NULL,
  -- One row per member, so a batch of N members is provably covered by N
  -- approvals rather than by one.
  member_ordinal integer NOT NULL,
  -- The owner whose rules approved this member.
  owner text NOT NULL,
  -- The owner's own approval for this member's plan. It is a reference, not an
  -- authority: nothing here decides whether it is current, unconsumed or
  -- unexpired, because only the owner may decide that.
  owner_approval_id text NOT NULL,
  -- The plan digest the owner's approval was minted against, retained so a later
  -- read can show what the gesture covered without re-deriving it.
  plan_digest text NOT NULL,
  approver_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_work_batch_approvals_pkey PRIMARY KEY (book_id, batch_id, member_ordinal),
  CONSTRAINT period_work_batch_approvals_ordinal_check CHECK (member_ordinal >= 1 AND member_ordinal <= 200),
  CONSTRAINT period_work_batch_approvals_owner_check CHECK (owner = ANY (ARRAY['purchases.recognition'::text, 'purchases.credits'::text, 'owner.operations'::text, 'commerce.invoice'::text])),
  CONSTRAINT period_work_batch_approvals_member_fkey FOREIGN KEY (book_id, batch_id, member_ordinal) REFERENCES openerp.period_work_batch_members(book_id, batch_id, ordinal),
  CONSTRAINT period_work_batch_approvals_batch_fkey FOREIGN KEY (book_id, batch_id) REFERENCES openerp.period_work_batches(book_id, id)
);

-- A sealed manifest is the frozen selection. A new selection is a new manifest.
CREATE TRIGGER immutable_period_work_manifest
  BEFORE DELETE OR UPDATE ON openerp.period_work_manifests
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- A sealed batch is the exact set a human approved. Later arrivals never join
-- it, and an approved member is never removed from it.
CREATE TRIGGER immutable_period_work_batch
  BEFORE DELETE OR UPDATE ON openerp.period_work_batches
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_period_work_batch_member
  BEFORE DELETE OR UPDATE ON openerp.period_work_batch_members
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The runtime role appends a manifest, a batch and its members, and advances
-- child progress with a column-limited UPDATE. It cannot rewrite a sealed
-- selection or a sealed batch, and it cannot delete a child.
GRANT SELECT, INSERT ON TABLE openerp.period_work_manifests, openerp.period_work_batches,
  openerp.period_work_batch_members, openerp.period_work_batch_approvals,
  openerp.period_work_children TO openerp_runtime;

-- Child progress is a checkpoint, not history. Only the advance columns are
-- writable, and revision and cancel_version move together with the state they
-- fence, so a stale handler cannot advance a child it did not observe.
GRANT UPDATE (state, revision, cancel_version, plan_id, plan_digest, receipt_id, missing_facts, refusal_reason, batch_id, routed_owner, owner_review_id, owner_review_digest, updated_at)
  ON TABLE openerp.period_work_children TO openerp_runtime;
