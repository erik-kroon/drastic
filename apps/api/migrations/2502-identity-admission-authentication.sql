-- Keep admission in its owning authentication function; its qualified token parameter must retain its function name.
CREATE OR REPLACE FUNCTION openerp.authenticate(token text) RETURNS text LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; enabled boolean;
BEGIN
  IF token IS NULL OR length(token) < 32 OR length(token) > 512 THEN
    PERFORM openerp.fail('Unauthorized', 'Sign in or provide a valid API token.');
  END IF;
  SELECT actor_id INTO actor FROM openerp.credentials
    WHERE token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
      AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE;
  IF actor IS NULL THEN
    SELECT s.user_id INTO actor FROM openerp_auth.session s
      WHERE s.token = authenticate.token AND s.expires_at > clock_timestamp() FOR SHARE OF s;
  END IF;
  IF actor IS NULL THEN PERFORM openerp.fail('Unauthorized', 'Sign in or provide a valid API token.'); END IF;
  SELECT a.enabled INTO enabled FROM openerp.identity_admissions a WHERE a.actor_id=actor FOR SHARE;
  IF enabled IS FALSE THEN PERFORM openerp.fail('Unauthorized','This identity is disabled.'); END IF;
  RETURN actor;
END $$;
DROP FUNCTION openerp.authenticate_credential_or_session(text);
