GRANT SELECT (token_hash, actor_id, expires_at, revoked_at) ON openerp.credentials TO openerp_runtime;
GRANT SELECT (book_id, actor_id, role) ON openerp.memberships TO openerp_runtime;
GRANT SELECT (actor_id, enabled) ON openerp.identity_admissions TO openerp_runtime;
GRANT SELECT (id, entity_id) ON openerp.books TO openerp_runtime;
GRANT SELECT (id, user_id, token, expires_at) ON openerp_auth.session TO openerp_runtime;
