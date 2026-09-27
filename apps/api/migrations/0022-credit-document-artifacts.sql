-- Rendered credit artifacts preserve the issued semantic document and financial receipt.
ALTER TABLE openerp.customer_credit_documents
  ADD CONSTRAINT customer_credit_document_revision_digest_key UNIQUE (book_id, id, revision, digest);

CREATE TABLE openerp.customer_credit_artifacts (
  book_id text NOT NULL,
  id text NOT NULL,
  document_id text NOT NULL,
  document_revision bigint NOT NULL,
  document_digest text NOT NULL,
  renderer_version text NOT NULL,
  outbox_id text NOT NULL,
  descriptor jsonb NOT NULL,
  content_base64 text NOT NULL,
  PRIMARY KEY (book_id, id),
  UNIQUE (book_id, document_id, document_revision, renderer_version),
  FOREIGN KEY (book_id, document_id, document_revision, document_digest)
    REFERENCES openerp.customer_credit_documents (book_id, id, revision, digest),
  FOREIGN KEY (book_id, outbox_id) REFERENCES openerp.outbox (book_id, id),
  CHECK (renderer_version = 'openerp-se-credit-note-v1'),
  CHECK (length(content_base64) <= 2796204 AND content_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  CHECK (octet_length(decode(content_base64, 'base64')) BETWEEN 8 AND 2097152),
  CHECK (substring(decode(content_base64, 'base64') FROM 1 FOR 5) = convert_to('%PDF-', 'UTF8')),
  CHECK ((descriptor->>'id' = id
    AND descriptor->'scope'->>'bookId' = book_id
    AND descriptor->>'documentId' = document_id
    AND descriptor->>'documentRevision' = document_revision::text
    AND descriptor->>'documentDigest' = document_digest
    AND descriptor->>'rendererVersion' = renderer_version
    AND descriptor->>'mediaType' = 'application/pdf'
    AND descriptor->>'delivered' = 'false'
    AND descriptor->>'sha256' = encode(sha256(decode(content_base64, 'base64')), 'hex')
    AND (descriptor->>'byteLength')::integer = octet_length(decode(content_base64, 'base64'))) IS TRUE)
);

CREATE TABLE openerp.customer_credit_render_failures (
  book_id text NOT NULL,
  document_id text NOT NULL,
  document_revision bigint NOT NULL,
  document_digest text NOT NULL,
  renderer_version text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  code text NOT NULL CHECK (code IN ('UnsupportedProfile', 'Unavailable', 'InternalError')),
  failed_at timestamptz NOT NULL,
  PRIMARY KEY (book_id, document_id, renderer_version, ordinal),
  FOREIGN KEY (book_id, document_id, document_revision, document_digest)
    REFERENCES openerp.customer_credit_documents (book_id, id, revision, digest),
  CHECK (renderer_version = 'openerp-se-credit-note-v1')
);

CREATE TRIGGER immutable_customer_credit_artifact
  BEFORE UPDATE OR DELETE ON openerp.customer_credit_artifacts
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_customer_credit_render_failure
  BEFORE UPDATE OR DELETE ON openerp.customer_credit_render_failures
  FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();

GRANT SELECT, INSERT ON openerp.customer_credit_artifacts, openerp.customer_credit_render_failures TO openerp_runtime;
GRANT UPDATE (delivered_at, attempts) ON openerp.outbox TO openerp_runtime;
