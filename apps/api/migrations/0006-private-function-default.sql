-- Per-schema defaults cannot remove PostgreSQL's global PUBLIC EXECUTE default.
-- The dedicated migration owner must opt every new function into runtime access.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
