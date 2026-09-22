# Self-hosting OpenERP

Run the current application and accounting API using Bun and PostgreSQL without a Cloudflare account. The same API implementation, contracts, restricted SQL transitions and readiness checks serve both runtimes. The Bun entrypoint serves the existing prerendered web build; it is not a new SSR or background-job implementation.

This is a development distribution of the current capabilities, not a production-ready accounting release. Object retention, durable outbox delivery, full statutory behavior and production recovery remain governed by the [delivery plan](../../docs/plans/README.md). Container execution must be qualified on the release platform; see [verification](VERIFICATION.md).

## Container setup

Requirements: the pinned Bun version for configuration generation, and Docker Engine with Docker Compose v2. From the repository root:

```bash
bun infra/self-host/setup.ts
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml up --build -d
```

The setup command creates an ignored `.env` with independent random maintenance, runtime and session secrets, mode `0600`. It refuses to overwrite an existing file. Keep those values stable across restarts. Generated database passwords are hexadecimal and safe in the connection strings; if replacing them manually, URL-encode reserved characters in connection URLs.

Compose waits for PostgreSQL readiness, runs the checked-in migrations and restricted-login setup, and starts the app only after successful completion. The app receives only the runtime database credential. PostgreSQL has a named data volume and no published host port. The application port is bound to loopback at `http://localhost:3000`.

An empty installation has no books or operator account. Review the current [provisioning instructions](../../README.md#local-development) and the synthetic example before adding development records. For an isolated synthetic book, supply a new operator token in your shell environment, then:

```bash
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml \
  run --rm -e OPENERP_ACCESS_TOKEN migrate \
  bun apps/api/scripts/provision.ts examples/synthetic-book.json
```

This does not create a production company profile or satisfy the human-identity gate. It fails on an existing book rather than resetting records. Authentication setup is evolving; use the documented current operator/account provisioning path, not a guessed default password.

## Run directly with Bun

Install PostgreSQL 17 and the pinned Bun version. Create a dedicated database, then use a maintenance connection only for migrations and login setup:

```bash
bun install --frozen-lockfile
bun run --cwd apps/web build

# Supply secrets in your shell or an ignored environment file; do not print them.
# DATABASE_ADMIN_URL points to the dedicated maintenance connection.
# OPENERP_RUNTIME_PASSWORD is an independently generated secret of at least 32 characters.
bun apps/api/scripts/migrate.ts
bun apps/api/scripts/self-host-role.ts

# DATABASE_URL now uses openerp_app and its runtime password, never the owner.
# BETTER_AUTH_SECRET is a separate stable secret of at least 32 characters.
OPENERP_PUBLIC_URL=http://localhost:3000 bun apps/api/scripts/self-host.ts
```

The role setup is intended for this dedicated installation. It refuses an existing login with elevated role flags. It sets the runtime password to the supplied value and grants only the accounting runtime group. Do not use it against an unrelated shared `openerp_app` identity or rotate it while requests are active.

## Origin and deployment configuration

`OPENERP_PUBLIC_URL` is the exact browser origin. Non-loopback origins require HTTPS. The server rejects a different Host and uses the configured origin when dispatching requests, preserving same-origin/CSRF checks. It ignores a caller-supplied Cloudflare client-IP header and derives the address from the socket. Behind a proxy, authentication rate limits therefore use the proxy address; trusted forwarded-client-IP configuration is not implemented.

For remote access, place a TLS reverse proxy in front of the loopback port, preserve the public Host header and set `OPENERP_PUBLIC_URL` to that HTTPS origin. `OPENERP_BIND_ADDRESS` defaults to loopback; Compose overrides it only inside the container. `PORT` selects the Bun listening port; `OPENERP_PORT` selects the Compose host mapping. Do not expose maintenance credentials or the database port through the proxy.

API calls use the existing `/api/*` surface, including authenticated REST and `/api/mcp`. Static files come only from `apps/web/dist/client`; unsupported paths return 404. SIGINT/SIGTERM stops accepting requests and drains active work. An interrupted financial request still requires the ordinary receipt-recovery protocol.

## Upgrade, stop and data retention

Keep a verified database/evidence backup before upgrading. Review the migration delta and current release gates. Changing a previously applied migration correctly fails; do not bypass its checksum or discard the data volume to force startup. Existing authenticated accounting data is never seeded or reset by application startup.

Stop the app before an upgrade that changes schema or credentials, rebuild, then rerun the migration service before starting it:

```bash
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml stop app
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml build migrate
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml run --rm migrate
docker compose --env-file infra/self-host/.env -f infra/self-host/compose.yaml up -d app
```

`docker compose ... down` stops/removes containers while retaining the named database volume. Do not add `--volumes` unless deliberately deleting the installation's data. Changing `POSTGRES_PASSWORD` in `.env` does not rotate an already initialized database owner's password; use an explicit PostgreSQL password-change procedure and update configuration together.

Release operators must provide corresponding source and notices as described in [LICENSING.md](../../LICENSING.md). The repository's public/private flags and this packaging do not publish anything by themselves.

Runtime references: [Bun HTTP server](https://bun.sh/docs/runtime/http/server), [Compose startup conditions](https://docs.docker.com/compose/how-tos/startup-order/) and [PostgreSQL image documentation](https://github.com/docker-library/docs/blob/master/postgres/README.md).
