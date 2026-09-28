-- One durable external operation per immutable request. Claim before dispatch:
-- a lost response has no safe automatic resubmission, even on queue redelivery.
CREATE TABLE openerp.supplier_document_operations (
  book_id text NOT NULL,
  request_id text NOT NULL,
  reader_identity text NOT NULL CHECK (length(reader_identity) BETWEEN 1 AND 512),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_url text CHECK (length(operation_url) BETWEEN 1 AND 2048),
  PRIMARY KEY (book_id, request_id),
  FOREIGN KEY (book_id, request_id) REFERENCES openerp.supplier_extraction_requests(book_id, id)
);
GRANT SELECT, INSERT ON openerp.supplier_document_operations TO openerp_runtime;
GRANT UPDATE (operation_url) ON openerp.supplier_document_operations TO openerp_runtime;
