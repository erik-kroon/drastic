# Posting recovery

Status: implemented; local runtime observations and missing proof are recorded by the root integrator. No production, failure/recovery, crash or concurrency certification follows from static checks.

## Outcome

Operators and scoped clients can discover retained proposals after losing mounted UI state, recover current approval information, inspect posted receipts, and look up an original command key. No recovery read retries, approves, executes or reverses anything.

```text
Reload or uncertain response
  → scoped PostgreSQL recovery read
  → retained proposal + current diagnostics + immutable committed request history
  → review the exact proposal and evidence
  → explicit approval or execution through existing kernel commands
```

The workspace uses `PostingRecoveryPanel` to discover proposals and `PostingRecoveryReview` for review/actions. The original `SealedAction` component remains the evidence/line renderer. No second journal compiler or posting path is introduced.

## State meanings

- `posted`: the exact change set has a committed execution receipt.
- `posted_by_other_proposal`: another proposal already posted the same event/purpose/occurrence, or the same original voucher was reversed. Its receipt is returned. This proposal must not be represented as executed itself.
- `unposted_at_check`: no corresponding posted voucher/receipt was observed at `checkedAt`. This is not a promise that an in-flight request cannot arrive later, or a licence to submit the same economic event under a new identity.
- Request lookup `committed`: the retained command completed and committed. It may be preparation, validation or approval, not necessarily posting. The returned historical approval can now be expired or consumed.
- Request lookup `not_observed`: no supported committed receipt for this key was visible at this check. This is not a failed/cancelled/not-admitted acknowledgement. It also does not classify keys belonging to another operation.
- A failed, unavailable or timed-out recovery read leaves the client state **unknown**. Cached data is not shown as a successful current read after an error.

Readers take the book's shared lock and use current credential/member admission locks. They wait behind admitted book mutations, but cannot prevent a delayed network request from arriving after the read. Posting commands still recheck dependencies, approval consumption/expiry, current operator authority and uniqueness atomically.

The approval shown in detail is unconsumed, unexpired and held by a current operator at the check. Current dependency diagnostics are separate. Neither field promises later execution success. Original request receipts are immutable; the adjacent approval-state diagnostic is live and explicitly not part of immutable history.

## History and continuation

Recovery reuses `change_sets`, `command_receipts`, `approvals`, `vouchers` and `execution_receipts`. It does not add an alternative request log. Existing immutable triggers protect the successful command/receipt history. Failed and in-flight attempts are not retained by this slice and must not be described as audited.

List and request history pages return at most 20 records and a scoped continuation. Ordering uses retained timestamps plus ID/key tie breakers. Pages are live reads, not a frozen whole-book snapshot. Newer records appear on refresh of the first page; no truncated result is labelled complete. Empty pages are not evidence of source completeness.

Supported historical command operations are `prepare_journal`, `prepare_correction`, `validate_change`, `approve_change`, and `execute_change`. Deterministic recurring preparation uses the first operation and is discoverable. Read access follows existing book membership; replay remains bound to the original actor and exact request fingerprint. A different authorised actor can inspect the receipt without acquiring the original actor's retry identity.

## Durable browser command identity

Before approval or execution POST, the new review stores an idempotency key in localStorage under a SHA-256 identity of actor, scoped path and exact request payload. No token, source text, amount payload or approval body is retained there. Storage must succeed before POST; otherwise the UI refuses to send the command.

Reloads in the same browser recover this identity. PostgreSQL discovery and receipts provide recovery on other browsers or after local storage is cleared. Clearing local storage does not remove server records. Concurrent tabs, browser storage eviction and private-mode behavior remain unverified; this is not a claim of browser-level exactly-once delivery.

An explicit approval request can rotate an old browser key only when the original approval command is found committed for the same actor/digest and its expiry is no later than the latest server check. A missing or uncertain receipt never rotates the key. An execution retry retains its key. Server uniqueness and approval checks remain the financial authority, not localStorage.

Lost preparation responses are recovered through the retained proposal list or original-key lookup. This slice does not alter the shared journal draft's mounted-state key map. A preparation that never committed is not reconstructible from server history. Do not infer the fate of a currently in-flight preparation from its absence in a list.

## Correction boundary

Migration0300 introduces private `posting_recovery_standalone(book,id)`. The corrections owner replaces this gate when installing atomic correction bundles. Bundle children are then excluded from discovery and rejected by standalone detail; the bundle's own recovery surface owns their combined state. This gate is a presentation boundary, not the paired-posting invariant. The corrections module must enforce that invariant at the database boundary.

No `execute_change` rewrite or multi-action kernel behavior is introduced here. Old kernel reads remain available for exact evidence inspection. Generic request-key lookup remains historical and must not make a grouped child independently executable.

## Shared integration

Owned files:

- `packages/contracts/src/posting-recovery.ts`
- `apps/api/src/posting-recovery.ts`
- `apps/api/migrations/0300-posting-recovery.sql` (applied by root; immutable)
- `apps/web/src/components/posting-recovery/`

The root composition exports `@open-erp/contracts/posting-recovery`, adds `PostingRecoveryApi` and `PostingRecoveryHandlers`, merges `PostingRecoveryCapabilities`, and binds fixed statements in the shared dispatcher. REST and MCP use the same capability functions:

| Capability                | REST suffix under the scoped book               | SQL                                              |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------ |
| `posting_list_recovery`   | `GET /posting-recovery?after=<proposal-id>`     | `list_posting_recovery(token,scope,after_id)`    |
| `posting_get_recovery`    | `GET /posting-recovery/:id?after=<request-key>` | `get_posting_recovery(token,scope,id,after_key)` |
| `posting_recover_request` | `GET /posting-requests/:key`                    | `recover_posting_request(token,scope,key)`       |

Missing continuation values map to SQL NULL via `NULLIF` in the fixed dispatcher statement. Every public function authenticates and checks entity/book scope. Helpers have no PUBLIC/runtime execute grant. Queries are parameterized, with a protected search path.

Workspace integration mounts `PostingRecoveryPanel` with `book`, `locale`, and `onPrepared={setPlanId}`. Replace the mounted `JournalReview` with `PostingRecoveryReview` using the same `book/id/locale/accounts` props. Keep the original module for `SealedAction`. Key workspace/review by book/proposal to reset local UI state across scope changes.

## Proof still missing

No tests or fixtures were added under the current instruction. The owner did not run migrations, database mutations, servers, builds or repo-wide checks. Root owns those resources and any manual runtime observations.

Still needed before making failure/recovery claims: lost replies before/after commit; delayed request after a not-observed read; reload across approval/execute; actor changes; revoked/expired credentials and memberships; expired/consumed approvals; simultaneous tabs/actors/executions; admission lock contention; database cancellation and crash; request-history continuation under concurrent new records; original/equivalent/reversed posting distinctions; correction-child exclusions; localStorage denial/eviction; narrow-screen/keyboard/screen-reader/200% zoom behavior. Static lint or type checks do not prove any of these.


## 0310 design record — before implementation

Scope: saved single-action requests, terminal outcomes, deliberate replay, and append-only approval revocation. No applied migration is changed. No real-company activation is authorized.

Risks and acceptance cases:

- Saving and running are separate transactions. Saving must not prepare, approve, consume authority or post. Lost save replies are recovered through book discovery; run must use the saved body, original actor and fixed kernel key.
- A run may lose its reply before or after commit. Only a persisted outcome establishes committed/refused. No outcome means unknown at check, including work never run. Authentication, network, cancellation, SQL defects and commit-time failures must not be recorded as business refusals.
- A caught, allow-listed kernel refusal must roll back all attempted kernel changes before its terminal refusal is appended. The same request cannot later execute; an explicitly new request is needed after a terminal refusal. Unknown requests retain their identity.
- Concurrent runs, replays and revocation serialize under the book mutation barrier after credential/member admission locks. An unchanged same-actor replay returns its original outcome; identity substitution and other-actor execution are rejected.
- Revocation must remain an immutable authority event, not consumption. A consumed approval cannot be revoked. Every later approval-consumption update must reject revoked authority, including calls through existing bundle/kernel functions. Existing successful receipts remain valid history.
- Reads are scoped, paged live observations. Approval diagnostics exclude revoked grants and preserve consumed/expired/authority-lost distinctions. Missing pages/records never imply source completeness or cancellation.
- Saved request payloads contain financial/evidence data and are readable only with current book membership. Browser storage contains only actor/scope/body hashes and request keys, never bearer/session credentials or source bodies.
- Browser recovery must show the exact saved command before a deliberate run, preserve unknown on failed reads and offer no automatic replay on mount. Evidence, proposal digest, approval and execution receipt stay inspectable.
- Public SQL is fixed and parameterized. Helpers, tables and trigger functions are denied to PUBLIC/runtime. Unsupported keys/shapes must be refused rather than retained as authority-looking claims.
- Root must verify lost replies, competing first calls, cancellation/rollback, revocation races, permission loss, narrow layout/keyboard/200% zoom and REST/MCP parity before any failure/concurrency claim. No tests, builds, servers, migrations or database writes are authorized for this owner.

Before: only successful kernel commands were discoverable; failed/in-flight preparation body was not server retained; approval revocation was absent.
After target: immutable admitted bodies plus separate immutable terminal outcomes; explicit existing-kernel dispatch; append-only revocation with consumption-time enforcement. Unknown is never converted to refusal merely because a response is absent.
