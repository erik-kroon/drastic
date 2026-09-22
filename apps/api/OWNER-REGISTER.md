# Owner expense and funding register

## State and authority

This is an integration-ready **source implementation**, not observed runtime behavior.
No migration, database write, server, build, test, fixture or dependency change was performed by this owner.
The risk/acceptance cases were recorded before implementation in `.agents/work/owner-register-handoff.md`.
Root must integrate and validate before advertising these operations.

New owned paths:

- `packages/contracts/src/owner-register.ts`
- `apps/api/src/owner-register.ts`
- `apps/api/migrations/0610-owner-register.sql`
- `apps/web/src/components/owner-register/owner-register-panel.tsx`
- `apps/api/OWNER-REGISTER.md`

Existing commerce files and every applied migration remain unchanged by this work.
The forward migration depends on kernel helpers, bank tables from0100/0500 and commerce private
helpers from0600. It uses current admission helpers (including0900 Better Auth when applied).
Apply it as a new pending migration even when higher-numbered historical migrations already exist;
do not edit/replay0600 or renumber an applied migration. Root owns the migration decision and run.

## Implemented boundary

- Evidence-backed immutable owner identities and original source facts: actual company versus explicitly
  synthetic data, stable source key, source component/event key, owner/counterparty identity, original
  date, positive exact minor units, currency and scale. Nullable counterpart means unknown, not absent.
- Immutable description/classification/origin revisions; separate operator reviews of exact revision
  digests, evidence and explicitly supplied control accounts. Unknown classification/origin/account
  can remain in review records without activating accounting.
- Classification separates owner expenses/reimbursements, shareholder loans/repayments and conditional/
  unconditional contributions. Contribution classifications never establish repayment rights.
- Synthetic-only links to existing kernel proposals and exact posted lines. No ledger write, account
  suggestion, tax/deductibility inference, conversion or payment instruction. Original source occurrence
  matches `events(evidence_id,event_key)` using the retained locator. The ordinary kernel owns approval,
  execution, posting receipts and duplicate event identity.
- Kernel triggers refuse registered source preparation/posting without the explicit current synthetic
  review. Posting requires a current proposal attachment. A source introduced after an existing posting
  can attach that posted line after review without creating recognition again.
- Immutable posted effects; no paid flags. A posted owner-attached proposal or effect blocks classification
  revision. Linked voucher corrections, including previously prepared correction execution, are blocked
  until a supported release/correction workflow exists.
- Owner, commerce and bank control-account roles are mutually exclusive. Posted line claims are guarded
  in both registration orders across owner effects, commerce recognition/allocations and bank matches/
  allocation legs. Bank observation matching remains separate; a bank-side line of the same voucher may
  still be reconciled normally. Owner allocations never consume bank observations.
- One settlement effect can allocate to1–50 earlier compatible claims of the same owner/control account/
  currency. Separate one-hour operator approval and application recheck live capacities and versions.
  Immutable legs conserve both sides; deferred checks bind exact approved legs and receipt identity.
- Frozen as-of controls retain sources/reviews/effects/legs, classification-specific opening/prior/current
  movements and whole-account/all-owner register comparisons. `openingBalanceMinor` is **null** and source
  coverage stays unknown. No rows/zero difference never means zero complete company opening balance.
- Owner-scoped, same-actor command receipt recovery by saved key. Exact retries use existing command receipts.
  An absent recovery result is not proof that an in-flight transaction will not still commit.
- Lazy-mountable `OwnerRegisterPanel({ book, locale })`, local EN/SV instructions, explicit fields/review,
  source history, evidence inspection, split allocation review, saved IDs, mounted captured-request retry,
  frozen JSON download and receipt recovery. Reused commerce command controls retain request/outcome JSON
  (their download name still uses the commerce prefix; the artifact contains the exact owner route/scope).

## Deliberately blocked / not implemented

Real-company activation remains blocked even after classification review. Missing company form, fiscal,
VAT and other treatment facts are not filled with legal defaults. The synthetic bridge is not an import
or actual-company posting profile. Never relabel actual facts as synthetic to bypass this boundary.

No source completeness declaration, certified opening balance, legal shareholder identity verification,
VAT split, deductibility rule, native invoice issue, FX, advances/netting, contribution repayment, owner
identity merge, economic-fact edit or linked correction/release is implemented. Immutable source mistakes
remain retained for a future supported correction; do not invent another source key to hide them.

Source keys/locators are supplied assertions, not provider-verified economic identities. Known duplicate
keys, occurrences and posted capacities are rejected; deliberately assigning different evidence/identities
to the same real-world event cannot be detected as semantic equality by this register. Completeness stays
unknown. Frozen controls are bounded to1000 owner sources through cutoff; lists/history page50 at a time.
Company source retention still requires the root's actual admission/hosting/data-use authority; source
support does not grant permission to enter real private data or prove compliant archival retention.

Reviews are one per immutable revision. Changed account/profile/authority before posting requires a new
revision and review. Pending proposal attachments remain historical and fail at posting after revision
change. Historical posted effects do not disappear when a former reviewer leaves. Browser state is not
crash-safe storage: save fields, key and IDs before sending. No automatic mutation retry is enabled.

## Shared integration (root-owned)

1. Export `./owner-register` as `./src/owner-register.ts` in `packages/contracts/package.json`.
2. Add `OwnerRegisterApi` from `./owner-register` to `packages/contracts/src/api.ts`.
3. Spread `OwnerRegisterCapabilities` into the shared capability catalog. It contains16 capabilities;
   operator classification review and allocation approval intentionally remain REST-only.
4. Add the exact fixed parameterized Drizzle statements below to `apps/api/src/database.ts`.
5. Add the exact `bindCapability` entries below to `apps/api/src/capabilities.ts`.
6. Compose `OwnerRegisterHandlers` from `./owner-register` at the existing Worker HttpApi boundary.
7. Lazy-import named `OwnerRegisterPanel` in the scoped accounting workspace and pass existing book/locale.
8. No direct runtime table access or new DB client is required. Existing Drizzle Effect query and Better Auth
   boundaries are reused. New maintenance schema mappings, if needed, are root-owned, not required by routes.
9. Closing integration is not automatic: consume private
   `openerp.owner_period_status(book_id,starts_on,ends_on)` **under the existing closing book lock**.
   Bind its `sourceDigest` into the frozen inventory and recheck it during close. Nonzero
   `unresolvedReviewCount` or `unlinkedRecordCount` requires explicit closing work; unpaid linked claims
   alone are not technical errors. Its `coverage: not_established` never satisfies statutory completeness.
   No existing0800 function is replaced here. Root/year-end owner must choose the next forward hook migration.

### Database dispatch entries

```ts
 ownersCreateOwner: (parameters) => sql`select openerp.owners_create_owner(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
 ownersGetOwner: (parameters) => sql`select openerp.owners_get_owner(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersListOwners: (parameters) => sql`select openerp.owners_list_owners(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersCreateRecord: (parameters) => sql`select openerp.owners_create_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
 ownersReviseRecord: (parameters) => sql`select openerp.owners_revise_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersGetRecord: (parameters) => sql`select openerp.owners_get_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersListRecords: (parameters) => sql`select openerp.owners_list_records(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersRecordHistory: (parameters) => sql`select openerp.owners_record_history(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text) as result`,
 ownersReviewRecord: (parameters) => sql`select openerp.owners_review_record(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersAttachProposal: (parameters) => sql`select openerp.owners_attach_proposal(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersAttachPostedLine: (parameters) => sql`select openerp.owners_attach_posted_line(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersPrepareAllocation: (parameters) => sql`select openerp.owners_prepare_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
 ownersGetAllocation: (parameters) => sql`select openerp.owners_get_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersApproveAllocation: (parameters) => sql`select openerp.owners_approve_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersApplyAllocation: (parameters) => sql`select openerp.owners_apply_allocation(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::text,${parameters[4]}::jsonb) as result`,
 ownersPrepareControl: (parameters) => sql`select openerp.owners_prepare_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text,${parameters[3]}::jsonb) as result`,
 ownersGetControl: (parameters) => sql`select openerp.owners_get_control(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
 ownersRecoverCommand: (parameters) => sql`select openerp.owners_recover_command(${parameters[0]}::text,${parameters[1]}::jsonb,${parameters[2]}::text) as result`,
```

### Capability bindings

```ts
 owners_create_owner: bindCapability(Capabilities.owners_create_owner, "ownersCreateOwner", (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]),
 owners_get_owner: bindCapability(Capabilities.owners_get_owner, "ownersGetOwner", (input) => [scopeParameter(input.scope), input.id]),
 owners_list_owners: bindCapability(Capabilities.owners_list_owners, "ownersListOwners", (input) => [scopeParameter(input.scope), input.after ?? ""]),
 owners_create_record: bindCapability(Capabilities.owners_create_record, "ownersCreateRecord", (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]),
 owners_revise_record: bindCapability(Capabilities.owners_revise_record, "ownersReviseRecord", (input) => [scopeParameter(input.scope), input.id, input.idempotencyKey, JSON.stringify(input.input)]),
 owners_get_record: bindCapability(Capabilities.owners_get_record, "ownersGetRecord", (input) => [scopeParameter(input.scope), input.id]),
 owners_list_records: bindCapability(Capabilities.owners_list_records, "ownersListRecords", (input) => [scopeParameter(input.scope), input.after ?? ""]),
 owners_record_history: bindCapability(Capabilities.owners_record_history, "ownersRecordHistory", (input) => [scopeParameter(input.scope), input.id, input.after ?? ""]),
 owners_attach_proposal: bindCapability(Capabilities.owners_attach_proposal, "ownersAttachProposal", (input) => [scopeParameter(input.scope), input.id, input.idempotencyKey, JSON.stringify(input.input)]),
 owners_attach_posted_line: bindCapability(Capabilities.owners_attach_posted_line, "ownersAttachPostedLine", (input) => [scopeParameter(input.scope), input.id, input.idempotencyKey, JSON.stringify(input.input)]),
 owners_prepare_allocation: bindCapability(Capabilities.owners_prepare_allocation, "ownersPrepareAllocation", (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]),
 owners_get_allocation: bindCapability(Capabilities.owners_get_allocation, "ownersGetAllocation", (input) => [scopeParameter(input.scope), input.id]),
 owners_apply_allocation: bindCapability(Capabilities.owners_apply_allocation, "ownersApplyAllocation", (input) => [scopeParameter(input.scope), input.id, input.idempotencyKey, JSON.stringify(input.input)]),
 owners_prepare_control: bindCapability(Capabilities.owners_prepare_control, "ownersPrepareControl", (input) => [scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)]),
 owners_get_control: bindCapability(Capabilities.owners_get_control, "ownersGetControl", (input) => [scopeParameter(input.scope), input.id]),
 owners_recover_command: bindCapability(Capabilities.owners_recover_command, "ownersRecoverCommand", (input) => [scopeParameter(input.scope), input.key]),
```

### Public operation map

| SQL / capability                                 | REST operation            | Method / suffix                        | Input               | Output               |
| ------------------------------------------------ | ------------------------- | -------------------------------------- | ------------------- | -------------------- |
| `owners_create_owner`                            | `ownersCreateOwner`       | `POST /owners`                         | `CreateOwner`       | `Owner`              |
| `owners_get_owner`                               | `ownersGetOwner`          | `GET /owners/:id`                      | `scope/query`       | `Owner`              |
| `owners_list_owners`                             | `ownersListOwners`        | `GET /owners`                          | `scope/query`       | `OwnerPage`          |
| `owners_create_record`                           | `ownersCreateRecord`      | `POST /records`                        | `CreateRecord`      | `RecordView`         |
| `owners_revise_record`                           | `ownersReviseRecord`      | `POST /records/:id/revisions`          | `ReviseRecord`      | `RecordView`         |
| `owners_get_record`                              | `ownersGetRecord`         | `GET /records/:id`                     | `scope/query`       | `RecordView`         |
| `owners_list_records`                            | `ownersListRecords`       | `GET /records`                         | `scope/query`       | `RecordPage`         |
| `owners_record_history`                          | `ownersRecordHistory`     | `GET /records/:id/revisions`           | `scope/query`       | `RecordHistory`      |
| `owners_review_record` (operator REST only)      | `ownersReviewRecord`      | `POST /records/:id/reviews`            | `ReviewRecord`      | `Review`             |
| `owners_attach_proposal`                         | `ownersAttachProposal`    | `POST /records/:id/proposals`          | `AttachProposal`    | `ProposalLink`       |
| `owners_attach_posted_line`                      | `ownersAttachPostedLine`  | `POST /records/:id/posted-lines`       | `AttachPostedLine`  | `PostedEffect`       |
| `owners_prepare_allocation`                      | `ownersPrepareAllocation` | `POST /allocation-plans`               | `PrepareAllocation` | `AllocationPlan`     |
| `owners_get_allocation`                          | `ownersGetAllocation`     | `GET /allocation-plans/:id`            | `scope/query`       | `AllocationView`     |
| `owners_approve_allocation` (operator REST only) | `ownersApproveAllocation` | `POST /allocation-plans/:id/approvals` | `ApproveAllocation` | `AllocationApproval` |
| `owners_apply_allocation`                        | `ownersApplyAllocation`   | `POST /allocation-plans/:id/apply`     | `ApplyAllocation`   | `AllocationReceipt`  |
| `owners_prepare_control`                         | `ownersPrepareControl`    | `POST /controls`                       | `PrepareControl`    | `Control`            |
| `owners_get_control`                             | `ownersGetControl`        | `GET /controls/:id`                    | `scope/query`       | `ControlView`        |
| `owners_recover_command`                         | `ownersRecoverCommand`    | `GET /commands/:key`                   | `scope/query`       | `CommandRecovery`    |

Base route: `/v1/entities/:entityId/books/:bookId/owner-register`; browser adds `/api`.
All writes require `Idempotency-Key`; identified command receipts bind `{id,input}`.
Reads validate scope/admission. Runtime grants expose only the18 public functions, never private tables/helpers.

## Validation and next action

Only bounded owned-file format/lint and source review are permitted here. Their final observed results
will be recorded below. They are not proof of PostgreSQL validity, admission locking, concurrency,
financial correctness, REST/MCP parity, browser recovery, deployment or profile authority.

Root next: inspect this migration and the prewritten acceptance cases; integrate shared surfaces; run
serialized native type/runtime/browser/failure validation under actual authority. Preserve explicit gaps.

### Final source-review notes

- Same-actor receipt recovery is implemented for all10 owner commands, including the2 operator-only REST
  commands. Recovery is a historical read, not a new approval or execution authority.
- After an attached proposal actually posts, later reviewer departure/account revision does not prevent
  capturing that exact historical reviewed posted link. New proposal/posting authority still requires
  current review membership/configuration. Classification remains immutable after that posting.
- Control snapshots include currency/scale, per-owner open expense/loan claims, unapplied reimbursement/
  repayment and separately classified contribution amounts. Whole-account registered identity digests
  prevent equal-and-opposite new registrations from appearing unchanged. Mixed-unit controls fail closed.
- Review forms retain their original revision/digest until explicit **Start a new command**. Background
  reads cannot silently approve a newer classification. Exact captured retries remain available.
- Root reported an Effect4 `isBetween` options-shape error during its draft contract-only check. The
  source now uses `{ minimum: 0, maximum: 6 }`. No independent typecheck or rerun is claimed here.
- Bounded Oxlint previously passed with zero warnings/errors. Final artifacts record the exact final
  formatting/lint observation and source hashes; neither check executes SQL or verifies financial flows.

### Final bounded check result

The final owned-file Oxfmt run passed on the contract, Effect adapter, UI and this document.
The final owned-file Oxlint run passed on the3 TypeScript files with **0 warnings and0 errors**.
No SQL parser/database execution, full typecheck, build or browser check was run by this owner.
`owner-register-static.json` under `.agents/work/` records source hashes and the observed commands.

The bridge supports only single-action ordinary `manual_journal` adjustment plans. Recurring, tax,
split-control and correction bundles are not attached through this foundation. Future treatment
activation must explicitly reconcile this boundary; it must not bypass the owner source guard.
