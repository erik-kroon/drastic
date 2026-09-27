# Accounting MCP

Endpoint: `POST /api/mcp`.

This is a stateless, JSON-only endpoint for the shared accounting operations.
Each operation retains its profile and authority requirements. Catalog presence
does not establish company readiness, source completeness or statutory acceptance.

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
  server notifications, the MCP background-task protocol and session persistence
  are not supported. Explicit domain job commands use the separate Bun runner.
- Accepted `notifications/initialized` messages return HTTP 202 with no body.
  Other HTTP methods return 405 after authentication.
- API request bodies have an 8 MiB byte limit and a 15-second read timeout.
  Better Auth request bodies have a 16 KiB limit. Oversized bodies return 413;
  slow bodies return 408. Limits apply even without `Content-Length`.
- JSON bodies must use valid UTF-8, unique object keys (including escaped-equivalent
  keys), and at most 128 nested objects/arrays. Violations return HTTP 400 before
  dispatch. Repeating a key in different objects is valid. Evidence strings and
  original request bytes are not rewritten. Non-JSON Better Auth forms are unchanged.

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

REST and MCP use the same accounting schemas and named Effect operations.
Application workflows own scoped database writes. MCP adds no bookkeeping rules.
The runtime must bind every declared capability; operator-only REST operations
need not become agent tools.

## Exposure policy and callers

[The application policy](../src/application/capabilities/agent-policy.ts) classifies
every declared write as record, preparation, approved execution, human review,
administration, statutory activation or operator-only work. Reads already declare
`readOnly` in their contracts. A write without a classification is withheld.
An owner's `agentCallable: false` also withholds a capability, including reads.

Only reads and classified record/preparation/approved-execution tools are eligible
for MCP. Discovery and `tools/call` use the same filtered set. A hidden name returns
`Unknown tool` even when the bearer belongs to an operator. Human company fact
review, role binding, firm administration, company setup and period-work mutations
remain outside MCP. Use their authorized HTTP/UI operations.

| Caller | Admission and authority |
| --- | --- |
| Web and REST | Validated contracts call their named application owner. Human-only workflows check the current operator or browser identity. |
| MCP | PostgreSQL checks the credential before dispatch. The filtered catalog limits exposure; the owner still checks book, role, profile, approval and current dependencies. |
| Bun preparation jobs | The runner admits its service credential. Preparation, extraction and period-work owners recheck their scoped state and cancellation rules. A queued payload cannot grant human approval. |
| Operator scripts | Provisioning, migration and recovery use their explicit maintenance/runtime boundaries. They do not receive authority from MCP metadata. |

`PostingOwner` remains an internal application argument. Generic transport schemas
do not accept it. Posting admission requires the real owner for protected invoice,
credit, tax and other owned actions. Catalog classification is not financial
authorization; a listed tool can still refuse a caller who lacks the required
current role or profile.

## Verification

`apps/api/tests/mcp-authority.e2e.test.ts` exercises the real MCP endpoint. It checks
complete catalog classification, hidden-name invocation, forged owner fields,
cross-book refusal, approved agent execution, exact-key replay, changed-input
conflict and credential revocation. A currently authorized operator can still
recover the original committed receipt after the agent credential is revoked.

Run `bun run test:e2e`. The suite retains the complete classified catalog and
observed receipts in `test-results/e2e/mcp-authority-journey.json`, beside the source
manifest and results. Existing HTTP tests cover human approval, membership/session
revocation and posting rollback. These checks do not qualify every financial
family, background-job race or external provider.
