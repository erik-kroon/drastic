# Accounting API layout

Feature implementation notes, handoffs and feasibility reviews live in [docs](docs/README.md).

`src/index.ts` composes the shared HTTP API. The Worker and Bun self-host entrypoints use that same application.

```text
src/
  index.ts                 API composition and request boundary
  application/             Shared capability execution and Effect workflows
  transport/
    http/
      routes/              REST handlers grouped by accounting area
      auth.ts              Request authentication and origin checks
      body.ts              Bounded request admission
    mcp.ts                 MCP protocol and shared capability dispatch
  db/
    connection.ts          Scoped PostgreSQL connection and Drizzle adapter
    query.ts               Approved SQL function dispatch and failure translation
    statements/            Area-specific parameterized SQL statements
    schema.ts              Typed maintenance table mappings
    auth-schema.ts         Better Auth table mappings
  adapters/
    auth/                  Better Auth integration
    storage/               Retained-object access and R2 adapter
  runtime/
    environment.ts         Request-scoped bindings
    cloudflare.ts          Request-scoped API Worker entrypoint
    preparation-queue.ts   effect-mq job definition, dispatcher and handler
migrations/                Versioned PostgreSQL transitions and constraints
scripts/                   Stable Bun maintenance, self-host and recovery entrypoints
```

`bun run --cwd apps/api jobs:preparation` starts the persistent preparation runner with
`DATABASE_URL` and a dedicated `OPENERP_PREPARATION_TOKEN`. The runner owns the queue listener
and a pool capped at eight connections. The API admits work in PostgreSQL; the runner rediscovers
ready preparation records and enqueues deterministic jobs. Hosted deployment of this Bun process
is separate from the Alchemy Worker stack.

HTTP and MCP share `application/capabilities.ts`. Operator-only HTTP commands remain absent from the ordinary MCP catalog. In the current pre-cutover source, VAT and SIE workflows capture/read through the database owner, call pure functions from `@open-erp/jurisdiction-se`, and seal through existing SQL transitions. In the application-owned replacement, capture, policy, sealing and recovery move to named application operations while the pure jurisdiction functions remain. Application workflows do not import transport handlers.

`@open-erp/domain` owns shared accounting models and errors. `@open-erp/contracts` owns wire commands, routes and capability metadata and preserves the existing accounting schema exports. Neither folder movement nor a new package changes the supported accounting profiles.

The application owns accounting policy, authorization, calculations, workflow decisions and scoped writes. PostgreSQL owns relational records, the reviewed DDL, constraints, grants, row locks, aggregate integrity and durable receipts. The runtime role receives the required table/column grants; the database does not execute feature workflows through procedural functions. Use one scoped transaction and pass it through nested persistence. A financial group commits its register effects, approval use, counters, receipt and outbox intent together. See [ADR 0010](../../docs/adr/0010-application-owned-accounting-replacement.md).

The current checkout still contains the pre-replacement SQL dispatch path. Do not preserve it as a fallback. Move every capability, direct HTTP handler, MCP caller, web caller, job, script and recovery control to named application operations, then delete the old path and use the three-file baseline. [ADR 0009](../../docs/adr/0009-effect-mq-background-jobs.md) selects effect-mq on a separate persistent Bun worker for durable delivery. Its session-preserving listener is not part of API or financial transaction scope.

## Query failures

The following details describe the current pre-cutover `db/query.ts` source. The application-owned replacement removes that statement registry and per-call database layer after every caller is cut over; it does not retain a compatibility query path.

`db/query.ts` exposes only intentional `P0001` errors with an allowlisted accounting failure code. Other database messages and bound parameters are not returned to callers. Known PostgreSQL availability failures and socket errors `ECONNRESET`, `EPIPE` and `ETIMEDOUT` map to `Unavailable` (HTTP 503); unrecognized coded query failures remain `InternalError` (HTTP 500).

The installed Drizzle Effect adapter can retain bound parameters, including credentials,
in its raw query error. Keep that error inside the query boundary: do not log, serialize or
export its message, stack, parameters or cause. Current public failures use a newly constructed
`AccountingError`; the default query logger is disabled. Adding query logging, tracing error
exporters or raw cause reporting requires a fresh credential-exposure review. Source review
found no current plaintext exposure; provider logs and runtime behavior were not inspected.

The adapter does not retry queries. An unavailable response does not establish that a write rolled back. Recover an uncertain command with its original input and idempotency key, not a new command. The socket-error classification repair has been reviewed in source only, not exercised at runtime.
