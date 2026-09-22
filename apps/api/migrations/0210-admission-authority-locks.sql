-- Admission takes shared credential and scoped-membership locks through commit.
-- Revocation must use a separate transaction with no book/configuration writes.
-- Lock only membership m in the join: a shared book lock would deadlock on upgrade.
CREATE OR REPLACE FUNCTION openerp.authenticate(token text) RETURNS text LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, openerp AS $$
DECLARE actor text;
BEGIN
  IF token IS NULL OR length(token) < 32 OR length(token) > 512 THEN
    PERFORM openerp.fail('Unauthorized', 'A valid access token is required.');
  END IF;
  SELECT actor_id INTO actor FROM openerp.credentials
    WHERE token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')
      AND revoked_at IS NULL AND expires_at > clock_timestamp() FOR SHARE;
  IF actor IS NULL THEN PERFORM openerp.fail('Unauthorized', 'The access token is invalid or expired.'); END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION openerp.authorize(token text, scope jsonb, operator_only boolean DEFAULT false) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, openerp AS $$
DECLARE actor text; access_role text;
BEGIN
  actor := openerp.authenticate(token);
  SELECT m.role INTO access_role FROM openerp.memberships m JOIN openerp.books b ON b.id = m.book_id
    WHERE m.actor_id = actor AND b.id = scope->>'bookId' AND b.entity_id = scope->>'entityId' FOR SHARE OF m;
  IF access_role IS NULL OR (operator_only AND access_role <> 'operator') THEN
    PERFORM openerp.fail('Forbidden', 'This credential does not have the required book authority.');
  END IF;
  RETURN actor;
END $$;

CREATE OR REPLACE FUNCTION openerp.book_versions() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, openerp AS $$
BEGIN
  IF (NEW.entity_id,NEW.currency,NEW.currency_scale) IS DISTINCT FROM (OLD.entity_id,OLD.currency,OLD.currency_scale) THEN
    PERFORM openerp.fail('Forbidden','Book entity and monetary units are immutable. Create a new book; moving history or currency conversion is not implemented.');
  END IF;
  IF (NEW.profile, NEW.currency, NEW.currency_scale) IS DISTINCT FROM (OLD.profile, OLD.currency, OLD.currency_scale) THEN
    NEW.profile_version := OLD.profile_version + 1;
  END IF;
  IF NEW.authority IS DISTINCT FROM OLD.authority THEN NEW.writer_epoch := OLD.writer_epoch + 1; END IF;
  RETURN NEW;
END $$;
