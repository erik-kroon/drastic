# ADR 0010: application-owned accounting replacement

Status: accepted implementation decision, 2026-09-25. The replacement, clean database baseline and effect-mq integration are planned; implementation and runtime proof remain open.

## Context

OpenERP has no users or deployed accounting data to preserve. The current source still exposes the earlier accounting boundary: most capabilities in `apps/api/src/application/capabilities.ts` bind a name and string parameters to `apps/api/src/db/query.ts`; several HTTP handlers call `query()` directly; and `query()` creates a new database layer for each call. The current hosted preparation path is a Cloudflare Workflow with a Cron dispatcher in `apps/api/src/runtime/cloudflare.ts`, while the self-host entrypoint has no connected background runner.

The replacement must retain the financial requirements in [ADR 0002](0002-exact-posting-and-approval.md), [ADR 0004](0004-complete-accounting-delivery-contract.md) and [ADR 0008](0008-financial-fx-vat-impairment.md), but change where those rules live. It must also cover more than the HTTP surface: the same operations are reached by the MCP catalogue, web query and mutation clients, Worker jobs, Bun entrypoints, provider scripts, recovery controls and operator commands. A partial move would leave two accounting authorities or transactions that cannot share one connection.

## Selected trust boundary

The application process is the trusted owner of authentication, authorization, policy, calculations, workflow decisions and financial writes. It receives a verified principal and decoded command, re-establishes current entity/book authority at the mutation boundary, and writes only the application tables granted to its runtime role. A compromised backend could manufacture a balanced business action within those grants; PostgreSQL integrity prevents malformed or damaged history, not human approval. This security-boundary change is explicit and accepted.

PostgreSQL remains the relational authority for records, constraints, grants, row locks, aggregate integrity and durable receipts. It is not a second policy engine. SQL owns DDL and a narrow integrity layer; application operations own business policy and direct scoped DML. Better Auth keeps its official Promise adapter over its own auth tables, while accounting operations use the native Effect/Drizzle path. No caller-controlled tenant variable, session-level tenant context, RLS policy or second accounting connection is introduced.

The API Worker remains request-scoped and does not load the durable queue listener. The selected [ADR 0009](0009-effect-mq-background-jobs.md) effect-mq design uses a separate persistent Bun worker and PostgreSQL session-preserving listener with polling recovery. That listener is a queue transport detail, not accounting identity or financial transaction state.

## Transaction, identity, lock and failure contract

### Transactions

Every operation that changes accounting state follows this shape:

```text
authenticate and decode
  -> capture a short, consistent read snapshot
  -> calculate from immutable facts outside the database transaction
  -> begin one transaction on one connection
      recheck current authority, scope and dependencies
      recover or reject the scoped idempotency identity
      write the complete financial/register group, counters, approval use,
      receipt and outbox intent through tx
      let narrow integrity checks run
    commit
  -> return success only after commit
```

All nested persistence calls receive that transaction. No operation may call the old `query()` wrapper, acquire another database layer, start another runtime, or open an independent transaction inside the callback. A correction reversal and replacement, or another supported multi-voucher group, commits with its register effects and aggregate receipt as one unit. External downloads, model calls, rendering and provider calls run outside the financial transaction.

### Identity and authorization

The HTTP/MCP edge may establish a session or credential, but the application re-resolves the current credential, session, membership, entity and book inside the mutation transaction. A selected book, hidden control, browser role, job payload or cached permission is not authority. Human approval is a separate named operation bound to the exact sealed plan and approver authority; an agent or queued job cannot mint it.

Durable handlers use a scoped service identity, recheck the current book permission and relevant run/cancellation version, and call the same named application operation as an interactive caller. A job receives no human token and cannot broaden a grant. Recovery reads recheck current access before returning a receipt.

### Locks and counters

The initial financial boundary is one book. Lock in this order: credential/session and executor membership; the book writer row; relevant period and account rows; domain capacity/resource rows in stable type/ID order; approval and approver authority; transactional counters. Revocation is an authority-only transaction and does not acquire a book lock. A cross-book administration operation must either split work or acquire a fully ordered lock set; it must not hold one book while entering another.

Use ordinary row locks and transactional counter updates, including `UPDATE ... RETURNING` where allocation requires rollback-safe numbering. `SKIP LOCKED` is limited to bounded outbox/queue dispatch work and never skips a contended financial record. Financial transactions use no session-level tenant context and no session advisory locks.

### Failure and recovery

Domain refusals are typed application failures and roll back the transaction. The database boundary translates only known integrity identities and availability failures; it does not expose SQL, parameters, credentials or raw causes. A timeout, cancellation or lost response near commit leaves an uncertain outcome. The caller recovers with the original scoped key and immutable input, or reads the durable receipt; it never creates a fresh economic command automatically.

The financial mutation, register effects, approval consumption, numbering, receipt and required outbox intent commit together. Delivery is later and at least once. A queue retry or duplicate handler call must converge through the application identity and receipts. A committed financial effect is changed only by its explicit correction operation, never by queue cancellation, retry, history pruning or job status.

## Narrow SQL integrity allowlist

The new baseline permits only these database responsibilities:

| Allowed SQL responsibility | Boundary |
| --- | --- |
| DDL, primary/foreign keys, composite book-scoped references, unique effect and idempotency identities, indexes, exact amount bounds and ordinary state checks | The schema describes durable relationships and storage validity. |
| Deferred voucher integrity | A small commit-time check verifies the expected line count, valid line shape and exact debit/credit balance; immutable history and append protection prevent later edits. |
| Sealed records and approval-use integrity | Narrow triggers or constraints prevent rewriting sealed plans, retained revisions and receipts and prevent reuse of one approval consumption. |
| Role, grant, migration and restore authority | The non-owner runtime role receives only required table/column privileges; maintenance, migration and restore credentials remain separate. |
| Row locking and rollback-safe counters | The application acquires ordinary row locks and uses transactional counter statements such as `UPDATE ... RETURNING`; these are not feature procedures. |

No feature workflow, tax/payroll/FX/report calculator, authorization decision, approval lifecycle, generic CRUD function, operation-name dispatcher, RLS/session context, advisory-lock protocol or queue/business state machine belongs in the SQL allowlist. Integrity functions have a fixed safe search path and no public execution grant. The runtime role cannot alter the schema, disable triggers, truncate tables or mutate posted history.

## Clean three-file baseline

Use one reviewed baseline with exactly:

1. `0001-schema.sql` — final relational tables, keys, indexes, typed columns and nullability.
2. `0002-integrity.sql` — the narrow integrity triggers and immutable-history protections.
3. `0003-roles.sql` — runtime, maintenance and restore grants and role boundaries.

Keep the existing checksum-based migration runner and one migration receipt ledger. The old migration chain remains in Git as history only. It is not applied to a populated replacement database, translated by a compatibility layer or silently reset by application startup. The old chain, procedural feature functions, SQL dispatch registry and obsolete grants are deleted at the completed cutover after callers and proof pass. A recorded checksum mismatch or an old installation is refused; the application does not modify it.

After the clean baseline is released, normal forward migrations apply to future deployed data. A new release may upgrade its own released baseline, but this unreleased replacement has no old-to-new populated-upgrade path.

## Live replacement inventory

This is the decision inventory for the plan slices, not a claim that the source has been migrated. Each row names the caller families that must move or disappear.

| Plan slice or cross-cutting work | Disposition | Target and real caller families |
| --- | --- | --- |
| Identity, setup, books and permissions | Rewrite | Better Auth adapter and `transport/http/auth.ts`; `AccountingHandlers`, `FirmHandlers`, `CompanySetupHandlers`, `WorkspaceHandlers`; MCP capability registry; web setup/company/book routes; `provision.ts`, `create-user.ts`, `self-host-role.ts` and `migrate.ts`. |
| Posting, approval, receipts and recovery | Rewrite | `AccountingHandlers`, `PostingRecoveryHandlers`, `capabilities.ts`, `transport/mcp.ts`; web `accounting-api.ts`, journal/review routes and components; recovery controls and real Worker E2E callers. Keep public route/capability IDs, not the old SQL dispatch. |
| Corrections and reversal/replacement groups | Rewrite | `CorrectionHandlers` and posting-recovery routes; `CorrectionsPanel`, `CorrectionReview`, `CorrectionDiscovery` and `journal-correction`; MCP tools; recovery controls and the correction E2E lane. |
| Evidence, cases, recurring work and source review | Rewrite | `SourceIntakeHandlers`, `CaseHandlers`, `AutomationHandlers`, `preparation-jobs.ts`; web `EvidenceCommandForm`, `CaseContext`, `CaseSnapshots`, `PreparationRun` and `PreparationBackground`; MCP, Worker and Bun durable callers. |
| Sales, invoices, orders and legal documents | Rewrite | `CommerceHandlers`, invoice draft/order/issuance/cancellation/document/PDF/policy/delivery/legal routes; web commerce components and routes; MCP capabilities; `invoice-*` application/rendering modules. |
| Purchases, suppliers and payments | Rewrite | Supplier inbox, draft, acceptance, payment-batch and credit handlers; web purchase/source components; MCP capabilities; source and supplier E2E callers. |
| Banking, matching, settlement and reconciliation | Rewrite | Reconciliation, bank statement, match candidate/reversal, source coverage, signoff, inventory and connector handlers; `bank-connector-sync.ts`; web banking components; durable source and bank E2E callers. |
| FX, rates and carrying-value coordination | Rewrite | `CommerceFxHandlers`, exchange-rate and commerce-FX routes/statements; `commerce-fx.ts` application boundary; web commerce/tax consumers; MCP and the concurrent FX work identified by the plan. |
| Subledgers, schedules, owners and controls | Rewrite | `SubledgerHandlers`, `SubledgerControlsHandlers`, `OwnerRegisterHandlers`, schedule and closing handlers; web schedule/owner/control components; MCP and correction/E2E callers. |
| VAT and tax-account application flows | Rewrite | `VatReturnsHandlers`, `TaxAccountHandlers`, `vat-returns.ts`, tax-account statements and web Tax components; MCP, correction and VAT E2E callers. |
| Swedish VAT and SIE pure calculations | Retain | `jurisdictions/se` and the existing pure capture/calculate pattern. Database capture, policy decisions, sealing and application recovery still move to application operations. |
| Payroll foundation | Rewrite | `PayrollFoundationHandlers`, payroll statements, `payroll-foundation` web component, MCP capabilities and the existing 9050 input contract. Do not invent a payroll engine or discard the input meaning. |
| Reports, register views and closing | Rewrite | `ReportHandlers`, `RegisterReportHandlers`, `ClosingHandlers`, `SieHandlers`/`SieImportHandlers`; web report/ledger/closing/SIE components; MCP and report/recovery callers. Typed SQL reads and pure calculations remain, but feature stored procedures do not. |
| Durable work, operations and recovery | Rewrite | `runtime/cloudflare.ts` Workflow/Cron path, `preparation-jobs.ts`, `index.ts`, `deadline-feed.ts`, `operations/*`, `bank-connector-sync.ts`, self-host and provisioning commands, `PreparationBackground`, document/SIE/PDF pipelines and restore manifests. Replace the old runner with the selected effect-mq Bun process and shared application operations. |
| Shared contracts, domain values and pure jurisdiction rules | Retain | `packages/contracts`, `packages/domain`, `jurisdictions/se`, the scoped public error family and existing route/capability names. Rewire their consumers; do not create a second contract or calculation model. |
| Current feature SQL, operation dispatch and migration chain | Delete | `db/query.ts` statement registry, all feature function calls and grants, old migration files and the current Cloudflare Workflow/Cron composition. Delete only after the inventory rows and proof gates close. |

The delete row is a cutover obligation, not permission to leave a half-migrated tree. A caller may not keep a private SQL path while its replacement is being built.

## Caller cutover

1. Inventory every `capabilities` binding, direct HTTP `query()` call, MCP capability, web `readAccounting`/`mutationOptions` caller, Worker handler, Bun entrypoint, operator script, provider script and recovery control.
2. Implement named application operations and transaction-passing persistence for the slice. Register the operation and its contract together, then move every transport and durable caller in the same change.
3. Start with identity, transaction foundation and the complete posting/receipt path. Finish each slice's preparation, execution, reads, corrections and recovery before calling it ported.
4. Move the current preparation job to one effect-mq-backed Bun handler, then port remaining durable work. Remove the Cloudflare Workflow and Cron dispatcher only after the handler, outbox crash-window and recovery checks pass.
5. Run source/catalog audits for old function names, string-array dispatch, direct feature SQL, stale grants and unclassified callers. Remove the old path, imports, scripts and documentation together.
6. Cut over the three-file baseline and self-host/hosted compositions as one release. There is no feature flag, dual writer, old-schema adapter, old-digest interpreter, fallback dispatch or compatibility period.

## ADR 0009 reconciliation

[ADR 0009](0009-effect-mq-background-jobs.md) is accepted and controls durable delivery. Its PostgreSQL/Bun listener supersedes the older plan sentence that forbade any `LISTEN/NOTIFY` dependency, but only for the separate effect-mq worker path. The API Worker does not load that listener. Financial transactions still use no session-level tenant context and no session advisory locks, and the listener never supplies accounting identity, approval, balance or commit state.

## Proof gates

This ADR records a design decision, not runtime proof. The following gates remain open:

| Gate | Required observation |
| --- | --- |
| Caller and source audit | Every inventory row has an application owner; source and catalog scans find no live feature-function call, string-array dispatcher, old grant or unclassified HTTP/MCP/web/job/script caller. |
| Clean baseline | Fresh install, populated rerun and checksum-drift refusal work under maintenance credentials; effective grants match the matrix; the old installation is refused without modification. |
| Transaction and integrity | Real Worker and Bun runs prove one connection per transaction, rollback, current authority checks, exact balancing, immutable history, correction atomicity and sanitized failure translation. |
| Identity and parity | REST, MCP, web and durable callers observe the same authorization, exact plan, receipt and recovery behavior across books, roles, revocation, stale plans and uncertain commits. |
| Durable delivery | The effect-mq package compiles/runs against the pinned dependencies; duplicate delivery, enqueue/ack crash windows, restart, claim loss, cancellation, stale handlers, polling recovery and graceful shutdown converge. |
| Operations and recovery | Backup/restore captures the new baseline and queue/application work inventories, keeps the database quarantined and does not claim provider acceptance or promotion. |
| Browser and company gates | Approved browser journeys, applicable Swedish profiles, real-company facts and provider receipts remain separate evidence. Synthetic success cannot activate a company or statutory profile. |

No library has been installed, no caller has been cut over, no database baseline has been applied and no runtime or E2E result is claimed by this ADR.
