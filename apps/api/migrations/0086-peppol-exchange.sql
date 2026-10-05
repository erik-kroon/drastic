CREATE TABLE openerp.peppol_bindings (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  role text NOT NULL CHECK (role IN ('sender','recipient')), subject_key text NOT NULL,
  revision numeric(38,0) NOT NULL CHECK (revision>0), body jsonb NOT NULL,
  PRIMARY KEY (book_id,id), UNIQUE (book_id,role,subject_key,revision)
);
CREATE TABLE openerp.peppol_validation_runs (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  candidate_id text NOT NULL, body jsonb NOT NULL, PRIMARY KEY (book_id,id)
);
CREATE TABLE openerp.peppol_artifacts (
  book_id text NOT NULL REFERENCES openerp.books(id), id text NOT NULL,
  invoice_issue_id text, credit_id text, sender_binding_id text NOT NULL,
  recipient_binding_id text NOT NULL, xml_sha256 text NOT NULL CHECK(xml_sha256 ~ '^[a-f0-9]{64}$'),
  body jsonb NOT NULL, PRIMARY KEY (book_id,id),
  CHECK ((invoice_issue_id IS NULL) <> (credit_id IS NULL)),
  FOREIGN KEY(book_id,invoice_issue_id) REFERENCES openerp.ar_legal_issues(book_id,id),
  FOREIGN KEY(book_id,credit_id) REFERENCES openerp.customer_credit_notes(book_id,id),
  FOREIGN KEY(book_id,sender_binding_id) REFERENCES openerp.peppol_bindings(book_id,id),
  FOREIGN KEY(book_id,recipient_binding_id) REFERENCES openerp.peppol_bindings(book_id,id)
);
CREATE TABLE openerp.peppol_approvals (
  book_id text NOT NULL,id text NOT NULL,artifact_id text NOT NULL,actor_id text NOT NULL REFERENCES openerp.actors(id),
  expires_at timestamptz NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,id),UNIQUE(book_id,id,artifact_id),
  FOREIGN KEY(book_id,artifact_id) REFERENCES openerp.peppol_artifacts(book_id,id)
);
CREATE TABLE openerp.peppol_attempts (
  book_id text NOT NULL,id text NOT NULL,artifact_id text NOT NULL,approval_id text NOT NULL,
  provider_key text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,id),UNIQUE(book_id,id,artifact_id),UNIQUE(book_id,artifact_id),UNIQUE(book_id,provider_key),
  FOREIGN KEY(book_id,artifact_id) REFERENCES openerp.peppol_artifacts(book_id,id),
  FOREIGN KEY(book_id,approval_id,artifact_id) REFERENCES openerp.peppol_approvals(book_id,id,artifact_id)
);
CREATE TABLE openerp.peppol_outcomes (
  book_id text NOT NULL,id text NOT NULL,attempt_id text NOT NULL,body jsonb NOT NULL,PRIMARY KEY(book_id,id),
  FOREIGN KEY(book_id,attempt_id) REFERENCES openerp.peppol_attempts(book_id,id)
);
CREATE TABLE openerp.peppol_submission_admissions (
  book_id text NOT NULL,id text NOT NULL,attempt_id text NOT NULL,artifact_id text NOT NULL,
  approval_id text NOT NULL,command_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('first_submission','confirmed_absence_retry')),
  body jsonb NOT NULL,PRIMARY KEY(book_id,id),UNIQUE(book_id,attempt_id,command_key,kind,approval_id),
  FOREIGN KEY(book_id,attempt_id,artifact_id) REFERENCES openerp.peppol_attempts(book_id,id,artifact_id),
  FOREIGN KEY(book_id,approval_id,artifact_id) REFERENCES openerp.peppol_approvals(book_id,id,artifact_id)
);
CREATE TABLE openerp.peppol_inbound (
  book_id text NOT NULL,id text NOT NULL,provider_account text NOT NULL,recipient_participant text NOT NULL,
  message_id text NOT NULL,content_hash text NOT NULL,business_identity text NOT NULL,occurrence_id text NOT NULL,
  body jsonb NOT NULL,PRIMARY KEY(book_id,id),UNIQUE(book_id,provider_account,recipient_participant,message_id),
  UNIQUE(book_id,occurrence_id),FOREIGN KEY(book_id,occurrence_id) REFERENCES openerp.intake_occurrences(book_id,id)
);
CREATE TABLE openerp.peppol_integrity_incidents (
  book_id text NOT NULL,id text NOT NULL,inbound_id text NOT NULL,content_hash text NOT NULL,body jsonb NOT NULL,
  PRIMARY KEY(book_id,id),UNIQUE(book_id,inbound_id,content_hash),
  FOREIGN KEY(book_id,inbound_id) REFERENCES openerp.peppol_inbound(book_id,id)
);
CREATE TRIGGER immutable_peppol_binding BEFORE UPDATE OR DELETE ON openerp.peppol_bindings FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_validation BEFORE UPDATE OR DELETE ON openerp.peppol_validation_runs FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_artifact BEFORE UPDATE OR DELETE ON openerp.peppol_artifacts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_approval BEFORE UPDATE OR DELETE ON openerp.peppol_approvals FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_attempt BEFORE UPDATE OR DELETE ON openerp.peppol_attempts FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_outcome BEFORE UPDATE OR DELETE ON openerp.peppol_outcomes FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_submission BEFORE UPDATE OR DELETE ON openerp.peppol_submission_admissions FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_inbound BEFORE UPDATE OR DELETE ON openerp.peppol_inbound FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
CREATE TRIGGER immutable_peppol_incident BEFORE UPDATE OR DELETE ON openerp.peppol_integrity_incidents FOR EACH ROW EXECUTE FUNCTION openerp.immutable_row();
GRANT SELECT,INSERT ON openerp.peppol_bindings,openerp.peppol_validation_runs,openerp.peppol_artifacts,openerp.peppol_approvals,openerp.peppol_attempts,openerp.peppol_outcomes,openerp.peppol_submission_admissions,openerp.peppol_inbound,openerp.peppol_integrity_incidents TO openerp_runtime;
