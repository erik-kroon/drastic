# Reviewed commerce unallocation

## Failure cases recorded before implementation

- Cross-book targets, missing receipts, malformed amounts, partial legs, absent evidence or blank reasons must fail without effects.
- Automation cannot approve or revoke. An expired, revoked or no-longer-authorized human approval cannot execute.
- Changed invoice revisions, capacity history, profile/writer epoch, account or period versions invalidate a sealed plan.
- Closed payment or invoice recognition periods refuse preparation and execution. No implicit reopen occurs.
- Concurrent or repeated reversals cannot release capacity twice. Same-key replay returns the original result after authorization and the book lock, before freshness checks.
- Original receipts, allocation legs, invoices, vouchers and retained snapshots remain immutable.
- Count-based capacity versions must not return to old values after an allocate/unallocate cycle.
- New allocations, owner capacity, correction guards, register reports and closing status must use effective active allocations, not historical gross totals.
- Deferred allocation assertions must retain original plan/receipt equality while testing active capacity conservation.
- Report and closing dependencies must change when unallocation changes effective relationships without a journal posting. Historical artifacts remain inspectable, not relabeled as current.
- Truncated discovery or oversized reviews must never imply a complete inventory or silently drop legs.
- Unallocation must not post a ledger reversal, correct recognition, issue a credit, refund money, initiate payment or change bank matching.

## Browser recovery failure cases recorded before repair

- A refresh that finds the receipt already released must not unmount a captured preparation request.
- A newer usable approval, approval expiry/revocation, or an operator role change must not replace captured approval/execute/revoke requests.
- A successful execution view must not discard request keys for other retained approval rows; an uncertain response still needs its exact retry/artifact.
- Query refresh errors must retain the last displayed command instances while blocking new commands. Paused/refetching queries must not admit new commands from cached readiness.
- New approval/revocation remains operator-only. Approved execution remains available to authorized automation; this UI repair must not change backend authority or API semantics.

The source repair keeps preparation/approval forms mounted and renders execute/revoke forms under stable retained approval IDs. New execution requires the server-selected usable approval and current successful idle-query readiness. Query errors retain cached views but disable new commands; captured retries and downloads remain available through `CommandForm`. Release or role changes disable new writes without discarding captured request state. This is source-reviewed behavior, not browser/runtime proof.

## Status

Source implementation is complete in the owned files below. Shared registration/mounting remains root-owned. Runtime behavior remains unverified. No tests, validation commands, database execution, migration application, build, server or browser verification is authorized or performed.

## Source behavior

Migration `1700-commerce-allocation-reversals.sql` adds immutable review, approval, revocation and execution records. It never updates/deletes0600 application receipts or legs, invoices, source evidence, vouchers or prior reports. A unique `(book_id, receipt_id)` execution boundary releases the entire original receipt once. Partial leg selection is not supported.

`commerce_active_allocation_legs` is private. A row remains active exactly when its original receipt has no reversal receipt. Invoice allocation versions and payment capacity versions count original legs plus released original legs. This prevents an allocate/unallocate cycle from restoring an earlier capacity version. No mutable balance counter or parallel ledger is added.

Preparation captures the original plan/receipt, all1–50 legs, current invoice revisions and before/after exact capacities, original and revision evidence references, account version, profile version, writer epoch and both recognition/payment period versions. All affected source periods must be open and the control account active. The plan is limited to256 KiB,50 reviews per target and50 approvals per review. No partial review or partial history is returned.

Approval/revocation use `authorize(...,true)` and are REST-only. Approval expires after one hour. Execution checks expiry, revocation, exact plan digest and current approving operator membership. As with the existing allocation workflow, execution can be delegated to an authorized automation actor after human approval; it does not require the executor to be the approver. All mutations authorize, lock the book and replay the exact actor/operation/key/input before freshness checks. New-key execution recovery can return the already committed same-plan/same-approval receipt without releasing capacity again. Competing plans for one target cannot both execute.

A deferred integrity trigger binds the released target and exact legs/total to the sealed plan and approval. Execution writes only the reversal record and command receipt in the same transaction. `ledgerChanged:false` and `paymentInitiated:false` are explicit receipt facts.

### Freshness and historical reads

- Existing plan checks inherit monotonic invoice/payment versions through `commerce_allocation_selection` → capacity helpers. Old plans/signoffs become stale after a release.
- `commerce_period_status` uses active legs and adds relevant immutable reversal history to its digest. Existing1510 closing/inventory consumers inherit this change without rewriting closing functions. The previous digest shape is preserved when no relevant release exists. Technical checks still say `coverage:not_established`.
- New register reports capture active allocations and their before/after balances. A private immutable `commerce_register_allocation_dependencies` row retains an allocation-history version without changing the report body shape or digest.
- `get_commerce_register_allocation_status` compares that version and exact effective receipt/ordinal/amount sets. Reports made before1700 are stale after any relevant unallocation. This is only an allocation-currentness claim; it explicitly does not certify ledger, account, metadata or completeness dependencies.
- `commerce_get_allocation` retains its historical application receipt. Do not interpret that receipt as proof the allocation remains active. Use the new `get_commerce_allocation_status` overlay, which returns the original receipt, active flag, immutable reversal and every target review. The UI exports this overlay for existing allocation review screens.
- Global review discovery uses live25-item identifier pages, not a frozen complete inventory. Target history is complete within the50-review admission bound.

## Allocation-capacity consumer inventory

The forward migration replaces these latest definitions, not historical files:

| Consumer | Prior owner | Change |
| --- | --- | --- |
| `commerce_invoice_body` |0600 | Active allocated/outstanding amounts, blockers only for active payment references, monotonic insertion+release version. |
| `commerce_payment_body` |0600 | Active consumed/residual amounts and monotonic version. |
| `commerce_create_invoice` |0600 | Active payment-line ownership conflict. Original invoice identity and exact recognition guards remain. |
| `commerce_assert_allocation` |0600 | Preserve original receipt/plan/leg equality; use active legs for current capacity conservation and voucher-reference checks. |
| `commerce_guard_voucher_reversal` |0600 | Active payment allocations block correction. Registered recognition remains blocked. |
| `commerce_period_status` |0600 | Active validity/conservation and reversal-bound closing digest. |
| `owner_guard_capacity` |1300 | Active commerce ownership. Both1300 `bank_active_matches` and `bank_active_allocation_legs` branches stay unchanged. |
| `correction_impact_resources` |1300 | Active payment allocations block correction with unallocation guidance. Bank and owner impact branches stay unchanged. |
| `create_register_report` |0920 | Active allocation count/materialization/conservation, plus private captured history version. Prior report bytes stay unchanged. |

Intentional original-history consumers remain unchanged:

- `commerce_apply_allocation`: inserts original immutable application/legs; no reapply of an old executed plan.
- `commerce_check_allocation`: dispatches deferred assertions for original table inserts.
- `commerce_allocation_current`, prepare/approve/apply/get plan, invoice/payment reads and invoice revision reads: inherit effective capacities from the replacement helpers; original plan/application receipts stay historical.
- `get_register_report` and `list_register_reports`: return retained report bytes, not recomputed reports. Freshness is a separate read.
-1400 invoice-issue draft/evidence/aggregate ownership guards are untouched.
-1510 `closing_basis` and `closing_inventory_basis` are untouched; their upstream commerce provider changes only.
-1600 bank candidates and1800 subledger guards have no direct commerce-allocation-leg consumers in the inspected source.

No active-applied view was needed. Unique original receipt identity plus the private active-leg projection is sufficient.

## Files

- `apps/api/migrations/1700-commerce-allocation-reversals.sql`
- `packages/contracts/src/commerce-allocation-reversals.ts`
- `apps/api/src/db/statements/commerce-allocation-reversals.ts`
- `apps/api/src/transport/http/routes/commerce-allocation-reversals.ts`
- `apps/web/src/components/commerce/allocation-reversals.tsx`
- `apps/web/src/components/commerce/allocation-reversal-copy.ts`
- This handoff and the maintained `COMMERCE.md` domain notes.

## Root-owned integration

1. Export `"./commerce-allocation-reversals": "./src/commerce-allocation-reversals.ts"` from the contracts package.
2. Add `CommerceAllocationReversalsApi` to shared `Api` and `CommerceAllocationReversalCapabilities` to the capability catalog.
3. Spread `commerceAllocationReversalStatements` into fixed SQL dispatch and compose `CommerceAllocationReversalHandlers` into the owning HTTP layer. Local routes already call typed fixed queries; only approval/revocation lack MCP entries.
4. Bind these capabilities (arguments exclude leading authenticated token):

| Capability | Statement | Parameters |
| --- | --- | --- |
| `commerce_prepare_allocation_reversal` | `prepareCommerceAllocationReversal` | `scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input)` |
| `commerce_get_allocation_reversal` | `getCommerceAllocationReversal` | `scopeParameter(input.scope), input.id` |
| `commerce_list_allocation_reversals` | `listCommerceAllocationReversals` | `scopeParameter(input.scope), input.after ?? ""` |
| `commerce_get_allocation_status` | `getCommerceAllocationStatus` | `scopeParameter(input.scope), input.id` |
| `commerce_get_register_allocation_status` | `getCommerceRegisterAllocationStatus` | `scopeParameter(input.scope), input.id` |
| `commerce_execute_allocation_reversal` | `executeCommerceAllocationReversal` | `scopeParameter(input.scope), input.idempotencyKey, input.id, JSON.stringify(input.input)` |

5. If maintained typed table mappings are required, add the five private tables from1700 to root-owned `db/schema.ts`; runtime receives function execution only and no table/view grants.
6. Mount `CommerceAllocationReversals({book,locale,receiptId?})` under the existing commerce/payments area. Optional `receiptId` selects a historical allocation receipt, not a plan.
7. Mount `AllocationReleaseStatus({book,locale,id,onOpen?})` beside any existing applied allocation receipt; `id` is `application.id`. `onOpen` can route to the dedicated unallocation workspace. Without `onOpen`, the overlay is read-only.
8. Mount `CommerceRegisterAllocationStatus({book,locale,id})` beside retained register reports; `id` is a register report identity. Keep its narrow claim distinct from full report currentness.

All UI exports above are in `apps/web/src/components/commerce/allocation-reversals.tsx`. `CommerceAllocationReversalReview({book,locale,id})` can also mount a directly selected review. Components use existing StyleX UI primitives, contract-validated TanStack Query reads, exact string amounts and bilingual copy. Review/receipt JSON downloads and shared immutable request/retry artifacts are available. Financial execution invalidates the whole book query prefix so register/closing readers cannot keep a success cache merely because the ledger sequence did not change.

### REST routes

Prefix: `/api/v1/entities/:entityId/books/:bookId/commerce`. Mutations require `Idempotency-Key`.

| Method | Suffix | Input/output |
| --- | --- | --- |
| POST | `/allocation-reversal-plans` | `PrepareCommerceAllocationReversal` → `CommerceAllocationReversalPlan` |
| GET | `/allocation-reversal-plans?after=...` | `CommerceAllocationReversalList` |
| GET | `/allocation-reversal-plans/:id` | `CommerceAllocationReversalView` |
| POST | `/allocation-reversal-plans/:id/approve` | `ApproveCommerceAllocationReversal` → `CommerceAllocationReversalApproval` |
| POST | `/allocation-reversal-plans/:id/execute` | `ExecuteCommerceAllocationReversal` → `CommerceAllocationReversalExecution` |
| POST | `/allocation-reversal-approvals/:id/revoke` | `RevokeCommerceAllocationReversalApproval` → `CommerceAllocationReversalRevocation` |
| GET | `/allocation-receipts/:id/status` | `CommerceAllocationStatus` |
| GET | `/register-reports/:id/allocation-status` | `CommerceRegisterAllocationStatus` |

## Verification boundary

Only source inspection and edits were performed. No tests/test edits/fixtures, validation commands, type checks, builds, toolchain changes, migrations applied, database calls, servers, browser checks, external actions, commits or child delegation were performed. This handoff is not evidence that1700 executes successfully or that its UI has passed runtime/accessibility verification. No real-company profile or legal treatment is activated.

## Root source integration

Shared contracts exports, API/capability catalogs, bindings, SQL dispatch and HTTP handlers are connected. Accounts → Payment allocation and the commerce tools workspace mount unallocation. Historical applied receipts mount AllocationReleaseStatus, and saved reports mount the separate allocation-only freshness overlay. Independent source review found no concrete blocker; root compared owner/correction replacements and confirmed1300 active-bank branches remain unchanged. No validation or runtime acceptance is claimed.
