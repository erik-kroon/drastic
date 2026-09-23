-- Privileged, reviewed identity admission is separate from runtime accounting writes.
CREATE TABLE openerp.identity_provisioning_receipts (
  request_id text PRIMARY KEY,
  manifest jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON openerp.identity_provisioning_receipts FROM PUBLIC,openerp_runtime;
CREATE TABLE openerp.identity_admissions (
  actor_id text PRIMARY KEY REFERENCES openerp_auth."user"(id),
  provider_id text NOT NULL,
  subject text NOT NULL,
  enabled boolean NOT NULL,
  UNIQUE(provider_id,subject)
);
REVOKE ALL ON openerp.identity_admissions FROM PUBLIC,openerp_runtime;
CREATE FUNCTION openerp.check_identity_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,openerp AS $$
DECLARE enabled boolean;
BEGIN
  SELECT a.enabled INTO enabled FROM openerp.identity_admissions a WHERE a.actor_id=NEW.user_id FOR SHARE;
  IF enabled IS FALSE THEN PERFORM openerp.fail('Unauthorized','This identity is disabled.'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER identity_session_admission BEFORE INSERT ON openerp_auth.session
  FOR EACH ROW EXECUTE FUNCTION openerp.check_identity_session();
ALTER FUNCTION openerp.authenticate(text) RENAME TO authenticate_credential_or_session;
CREATE FUNCTION openerp.authenticate(token text) RETURNS text
LANGUAGE plpgsql SET search_path=pg_catalog,openerp AS $$
DECLARE actor text; enabled boolean;
BEGIN
  actor:=openerp.authenticate_credential_or_session(token);
  SELECT a.enabled INTO enabled FROM openerp.identity_admissions a WHERE a.actor_id=actor FOR SHARE;
  IF enabled IS FALSE THEN PERFORM openerp.fail('Unauthorized','This identity is disabled.'); END IF;
  RETURN actor;
END $$;
REVOKE ALL ON FUNCTION openerp.check_identity_session(),openerp.authenticate_credential_or_session(text),openerp.authenticate(text) FROM PUBLIC,openerp_runtime;
