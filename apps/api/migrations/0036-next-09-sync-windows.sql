-- NEXT-09: complete provider sync windows.
--
-- The connector already retains a cursor and a page batch per delivery, but
-- nothing retained where a window began. A crashed window could not be
-- resumed, and a partial page run looked indistinguishable from a complete
-- one. These tables make the window the unit of truth:
--
--   * bank_sync_streams is the per-consent stream state: the published
--     cursor, its publication version, the current fence and the lease. It is
--     a pointer row, not a financial fact, so it alone is updated in place.
--   * bank_sync_generations is the immutable header of one attempt. Its base
--     cursor and base publication version are what publication re-checks, so
--     a generation that began against a different base can never publish.
--   * bank_sync_pages is the immutable retained page chain. Ordinals are
--     contiguous from zero and each page names the cursor it was requested
--     with, so a gap or a reordered page is not representable.
--   * bank_sync_candidates is the staged change list. These rows are NOT
--     canonical: they are invisible to any reader until the generation's
--     publication marker exists.
--   * bank_sync_publications is that marker. One row per generation, one
--     per stream per from-version, so a generation cannot be published twice
--     and a stream cannot move its published cursor without a marker.
--
-- The lease and the fence are claims, not balances. Losing one delays a
-- window; it never changes an amount.

CREATE TABLE openerp.bank_sync_streams (
  book_id text NOT NULL,
  id text NOT NULL,
  consent_id text NOT NULL,
  -- The last cursor a complete generation published. Page retention alone
  -- never moves this: an unfinished window leaves it exactly where it was.
  published_cursor text NOT NULL DEFAULT '',
  publication_version bigint NOT NULL DEFAULT 0,
  current_generation_id text,
  -- Bumped on every claim. A worker holding a superseded fence is refused at
  -- page append and at publication rather than publishing over a newer claim.
  fence bigint NOT NULL DEFAULT 0,
  lease_until timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sync_streams_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_sync_streams_book_id_consent_id_key UNIQUE (book_id, consent_id),
  CONSTRAINT bank_sync_streams_consent_id_fkey
    FOREIGN KEY (book_id, consent_id) REFERENCES openerp.bank_connector_consents (book_id, id),
  CONSTRAINT bank_sync_streams_cursor_check CHECK (length(published_cursor) <= 256),
  CONSTRAINT bank_sync_streams_version_check
    CHECK (publication_version >= 0 AND publication_version < 1000000000),
  CONSTRAINT bank_sync_streams_fence_check CHECK (fence >= 0 AND fence < 1000000000)
);

CREATE TABLE openerp.bank_sync_generations (
  book_id text NOT NULL,
  id text NOT NULL,
  stream_id text NOT NULL,
  base_cursor text NOT NULL,
  base_publication_version bigint NOT NULL,
  attempt_number bigint NOT NULL,
  fence bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sync_generations_pkey PRIMARY KEY (book_id, id),
  CONSTRAINT bank_sync_generations_stream_fkey
    FOREIGN KEY (book_id, stream_id) REFERENCES openerp.bank_sync_streams (book_id, id),
  CONSTRAINT bank_sync_generations_base_cursor_check CHECK (length(base_cursor) <= 256),
  CONSTRAINT bank_sync_generations_attempt_check
    CHECK (attempt_number >= 0 AND attempt_number < 1000),
  CONSTRAINT bank_sync_generations_fence_check CHECK (fence >= 1 AND fence < 1000000000)
);

CREATE INDEX bank_sync_generations_stream
  ON openerp.bank_sync_generations (book_id, stream_id, created_at desc, id desc);

CREATE TABLE openerp.bank_sync_pages (
  book_id text NOT NULL,
  generation_id text NOT NULL,
  ordinal integer NOT NULL,
  request_cursor text NOT NULL,
  next_cursor text NOT NULL,
  has_more boolean NOT NULL,
  -- The exact retained response bytes, addressed by content. The page row is
  -- the index over evidence that already exists; it holds no copy.
  raw_digest text NOT NULL,
  raw_byte_length integer NOT NULL,
  normalized_changes_digest text NOT NULL,
  record_count integer NOT NULL,
  chained_digest text NOT NULL,
  retained_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sync_pages_pkey PRIMARY KEY (book_id, generation_id, ordinal),
  CONSTRAINT bank_sync_pages_generation_fkey
    FOREIGN KEY (book_id, generation_id) REFERENCES openerp.bank_sync_generations (book_id, id),
  CONSTRAINT bank_sync_pages_content_fkey
    FOREIGN KEY (book_id, raw_digest) REFERENCES openerp.intake_contents (book_id, sha256),
  CONSTRAINT bank_sync_pages_ordinal_check CHECK (ordinal >= 0),
  CONSTRAINT bank_sync_pages_request_cursor_check CHECK (length(request_cursor) <= 256),
  CONSTRAINT bank_sync_pages_next_cursor_check CHECK (length(next_cursor) <= 256),
  CONSTRAINT bank_sync_pages_raw_digest_check CHECK (raw_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT bank_sync_pages_changes_digest_check
    CHECK (normalized_changes_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT bank_sync_pages_chained_digest_check CHECK (chained_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT bank_sync_pages_record_count_check
    CHECK (record_count >= 0 AND record_count <= 20),
  -- A terminal page ends the window. A non-terminal page must not move the
  -- cursor either: an unchanged cursor with changes is refused, and an
  -- unchanged empty poll is the only legal no-progress page.
  CONSTRAINT bank_sync_pages_progress_check CHECK (
    has_more OR next_cursor <> request_cursor OR record_count = 0
  )
);

CREATE TABLE openerp.bank_sync_candidates (
  book_id text NOT NULL,
  generation_id text NOT NULL,
  page_ordinal integer NOT NULL,
  record_ordinal integer NOT NULL,
  kind text NOT NULL,
  source_id text NOT NULL,
  raw_locator text NOT NULL,
  staged_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sync_candidates_pkey
    PRIMARY KEY (book_id, generation_id, page_ordinal, record_ordinal),
  CONSTRAINT bank_sync_candidates_page_fkey
    FOREIGN KEY (book_id, generation_id, page_ordinal)
    REFERENCES openerp.bank_sync_pages (book_id, generation_id, ordinal),
  CONSTRAINT bank_sync_candidates_kind_check
    CHECK (kind = ANY (ARRAY['added'::text, 'modified'::text, 'removed'::text])),
  CONSTRAINT bank_sync_candidates_source_id_check
    CHECK (length(source_id) >= 1 AND length(source_id) <= 256)
);

CREATE TABLE openerp.bank_sync_publications (
  book_id text NOT NULL,
  id text NOT NULL,
  generation_id text NOT NULL,
  stream_id text NOT NULL,
  from_version bigint NOT NULL,
  base_cursor text NOT NULL,
  final_cursor text NOT NULL,
  page_count integer NOT NULL,
  change_count integer NOT NULL,
  manifest_digest text NOT NULL,
  -- A window whose cursor never moved covers only itself. It is never a claim
  -- that historical bank coverage is complete.
  covers_history boolean NOT NULL,
  command_key text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_sync_publications_pkey PRIMARY KEY (book_id, id),
  -- One marker per generation: a generation is published once or not at all.
  CONSTRAINT bank_sync_publications_generation_key UNIQUE (book_id, generation_id),
  -- One marker per stream per from-version: a stream cannot advance its
  -- published cursor twice from the same base.
  CONSTRAINT bank_sync_publications_stream_version_key UNIQUE (book_id, stream_id, from_version),
  CONSTRAINT bank_sync_publications_generation_fkey
    FOREIGN KEY (book_id, generation_id) REFERENCES openerp.bank_sync_generations (book_id, id),
  CONSTRAINT bank_sync_publications_stream_fkey
    FOREIGN KEY (book_id, stream_id) REFERENCES openerp.bank_sync_streams (book_id, id),
  CONSTRAINT bank_sync_publications_manifest_check
    CHECK (manifest_digest ~ '^sha256:[a-f0-9]{64}$'::text),
  CONSTRAINT bank_sync_publications_counts_check
    CHECK (page_count >= 1 AND change_count >= 0)
);

CREATE INDEX bank_sync_publications_stream
  ON openerp.bank_sync_publications (book_id, stream_id, from_version desc);

-- Everything but the stream row is evidence. A published cursor that could be
-- edited after the fact would make the whole window unfalsifiable.
CREATE TRIGGER immutable_bank_sync_generation
  BEFORE UPDATE OR DELETE ON openerp.bank_sync_generations
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_bank_sync_page
  BEFORE UPDATE OR DELETE ON openerp.bank_sync_pages
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_bank_sync_candidate
  BEFORE UPDATE OR DELETE ON openerp.bank_sync_candidates
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

CREATE TRIGGER immutable_bank_sync_publication
  BEFORE UPDATE OR DELETE ON openerp.bank_sync_publications
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

-- The stream is a pointer. Its guard is the fence the writer observed, so a
-- superseded worker cannot move the published cursor or steal the claim.
CREATE OR REPLACE FUNCTION openerp.bank_sync_stream_fence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.book_id <> OLD.book_id
     OR NEW.id <> OLD.id
     OR NEW.fence < OLD.fence
     OR NEW.publication_version < OLD.publication_version
     OR NEW.publication_version > OLD.publication_version + 1 THEN
    RAISE EXCEPTION
      'bank sync stream may not rewind its fence or skip a publication version';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_sync_stream_fence
  BEFORE UPDATE ON openerp.bank_sync_streams
  FOR EACH ROW EXECUTE FUNCTION openerp.bank_sync_stream_fence();

-- The runtime role reads the window, claims it and stages pages. It may only
-- update the stream's own pointer columns, and never a generation, a page, a
-- candidate or a published marker.
GRANT SELECT, INSERT ON openerp.bank_sync_generations TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_sync_pages TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_sync_candidates TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_sync_publications TO openerp_runtime;
GRANT SELECT, INSERT ON openerp.bank_sync_streams TO openerp_runtime;
GRANT UPDATE (published_cursor, publication_version, current_generation_id, fence, lease_until)
  ON openerp.bank_sync_streams TO openerp_runtime;
