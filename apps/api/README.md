# Accounting API layout

Feature implementation notes, handoffs and feasibility reviews live in [docs](../../docs/README.md).

`src/index.ts` composes the shared HTTP API. The Worker and Bun self-host entrypoints use that same application.

```text
src/
  index.ts                 API composition and request boundary
  application/             Shared capability execution and Effect workflows
    company-profiles.ts    Capability-specific company admission operations
    company-profile-basis.ts  Pure family/date profile selection and overlap checks
  transport/
    http/
      routes/              REST handlers grouped by accounting area
      auth.ts              Request authentication and origin checks
      body.ts              Bounded request admission
    mcp.ts                 MCP protocol and shared capability dispatch
  db/
    connection.ts          Scoped PostgreSQL connection and Drizzle adapter
    transaction.ts         Transaction ownership and sanitized failures
    identity.ts            Admission and current authority locks
    commerce/, banking/    Scoped domain persistence
    company-profiles.ts    Company admission reads and DML
    schema.ts              Typed application and maintenance table mappings
    auth-schema.ts         Better Auth table mappings
  adapters/
    auth/                  Better Auth integration
    storage/               Retained-object access and R2 adapter
  runtime/
    environment.ts         Request-scoped bindings
    cloudflare.ts          Request-scoped API Worker entrypoint
    preparation-queue.ts   effect-mq job definition, dispatcher and handler
migrations/                Reviewed three-file baseline plus forward migrations
scripts/                   Stable Bun maintenance, self-host and recovery entrypoints
```

`bun run --cwd apps/api jobs:preparation` starts the persistent preparation runner with
`DATABASE_URL` and a dedicated `OPENERP_PREPARATION_TOKEN`. The runner owns the queue listener
and a pool capped at eight connections. The API admits work in PostgreSQL; the runner rediscovers
ready preparation records and enqueues deterministic jobs. Hosted deployment of this Bun process
is separate from the Alchemy Worker stack.

HTTP and MCP share `application/capabilities/`, which dispatches to named Effect operations. Operator-only HTTP commands remain absent from the ordinary MCP catalog. The SQL statement registry and `db/query.ts` have been removed. VAT and SIE calculations use pure functions from `@open-erp/jurisdiction-se`. Application workflows do not import transport handlers. HTTP handlers construct book scope from entity/book identifiers only; resource identifiers stay separate so they cannot alter sealed scope digests.

`@open-erp/domain` owns shared accounting models and errors. `@open-erp/contracts` owns wire commands, routes and capability metadata and preserves the existing accounting schema exports. Neither folder movement nor a new package changes the supported accounting profiles.

The application owns accounting policy, authorization, calculations, workflow decisions and scoped writes. PostgreSQL owns relational records, the reviewed DDL, constraints, grants, row locks, aggregate integrity and durable receipts. The runtime role receives the required table/column grants; the database does not execute feature workflows through procedural functions. Use one scoped transaction and pass it through nested persistence. A financial group commits its register effects, approval use, counters, receipt and outbox intent together. See [ADR 0010](../../docs/adr/0010-application-owned-accounting-replacement.md).

Fresh databases use [0001-schema.sql](migrations/0001-schema.sql), [0002-integrity.sql](migrations/0002-integrity.sql) and [0003-roles.sql](migrations/0003-roles.sql). The superseded 198-file chain has been removed. The migrator refuses old migration receipts and changed checksums; recreate an explicitly disposable development database instead of upgrading the old schema. The baseline retains 17 functions for canonical hashes, immutable records, balanced vouchers, calendar relationships and version maintenance. Only `canonical` and `digest` are runtime-callable. Private integrity helpers have fixed search paths and no public execution grant. [Completion evidence](../../docs/plans/evidence/application-owned-replacement-complete.md) records the final allowlist, grants, runtime journeys and restore checks.

Released databases take forward migrations. [0004-next-02.sql](migrations/0004-next-02.sql) adds the capability-specific company admission record model: rule releases, reviewed company fact revisions and their reviews, reviewed account role bindings, per-family admission epochs, activations and the activation impacts a retroactive fact correction records. It declares no function: it reuses the baseline `immutable_row` guard and the `digest` check helper, and it carries its own runtime grants rather than editing the reviewed baseline. A sealed activation proposal, its approval and its no-journal receipt reuse the existing `change_sets`, `approvals` and `posting_group_receipts` identity instead of a parallel set of tables.

The replacement is implemented, including historical financial import, impairment/disposal, schedule amendments and the commerce/purchase operations missed by the original placeholder inventory. Shared posting admission enforces domain ownership, source capacity and historical-import fences inside the financial transaction. TypeScript computes plans and canonical seals; the two pure SQL helpers remain for integrity constraints and read projections. Feature handoffs under `docs/` label the former SQL implementation as history; their migration and statement-map instructions do not describe the current runtime.

`application/company-profiles.ts` owns capability-specific company admission. It records immutable reviewed company facts, their independent reviews and reviewed account role bindings, resolves each admitted family on the date that family's own operation uses, and commits an activation, the affected family admission epoch and a no-journal receipt in one book-scoped transaction. The legal AR family keeps `commerce.legalProfile.activate` as its named owner; admission reporting reads that owner's record rather than keeping a second activation authority. `book_get_status` reports the per-family result and its blockers and never sets `productionReady`. No reviewed `rule_releases` row ships with this release, so every family currently reports a `missing_rule_release` gap until a reviewed release owner lands; that refusal is the designed behaviour, not a default.

[ADR 0009](../../docs/adr/0009-effect-mq-background-jobs.md) selects effect-mq on a separate persistent Bun worker for durable delivery. Its session-preserving listener is not part of API or financial transaction scope.

## Query failures

`db/transaction.ts` sanitizes query and commit failures into `AccountingError`. It also translates allowlisted `P0001` refusals from the private integrity layer. Business refusals originate in application Effects. Availability errors map to `Unavailable`; unexpected query failures remain `InternalError`.

The installed Drizzle Effect adapter can retain bound parameters, including credentials,
in its raw query error. Keep that error inside the query boundary: do not log, serialize or
export its message, stack, parameters or cause. Public failures use a newly constructed
`AccountingError`; the default query logger is disabled. Adding query logging, tracing error
exporters or raw cause reporting requires a fresh credential-exposure review. Do not include raw database errors in response or operational logs.

The adapter does not retry queries. An unavailable response does not establish that a write rolled back. Recover an uncertain command with its original input and idempotency key, not a new command.
