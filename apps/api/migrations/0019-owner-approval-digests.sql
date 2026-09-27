-- Review identity and approval-body integrity are different hashes. Retain the
-- immutable records and the existing body-hash check; bind the extracted review
-- digest to the exact retained review instead of equating the two hashes.
ALTER TABLE openerp.owner_operation_reviews
  ADD CONSTRAINT owner_operation_reviews_digest_key UNIQUE (book_id, id, digest);

ALTER TABLE openerp.owner_operation_approvals
  DROP CONSTRAINT owner_operation_approvals_review_digest_check,
  ADD COLUMN review_digest text
    GENERATED ALWAYS AS (body ->> 'reviewDigest'::text) STORED NOT NULL,
  ADD CONSTRAINT owner_operation_approvals_review_digest_fkey
    FOREIGN KEY (book_id, review_id, review_digest)
    REFERENCES openerp.owner_operation_reviews (book_id, id, digest);
