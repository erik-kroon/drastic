# Accounting MCP

Endpoint: `POST /api/mcp`.

This is a stateless, JSON-only MCP endpoint for the `synthetic-core-v1` manual
journal profile. It is not verified for production accounting, tax, source
completeness or Swedish compliance.

## Authentication and transport

- Send `Authorization: Bearer <token>` on **every** request, including
  initialization, catalog discovery and notifications. Cookies are not accepted.
- PostgreSQL verifies the credential on every request. There is no MCP session ID.
- If `Origin` is sent, it must exactly match the endpoint origin.
- Send `Content-Type: application/json` and `Accept: application/json`.
  Standard clients may also advertise `text/event-stream`; responses remain JSON.
- Supported protocol versions: `2025-11-25` and `2025-06-18`.
- Initialization returns the offered version when supported, otherwise
  `2025-11-25`. Stop if your client does not support the returned version.
- Send the negotiated version as `MCP-Protocol-Version` on later requests.
- Send one JSON-RPC message per POST. Batches, GET streams, subscriptions,
  server notifications, the MCP background-task protocol and session persistence are not supported. Domain preparation runs advance synchronously through explicit commands.
- Accepted `notifications/initialized` messages return HTTP 202 with no body.
  Other HTTP methods return 405 after authentication.
- All API request bodies have an 8 MiB byte limit and a 15-second read timeout.
  Session login bodies have a 16 KiB limit. Oversized bodies return 413;
  slow bodies return 408. Limits apply even without `Content-Length`.

## Messages

Initialize with a client identity:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": {},
    "clientInfo": { "name": "your-client", "version": "1.0.0" }
  }
}
```

Then send `notifications/initialized` without an `id`. Discover the complete
input and output JSON schemas with `tools/list`:

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

Call a tool with its schema-defined arguments:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "book_get_setup",
    "arguments": { "scope": { "entityId": "entity_demo", "bookId": "book_demo" } }
  }
}
```

Tool results contain both text JSON and `structuredContent` in the form
`{"result": ...}`. Protocol errors use JSON-RPC error codes. Tool/domain failures
return `isError: true` with a safe accounting failure code and message.
Authentication and service availability failures use HTTP 401/403/503.

## Supported task families

- `book_get_status` separates installed features, synthetic availability and production blockers.
- `cases_prepare_snapshot`, `cases_list`, `cases_get_context` capture and page immutable manual-case context.
- `bank_import_statement`, `bank_get_statement`, `bank_match_observation`, `bank_reconcile`, `bank_get_reconciliation` retain exact source/match identity and inspect account-interval differences.
- `reports_prepare`, `reports_get`, `reports_lines`, `reports_explain` freeze internal trial balances and page evidence-linked contributions.
- `rules_propose`, `rules_get`, `rules_simulate`, `rules_get_simulation` prepare and inspect exact-match recurring policy. Only an operator can activate/deactivate it through REST or the UI; neither action is a tool.
- `runs_create_preparation`, `runs_get`, `runs_advance` checkpoint bounded recurring preparation. A completed run does not mean its journals were approved or posted.

Use the live `tools/list` schemas for complete arguments. REST mutation bodies and MCP arguments reject unsupported fields. No agent approval, policy activation, automatic posting, provider submission or payment tool is exposed.

## Posting workflow

1. Discover books and inspect their setup and blockers.
2. Create retained evidence with `evidence_create`; inspect source content with
   `evidence_get`.
3. Prepare with `ledger_prepare_journal`, then inspect `changes_get` and call
   `changes_validate`.
4. A human operator reviews and approves the exact proposal outside MCP.
5. Call `changes_execute` with the approved `planDigest`, `version` and
   `approvalId`.
6. After an uncertain response, recover `receipts_get` with the same execution
   idempotency key. Retry only the unchanged command with that key.

Every mutating tool requires an `idempotencyKey`. Scoped tools require
`scope.entityId` and `scope.bookId`. No approval tool is exposed. Corrections use
`ledger_prepare_correction` to create a linked reversal proposal; they do not
edit or delete a posted voucher.

REST and MCP use the same capability dispatcher, accounting schemas and
parameterized PostgreSQL functions. MCP adds no bookkeeping rules.
