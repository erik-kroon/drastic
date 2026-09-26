# Posting recovery — 0310 handoff

## Current ownership

Application operations live in [application/posting-recovery.ts](../src/application/posting-recovery.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Status: locally implemented, **not integrated or runtime-verified**. Owned-file Oxlint/formatting only. No tests, builds, servers, migration runs, database writes, dependency installs, Git actions, external submissions or production activation were performed for 0310. Historical root observations of 0300 are not evidence for 0310.

### Owned delivery

- `apps/api/migrations/0310-saved-posting-requests.sql` — new forward migration; do not modify applied migrations through 0900.
- `packages/contracts/src/posting-recovery.ts` — saved command/outcome schemas, six REST operations, four ordinary capabilities; revoked diagnostic.
- `apps/api/src/posting-recovery.ts` — Effect handlers using the existing Drizzle-backed dispatcher; no new database adapter.
- `apps/web/src/components/posting-recovery/draft.tsx` — owned `PostingDraft` replacement for shared `JournalDraft`.
- `apps/web/src/components/posting-recovery/saved-requests.tsx` — paged discovery, retained body/evidence/proposal review and deliberate scoped replay.
- `apps/web/src/components/posting-recovery/{request,review,copy}.ts*` — save/run requests, review/approval/revocation/posting and English/Swedish copy.
- This document. Existing `panel.tsx` and all shared composition files are untouched.

### Behavior and authority

```text
Explicit save-and-run action
  -> save immutable (book, request key, actor, exact command, canonical digest, kernel key)
  -> committed save response
  -> explicit run with the saved key, never a replacement body
  -> existing create_evidence / prepare_journal / approve_change / execute_change
     or private append-only approval revocation
  -> one immutable committed/refused outcome, in the command transaction

Reload / missing reply
  -> discover saved requests or inspect an exact saved key
  -> review original command and evidence
  -> run unchanged as the original actor, or read its terminal outcome
```

Saving never runs a command and does not grant authority. The UI sends save and run as two requests from one explicit labelled action. An interrupted save/run boundary leaves a discoverable request without an outcome. Loading, listing, refreshing and opening a request never run it. Unsubmitted form edits are not saved drafts.

Requests and outcomes are append-only. The server chooses and retains a random kernel key; canonical request digest includes normalized entity/book scope, actor and command. Keys cannot be rebound to another body or actor. The run endpoint takes only the saved key. It rechecks current authentication/membership, takes the book mutation lock, and dispatches a fixed supported operation. It does not accept SQL, arbitrary posting lines at execution, new approval references or replacement bodies.

`committed` means this specific command committed, not necessarily posting. A saved execution receipt remains historical after expiry/revocation/permission changes. `refused` means an allow-listed kernel business rejection rolled back its subtransaction and a terminal refusal was committed. A refused request stays refused; deliberate replacement needs a new request. A command-receipt insertion guard also blocks reuse of its reserved kernel key through old endpoints and rejects actor/operation/body substitutions. It does not rewrite `execute_change` or its receipt format.

`unknown` means no terminal outcome was observed at the server check. It includes not-yet-run work, lost responses and in-flight work. Authentication/authorization errors, network errors, cancellations, SQL defects and commit-time constraint/connection failures are **not** persisted as refusal. Failed reads leave current state unknown; absence is not cancellation. A late save/run can still arrive after a read. Only durable outcomes distinguish terminal refusal from uncertainty.

The refusal allow-list is `InvalidJournal`, `MissingEvidence`, `PeriodLocked`, `StaleDependency`, `IdempotencyConflict`, `AlreadyPosted`, `ApprovalRequired`, `UnsupportedProfile`, `NotFound`. All other errors propagate without an outcome. Deferred commit-time errors may therefore leave a saved request unknown even when its attempted transaction rolled back; retry remains under the same identity.

All reads require current book membership. Only the original saving actor can run/replay. A different current member can read history, not acquire another actor's retry authority. Human authority commands require an operator at both save and run. They have separate REST/SQL operations and are absent from ordinary MCP capabilities. The generic SQL save/run rejects approval and revocation commands even if the key is known. This uses the existing trusted operator-role boundary; it is not new proof of physical human presence.

#### Approval revocation

Any current book operator can revoke an unused approval with an explicit reason. The immutable event records approval, actor, reason and server time. Consumed approval cannot be revoked. Revocation is not consumption and never reverses a voucher. Book-first ordering serializes revoke/execute; credential/member admission locks are retained.

A `BEFORE UPDATE OR DELETE` approval trigger protects immutable grant identity and one-way consumption. Every existing kernel/bundle consumption rejects a revoked or expired approval and rechecks current operator membership under a shared lock. If a voucher was inserted earlier in the same transaction, this rejection rolls back the transaction. No second financial posting engine or multi-action `execute_change` rewrite exists.

The forward replacement of `get_posting_recovery` excludes revoked available approvals and adds `revoked` to live approval-history diagnostics. Consumed, expired and authority-lost meanings remain distinct. Old immutable approval receipts are not rewritten. The existing one-hour approval lifetime is retained; custom lifetimes and standing mandates are not introduced. The ordinary review offers revocation of the currently available grant. Other unused/expired grants can be targeted through the operator REST command; a full approval-administration UI is not included.

#### Browser identity and review

Only hashes and request keys enter localStorage. No bearer/session credentials, evidence text, financial payload or approval body is stored there. Storage failure blocks a new save. Server discovery survives cleared storage and another browser. Saved-key replay does not require localStorage.

Unknown requests keep their identity. The UI can replace a key only after re-saving/recovering an existing terminal outcome during an explicit new-request action. Approval renewal is deliberate and available only when the current server review has no usable approval; it does not turn an expired or revoked historical grant back into authority. Concurrent tabs/storage eviction are not claimed to provide browser-level exactly-once delivery; PostgreSQL invariants remain authoritative.

`PostingDraft` uses existing exact minor-unit forms and the existing synthetic manual-journal profile. It includes a collapsed saved-request discovery section and resumes retained evidence after reload. `PostingRecoveryReview` retains the owned `SealedAction` renderer for evidence/lines, shows dependency findings, digest, approval and execution receipts, and adds revocation. Saved approve/execute requests fetch the retained proposal before enabling deliberate replay. An old approval may now be expired, revoked or authority-lost; the kernel checks again at run.

No company legal form, fiscal dates, VAT treatment, funding classification, completeness or production readiness is inferred. First-year expenses/funding still require accountant review and an approved production profile. No posting or submission of real company data was authorized.

### Root integration — required before validation

The existing contract export, `PostingRecoveryApi`/`PostingRecoveryHandlers` composition and spread of `PostingRecoveryCapabilities` are already present. Leave them in place. Add the bindings below; owned handlers otherwise refer to missing shared capability/operation members. This packet is not a claim that the unintegrated repository type-checks.

#### Fixed Drizzle SQL statements in `apps/api/src/database.ts`

Each statement returns `as result`. Keep existing `sql` parameterization; do not interpolate operation names or SQL fragments from callers.

| DatabaseOperation             | SQL function                             | Parameters after token                   |
| ----------------------------- | ---------------------------------------- | ---------------------------------------- |
| `savePostingRequest`          | `openerp.save_posting_request`           | scope jsonb, key text, command jsonb     |
| `savePostingAuthorityRequest` | `openerp.save_posting_authority_request` | scope jsonb, key text, command jsonb     |
| `runPostingRequest`           | `openerp.run_posting_request`            | scope jsonb, key text                    |
| `runPostingAuthorityRequest`  | `openerp.run_posting_authority_request`  | scope jsonb, key text                    |
| `getSavedPostingRequest`      | `openerp.get_saved_posting_request`      | scope jsonb, key text                    |
| `listSavedPostingRequests`    | `openerp.list_saved_posting_requests`    | scope jsonb, `NULLIF(after_key text,'')` |

For example:

```ts
savePostingRequest: (parameters) =>
  sql`select openerp.save_posting_request(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
```

`DatabaseOperation` currently derives from this fixed map. No new adapter, connection pool or dependency is needed. The new tables are accessed only inside SQL functions, so the current maintenance-only Drizzle table map needs no consumer mapping for this slice. If root adds maintenance access later, preserve SQL-owned DDL/grants/triggers rather than schema push.

#### Shared capability dispatcher in `apps/api/src/capabilities.ts`

```ts
posting_save_request: bindCapability(Capabilities.posting_save_request, "savePostingRequest", (input) => [
  scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.command),
]),
posting_run_request: bindCapability(Capabilities.posting_run_request, "runPostingRequest", (input) => [
  scopeParameter(input.scope), input.key,
]),
posting_get_saved_request: bindCapability(Capabilities.posting_get_saved_request, "getSavedPostingRequest", (input) => [
  scopeParameter(input.scope), input.key,
]),
posting_list_saved_requests: bindCapability(Capabilities.posting_list_saved_requests, "listSavedPostingRequests", (input) => [
  scopeParameter(input.scope), input.after ?? "",
]),
```

Do **not** add authority save/run capabilities to ordinary MCP. Owned REST handlers call the two authority database operations directly. Existing same-origin cookie checks and SQL Better Auth/credential admission checks remain the shared authentication boundary.

#### REST surface

Prefix: `/api/v1/entities/:entityId/books/:bookId`.

| Method and suffix                                 | Input                                                  | Capability                    |
| ------------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `POST /saved-posting-requests`                    | Idempotency-Key header; `PostingCommand` body          | `posting_save_request`        |
| `POST /saved-posting-authority-requests`          | Idempotency-Key header; `PostingAuthorityCommand` body | operator REST only            |
| `POST /saved-posting-requests/:key/run`           | saved key; no body replacement                         | `posting_run_request`         |
| `POST /saved-posting-authority-requests/:key/run` | saved key; no body replacement                         | operator REST only            |
| `GET /saved-posting-requests/:key`                | saved key                                              | `posting_get_saved_request`   |
| `GET /saved-posting-requests?after=...`           | optional saved-key continuation                        | `posting_list_saved_requests` |

Command bodies:

- `{ operation: "create_evidence", input: CreateEvidence }`
- `{ operation: "prepare_journal", input: PrepareJournal }`
- `{ operation: "execute_change", id: changeSetId, input: ExecuteChange }`
- Operator only: `{ operation: "approve_change", id: changeSetId, input: ApproveChange }`
- Operator only: `{ operation: "revoke_approval", id: approvalId, input: { reason } }`

REST payloads and MCP decoding reject excess properties; SQL independently checks supported top-level/nested fields and bounded representations, including a 1 MiB serialized-command admission limit. Raw duplicate JSON member rejection before JSON parsing remains a **shared body-boundary review/proof requirement**, not something implemented by these already-decoded domain schemas. Do not count PST-01 duplicate-member proof as complete.

Lists return at most 20 summaries plus a scoped timestamp/key continuation. Bodies are fetched individually; pages are live, not frozen snapshots or a complete source inventory. Detail includes immutable request, original command, current-reader `sameActor`, checked time and nullable terminal outcome. Terminal outcomes return HTTP success with `state: refused` or `state: committed`; transport failures remain errors and must not be recast as terminal refusal. The existing `/posting-requests/:key` keeps its original committed/not_observed meaning; its key is the kernel key, not the saved-request key. Save/run clients use the new paths.

#### Workspace

Root replaces the shared `JournalDraft` import/render with:

```tsx
import { PostingDraft } from "@/components/posting-recovery/draft";
// Same props as JournalDraft:
<PostingDraft book={book} setup={setup} locale={locale} onPrepared={setPlanId} />;
```

Keep current `PostingRecoveryPanel` and `PostingRecoveryReview` mounts. Keep shared `journal-review.tsx` for `SealedAction`. Key the workspace/draft by book and review by proposal; clear query state on session identity change through the existing shared auth boundary. The owned draft reuses the form structure because editing shared components was outside this packet. Root can remove the unused old draft later if no other consumers remain.

#### Migration and compatibility

0310 requires 0300 and the existing accounting schema/kernel. It is additive and preserves the later `posting_recovery_standalone` definition owned by corrections. It does not edit 0002/0210/0300/0400/0502/0900 or weaken the bank-capacity/paired-correction triggers. Existing proposal history and kernel receipt endpoints retain their meanings. Saved approve/execute dispatch refuses bundled child proposals through the current standalone gate.

Private helpers, trigger functions and all three new tables are explicitly revoked from PUBLIC/runtime. Only six authenticated scoped entrypoints receive runtime EXECUTE. All functions use protected search paths. No new error codes, account types or financial profiles are required.

### Root proof checklist — still unverified

These are future acceptance cases, not authorization to run restricted checks or add tests. Root must obtain any required permission first.

1. Integrate the six statements/four capability bindings/workspace replacement. Run serialized type/lint/build checks under root authority. Capture exact source hashes and command output, not a blanket pass.
2. Apply 0310 through the root migration runner on an authorized disposable environment. Verify applied migration hashes remain unchanged, helper/table grants and SQL function creation/binding. No migration was executed by this owner.
3. Save without run: no evidence, proposal, approval, voucher, sequence increment or outbox effect. Lose the save reply; discover/re-save the same key. Lose the run reply before and after commit; recover the same immutable outcome and receipt after reload.
4. Race first runs, equal saves, actor/body substitutions and book-scope crossings. One kernel command/outcome; changed identity rejected. Race delayed run after an unknown read. Check current actor/session switches and revoked/expired credentials/memberships.
5. Force every allow-listed refusal and a failure after tentative ledger/counter writes. Verify rollback before durable refusal. Re-run refused keys through both new and old endpoints, including wrong actor/operation/body with the reserved kernel key. No later effects under that key.
6. Inject SQL errors, cancellation, disconnect and deferred commit failure. These must not fabricate terminal refusal. Replay unchanged identity when no outcome exists; capture counters, approval, voucher, receipt and outbox invariants.
7. Race approval revocation and consumption from plain execution and bundle execution. Prior valid consumption or revocation rejection, never both. Revoked does not mean consumed/posted. Existing receipts remain readable to current members. Test expired approval renewal, approver authority loss and revocation of another operator's unused grant.
8. Check direct REST/MCP shape parity, unsafe extra fields, numeric-vs-string amounts, Unicode, raw duplicate members, payload size and actor/scope mismatches. Verify ordinary MCP cannot save or run authority commands, including a known human request key.
9. Check paged discovery/history with concurrent saves, empty pages, cleared storage, denied storage and multiple tabs. Unknown and refused remain distinct. No automatic run on page load, refetch, opening a disclosure or switching books.
10. Capture browser evidence for preparation → exact evidence review → approval → execution → reload/recovery; retained evidence resume; terminal refusal/replacement; revocation; stale dependency; keyboard, focus, narrow widths, reduced motion and 200% zoom. This owner added no tests or fixtures and made no browser/runtime proof claim.

### 0310 design record — before implementation

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

#### 0310 review refinement before receipt-guard implementation

Risk: callers can inspect the internal kernel key and send it to an existing kernel endpoint after the saved wrapper recorded refusal. A wrapper-only terminal check would not prevent that reuse. Add a command-receipt insertion guard: keys reserved by saved requests must match their immutable actor/operation/body fingerprint and must not belong to a terminally refused request. Rejection at kernel receipt insertion rolls back that kernel transaction. Verify this bypass case at root; source review alone is not proof.

### Local static observations

Bounded `bunx --no-install oxlint` on the seven owned TypeScript/TSX files completed with **0 warnings and 0 errors**. Bounded Oxfmt completed successfully on those files and this document. No type, SQL, integration, concurrency or browser result is implied. Source comparison against the migration files read at task start found no changes to those applied migrations.

Source SHA-256 inventory (this document excluded to avoid a self-referential hash):

| Path                                                          | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/contracts/src/posting-recovery.ts`                  | `a8caf2f2bc79db4aeea8b5f7382292df23223e29716ef6ffe89d853d5046b586` |
| `apps/api/src/posting-recovery.ts`                            | `e7abeef3413602eef6112447f16dbb3084bf06cbc0e1046ae5ad9b28fb47b9c3` |
| `apps/web/src/components/posting-recovery/copy.ts`            | `bdf856cfb675b6cb79105026556a7a959784de8d60eb8d56f1adcb7e4a1c1c2f` |
| `apps/web/src/components/posting-recovery/draft.tsx`          | `95c2c266ecdffcd89c56322550cbd7f56c03e9eba2ffd5e6cda7cc0eb44c15e9` |
| `apps/web/src/components/posting-recovery/request.ts`         | `f097918431b598d4607302ddf0b3d4a6723e217f1bcb564c5a2679dce1214712` |
| `apps/web/src/components/posting-recovery/review.tsx`         | `66ef2658f2591164b784acf54574b94b7bcf93f94d56bf0d51a5836e5877bcf6` |
| `apps/web/src/components/posting-recovery/saved-requests.tsx` | `7df92b267bbb35fb668b37cf8158ae93f2fb60881ce01c72429ce70697865eb7` |
| `apps/api/migrations/0310-saved-posting-requests.sql`         | `d8e0b4b5fefe3752db81402d27bcc000fe48a834dcbeda8ed39fa4f92208daec` |
