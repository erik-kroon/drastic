# Local development

Run the web app and API Worker against an isolated PostgreSQL 17 database. Use the Bun version pinned in the root `package.json`. Fresh databases use `0001-schema.sql`, `0002-integrity.sql` and `0003-roles.sql`. The migrator refuses receipts from the superseded chain; it never resets a database. The [application-owned replacement](adr/0010-application-owned-accounting-replacement.md) still has open domain and boundary-review gates, listed in the [API layout](../apps/api/README.md).

Run commands from the repository root unless noted. Create the database with your PostgreSQL administration tool before migrating it.

## 1. Install and migrate

`DATABASE_ADMIN_URL` must be a direct maintenance connection with schema and role creation rights.

```bash
bun install --frozen-lockfile
export DATABASE_ADMIN_URL='postgresql://owner:password@127.0.0.1:5432/openerp_development'
bun run --cwd apps/api db:migrate
```

Applied migration checksums are enforced. Add a forward migration instead of editing one that has already run. For a development database using the superseded chain, create a fresh disposable database and run this baseline; there is no compatibility migration or automatic reset.

## 2. Configure the restricted runtime login

Generate an independent random password of at least 32 characters:

```bash
export OPENERP_RUNTIME_PASSWORD='<random runtime password>'
bun apps/api/scripts/self-host-role.ts
```

This script configures `openerp_app` with the `openerp_runtime` grant. The API must use this login, never the maintenance account. URL-encode reserved characters in its connection string.

Create the ignored `apps/api/.dev.vars` file:

```text
DATABASE_URL="postgresql://openerp_app:<url-encoded runtime password>@127.0.0.1:5432/openerp_development"
BETTER_AUTH_URL="http://localhost:3000"
BETTER_AUTH_SECRET="<different random secret of at least 32 characters>"
```

## 3. Add a development book and sign-in account

Review [the example manifest](../examples/synthetic-book.json), including its dates and token expiry. The access token must be a new random string of 32–512 characters. Provisioning creates the book atomically and refuses to reset an existing one.

```bash
export OPENERP_ACCESS_TOKEN='<random development access token>'
bun run --cwd apps/api db:provision ../../examples/synthetic-book.json
export OPENERP_EMAIL='operator@example.test'
export OPENERP_PASSWORD='<local password of 12–128 characters>'
bun run --cwd apps/api db:create-user actor_operator
```

The access token is for API/MCP clients. The email and password sign in the browser; local password authentication is not a production identity path. See [authentication](../apps/api/docs/AUTH.md) for OIDC and explicit book grants.

## 4. Start and inspect

```bash
bun run dev
```

Open `http://localhost:3000`. The web app proxies `/api/*` to the API Worker on port 8788. To inspect the development book's capability status with the provisioned token:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $OPENERP_ACCESS_TOKEN" \
  http://localhost:3000/api/v1/entities/entity_synthetic/books/book_synthetic/status
```

The generated REST schema is at `/api/openapi.json`. [MCP setup](../apps/api/docs/MCP.md) covers agent authentication and transport. Keep the token, database credentials and local session secret out of commits and captured output.

## 5. Run durable preparation work

The [effect-mq runner](adr/0009-effect-mq-background-jobs.md) is a separate persistent Bun process. Give it the restricted runtime connection as `DATABASE_URL` and a dedicated preparation credential as `OPENERP_PREPARATION_TOKEN`, then run:

```bash
bun run --cwd apps/api jobs:preparation
```

The API records work in PostgreSQL; the runner finds ready work and owns queue claims, leases and retries. This command is separate from `bun run dev` and the Cloudflare Worker deployment.
