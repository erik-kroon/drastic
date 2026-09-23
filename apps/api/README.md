# Accounting API layout

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
    cloudflare.ts          Worker, scheduled dispatch and Workflow entrypoint
migrations/                Versioned PostgreSQL transitions and constraints
scripts/                   Stable Bun maintenance, self-host and recovery entrypoints
```

HTTP and MCP share `application/capabilities.ts`. Operator-only HTTP commands remain absent from the ordinary MCP catalog. VAT and SIE workflows capture/read through the database owner, call pure functions from `@open-erp/jurisdiction-se`, and seal through the existing SQL transitions. Application workflows do not import transport handlers.

`@open-erp/domain` owns shared accounting models and errors. `@open-erp/contracts` owns wire commands, routes and capability metadata and preserves the existing accounting schema exports. Neither folder movement nor a new package changes the supported accounting profiles.

Keep locks, voucher allocation, approval consumption and financial writes in PostgreSQL. Database connections retain the same scoped lifetime. Maintenance scripts and migrations stay at their existing paths so local setup, recovery and existing E2E callers keep working.

## Query failures

`db/query.ts` exposes only intentional `P0001` errors with an allowlisted accounting failure code. Other database messages and bound parameters are not returned to callers. Known PostgreSQL availability failures and socket errors `ECONNRESET`, `EPIPE` and `ETIMEDOUT` map to `Unavailable` (HTTP 503); unrecognized coded query failures remain `InternalError` (HTTP 500).

The adapter does not retry queries. An unavailable response does not establish that a write rolled back. Recover an uncertain command with its original input and idempotency key, not a new command. The socket-error classification repair has been reviewed in source only, not exercised at runtime.

