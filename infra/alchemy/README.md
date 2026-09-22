# Alchemy deployment

The stack defines the TanStack Start web Worker, the Effect API Worker and a Hyperdrive connection
to an existing PostgreSQL database. Hyperdrive query caching is disabled for all accounting reads.
Only the API Worker receives the database binding. The web Worker forwards `/api/*` to Core with
the original request URL and Origin.

Alchemy derives both Worker names from the stack, stage and resource ID. Use a distinct stage
for each environment and supply that stage's database and authentication settings. Stage-scoped
Workers and Hyperdrive configurations do not isolate a shared PostgreSQL origin: staging must use
its own database and restricted runtime login. Before upgrading an existing deployment, inspect
the plan for replacement of the former fixed-name `open-erp-api` Worker and the web service binding.

## Prerequisites

- Install dependencies with `bun install` and authenticate Alchemy with `bun alchemy profile edit`.
- Provide a PostgreSQL host accessible from Cloudflare. Database creation, backups and restoration
  are not provisioned by this stack.
- Apply `apps/api/migrations` using the direct maintenance connection and the `db:migrate` command.
- Give the Worker a dedicated login inheriting only `openerp_runtime`, not schema ownership or
  direct ledger-table privileges.
- Supply `OPENERP_DATABASE_HOST`, `OPENERP_DATABASE_NAME`, `OPENERP_DATABASE_USER`, and
  `OPENERP_DATABASE_PASSWORD`. `OPENERP_DATABASE_PORT` defaults to 5432. Alchemy receives the
  password as a redacted secret. Do not use a maintenance connection for Hyperdrive.
- Review access-token lifecycle, supported company profile and all production-readiness gates.
- Set `BETTER_AUTH_URL` to the public web origin and `BETTER_AUTH_SECRET` to a cryptographically
  random secret of at least 32 characters. The API Worker receives the secret; the web Worker does
  not. Provision email/password accounts using `apps/api/scripts/create-user.ts` after creating
  their accounting actors and memberships. See [authentication setup](../../apps/api/AUTH.md).

## Commands requiring separate deployment authority

```bash
bun run alchemy:plan
bun run alchemy:deploy
```

Use `--stage prod` only for an explicitly authorized production deployment. `alchemy:destroy`
removes managed resources and requires separate destructive-action approval.

Local `bun run dev` uses `apps/api/.dev.vars` with a dedicated development `DATABASE_URL` instead
of provisioning Hyperdrive. The Worker enables `nodejs_compat` for `pg`. A local direct-PG call
proves neither live Hyperdrive behavior nor production readiness. Live infrastructure has not been
deployed or exercised in this work.

Alchemy stores local state under the ignored `.alchemy/` directory.
