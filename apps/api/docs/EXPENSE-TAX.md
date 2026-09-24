# Expense tax review — integration handoff

For forward4500 permanent source withdrawal, v2 expense exclusions and the dependent VAT v3
closure, see [EXPENSE-TAX-WITHDRAWALS.md](EXPENSE-TAX-WITHDRAWALS.md). Historical snapshots
and the0710 migration remain unchanged.

## Status and scope

Implementation-ready source, not runtime-verified. Risks and acceptance cases were recorded before the transitions were written in [EXPENSE-TAX-RISKS.md](EXPENSE-TAX-RISKS.md). This package adds no tests, fixtures, dependencies, servers, database mutations or Git operations. Migration0710 has not been applied by this owner. Existing migrations, asset schedules, invoice and ledger authority remain unchanged.

The first-year company context is reported, not legally verified. No company type, VAT registration/method, fiscal interval, opening balance, liability, funding classification or source completeness is inferred. The company/accountant must supply those facts. A reviewer role is not proof of professional qualification or legal acceptance.

## Implemented flow

```text
retained kernel evidence
  -> immutable source observation revisions (actual or explicitly synthetic)
  -> separate operator fact reviews pinned to source digest
  -> immutable accountant review snapshot
       -> exact source/reviewer controls + every exclusion
       -> only eligible synthetic facts: explicit rational calculation/contribution
```

No endpoint prepares or executes a ledger proposal, issues an invoice, activates a tax profile, maps VAT return boxes, approves a filing or submits data. Optional existing kernel proposal/voucher references must be scoped and cite the source evidence. They are context links, not a claim that this source is reconciled to a ledger control account.

### Records and rules

- Stable `(book_id, source_key)` identifies one declared expense component. Recording an existing key requires the expected current source digest and appends a source revision. Actual/synthetic class is fixed for the component. Evidence hash, source locator, gross/net/VAT, currency/scale, jurisdictions, source dates and optional kernel references are immutable. Source text stays in the kernel evidence store.
- Source facts support unknown/null monetary, date, jurisdiction, currency and reference fields. Known amounts must be canonical nonnegative integer strings below `10^38`; negative/credit-note and higher-precision inputs remain outside this bounded structured profile, while their original evidence can still be retained. No unknown amount is normalized to zero.
- A review requires a current operator, retained evidence, the current source digest and expected prior review digest. It stores separate reviewed amounts, registration/method opinions with evidence, supply/tax dates and basis, jurisdiction, treatment/profile/version, explicit rate and deduction fractions, and rounding choice. Actor/time come from the backend. Evidence existence/scope/hash is checked; its factual truth and legal sufficiency are not certified.
- Reviews do not overwrite observations. A new source revision makes the old review stale; old source/reviewer histories remain readable. A new review does not mutate an existing snapshot. The existing book/admission lock protocol serializes source, review and snapshot mutations with receipts.
- Inventory is bounded at 200 declared source components, 20 source revisions and 100 review revisions per component. Reads fail rather than silently truncate a larger source inventory. The inventory read is one shared-book-lock observation, with a basis digest and observation time. Snapshot lists use a book/scope-bound high-water ordinal cursor, 25 items per page; follow `next` to null.

### Exact controls and synthetic arithmetic

`expense-tax-controls-v1` reports source `gross - net - VAT`, reviewed `gross - net - VAT`, and reviewed-minus-source gross/net/VAT differences. Known disagreements are retained and excluded, not normalized away. All arithmetic runs once in PostgreSQL numeric; browser inputs/outputs retain integer strings.

Only snapshot mode `synthetic_demonstration`, record class `synthetic`, book profile `synthetic-core-v1`, and reviewer profile `synthetic-expense-tax` version `1` can calculate a contribution. All treatment, registration/method evidence, currency, jurisdiction, source/reviewer date and deduction prerequisites still apply. This is not a Swedish tax rule. No percentage or deduction fraction is supplied by the implementation.

The caller supplies `rateNumerator/rateDenominator` and `deductionNumerator/deductionDenominator`. Denominators are positive. Deduction must be between zero and one, inclusive. The only implemented policy is `exact_only`:

1. Multiply reviewed net by the rate numerator. Preserve that integer numerator and denominator.
2. A nonzero division remainder blocks tax calculation; nothing is rounded or truncated into a contribution.
3. For an exact result, preserve calculated VAT separately and expose reviewed VAT minus calculated VAT.
4. Apply the explicit deduction fraction with the same exact-remainder refusal.
5. Require deductible plus nondeductible to equal calculated VAT, and expense plus deductible to equal reviewed gross exactly.

Actual-company mode never emits a supported contribution. Its immutable snapshots remain useful for accountant review of original facts, reviewer opinions, discrepancies and missing/unsupported items. Zero synthetic totals are not actual-company VAT values. Foreign currency/supplies, reverse charge/imports, cash method, missing/unsupported registration/deduction facts, incompatible dates, unapproved profiles and unsupported rounding all exclude the affected record.

### Snapshot meaning and recovery

A snapshot includes every retained current source component, including wrong-mode, outside-interval, missing-review and unsupported rows. No date/classification filter silently drops an expense. It pins full source/reviewer bodies and hashes, exclusion/control/calculation results, exact synthetic totals, book profile/version, currency/scale, book sequence and source/reviewer basis digest. `schemaVersion` is `1`; `calculationEngine` is `expense-tax-controls-v1`.

`coverageEstablished`, `ledgerReconciled`, `vatReturnReady`, `productionProfileApproved` and `postingEnabled` are always false. An empty inventory or zero included rows cannot be treated as a zero return or complete company book.

`get_expense_tax_snapshot` returns the stored snapshot plus `basisCurrent`. The basis binds current source/reviewer digests and book currency/scale/profile/version. It deliberately does not claim live ledger freshness; ordinary postings/reversals do not change these source observations, and ledger reconciliation is not implemented. `bookSequence` is a captured context value, not a substitute for ledger controls.

The same command key and actor/payload recovers the exact original result. Changed content/actor/operation/target conflicts. The UI retains uncertain command keys while mounted; after a confirmed snapshot result, a new explicit freeze click can request a new capture. Reload recovery uses the durable source inventory and snapshot list. Browser memory is not claimed as durable command storage.

## Exact root integration map

### Owned paths

- `packages/contracts/src/expense-tax.ts`
- `apps/api/src/expense-tax.ts`
- `apps/api/migrations/0710-expense-tax-facts.sql`
- `apps/api/docs/EXPENSE-TAX.md`
- `apps/api/docs/EXPENSE-TAX-RISKS.md`
- `apps/web/src/components/expense-tax/{panel.tsx,forms.tsx,views.tsx,copy.ts,blockers.ts}`
- Maintained implementation-boundary note in `docs/plans/05-vat-payroll-assets-fx.md`.

### Shared composition changes (root-owned, not edited here)

1. Export `"./expense-tax": "./src/expense-tax.ts"` from the contract package.
2. Add `ExpenseTaxApi` to shared `Api`. Add `ExpenseTaxHandlers` to HTTP composition. Group name is `expenseTax`.
3. Spread `ExpenseTaxCapabilities` into the shared capability catalog and bind the six ordinary entries below. **Do not add `reviewExpenseTaxSource` to ordinary MCP capabilities.** It is a direct REST/operator-only query, like existing approval/review authority actions.
4. Add fixed parameterized Drizzle `sql` statements to `apps/api/src/database.ts`. Reuse its Effect query/connection lifecycle. No raw driver or alternate connection is introduced. The new module only calls SQL entrypoints; it does not need direct-table query mappings or table grants. Root may add maintenance mappings separately if an actual maintenance caller needs them.
5. Lazy-mount `ExpenseTaxPanel` from `components/expense-tax/panel.tsx` with `{book, locale, onPrepared}` in the scoped workspace. `onPrepared` only opens an already referenced kernel proposal; this module creates none. Section ID is `expense-tax`. Shared workspace/identity changes must remount scoped local drafts and preserve existing query-cache isolation.

| REST operation / database key | Ordinary capability            | SQL function                           | Parameters after authenticated token                                                 |
| ----------------------------- | ------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------ |
| `recordExpenseTaxSource`      | `expense_tax_record_source`    | `openerp.record_expense_tax_source`    | `scopeParameter(input.scope)`, `input.idempotencyKey`, `JSON.stringify(input.input)` |
| `expenseTaxInventory`         | `expense_tax_inventory`        | `openerp.expense_tax_inventory`        | `scopeParameter(input.scope)`                                                        |
| `getExpenseTaxSource`         | `expense_tax_get_source`       | `openerp.get_expense_tax_source`       | `scopeParameter(input.scope)`, `input.sourceId`                                      |
| `reviewExpenseTaxSource`      | **None: operator REST only**   | `openerp.review_expense_tax_source`    | serialized scope, source ID, key, serialized input; already assembled by handler     |
| `prepareExpenseTaxSnapshot`   | `expense_tax_prepare_snapshot` | `openerp.prepare_expense_tax_snapshot` | `scopeParameter(input.scope)`, `input.idempotencyKey`, `JSON.stringify(input.input)` |
| `getExpenseTaxSnapshot`       | `expense_tax_get_snapshot`     | `openerp.get_expense_tax_snapshot`     | `scopeParameter(input.scope)`, `input.snapshotId`                                    |
| `listExpenseTaxSnapshots`     | `expense_tax_list_snapshots`   | `openerp.list_expense_tax_snapshots`   | `scopeParameter(input.scope)`, `input.after ?? ""`                                   |

Every statement returns `as result`. Cast token/key/ID/cursor parameters to `text` and scope/input to `jsonb` using Drizzle SQL interpolation, as current database dispatch does. Outputs are the corresponding `TaxSourceRevision`, `TaxInventory`, `TaxSourceView`, `TaxReview`, `TaxSnapshot`, `TaxSnapshotView`, `TaxSnapshotPage` schemas.

HTTP base: `/api/v1/entities/:entityId/books/:bookId/expense-tax`. Paths are POST/GET `/sources`, GET `/sources/:id`, POST `/sources/:id/reviews`, POST/GET `/snapshots`, GET `/snapshots/:id`. Exact contracts are in the new API group.

### Migration and ownership dependencies

0710 is forward-only and independent of new sibling migrations. It uses existing kernel books/evidence/change sets/vouchers, `authorize`, `replay`, `save_command`, `digest`, `new_id`, `immutable_row`, and `bank_date` from0100. It preserves0210 admission lock semantics and current0900 browser-auth admission through the existing `authorize` function. It does not replace any existing function or migration. All new tables and helpers explicitly revoke PUBLIC/runtime access; only scoped public entrypoints receive runtime EXECUTE.

Public mutators authorize before the exclusive book barrier. Reads authorize before a shared book barrier. Nested evidence existence checks and immutable records do not introduce another mutable accounting lock owner. Operator reviews use `authorize(token, scope, true)`. No ledger, invoice, period or schedule table is written.

### Future company setup / closing interface

Private `openerp.expense_tax_dependencies(book text) RETURNS jsonb` is for a future owning SECURITY DEFINER function **while it holds the book lock**. It has no runtime grant. Result:

- `basisDigest`: current source/reviewer plus book profile/version/currency basis.
- `sourceCount`: retained declared components, not an expected inventory.
- `missingOrStaleReviewCount`: sources without a review for the current source digest.
- `coverageEstablished:false`, `productionProfileApproved:false`, `vatReturnReady:false`, `postingEnabled:false`.

Zero missing reviews is not supported treatment, adequate registration evidence, correct deduction, source completeness or VAT readiness. Company setup must own actual registrations/methods and their effective intervals; this package's per-expense reviewer opinions must not overwrite company authority. Closing can pin this dependency or a selected current snapshot, but must keep its legal/coverage/ledger blockers. Future supported actual profiles need dated primary evidence, legal intervals, aggregation/rounding policy, applicability facts and separate qualified activation. No such release is supplied here.

## Validation and next root action

Owned TypeScript/TSX source passed bounded Oxlint with zero warnings/errors after local fixes; owned formatting is checked again at handoff. Source review checked scope/reference constraints, parameter binding, immutable revision linkage, exact arithmetic, source/mode exclusion, helper grants and cursor bounds. These observations are not database execution, browser interaction, concurrency/recovery proof, legal verification, deployment or external acknowledgement.

Root next: integrate shared exports/API/catalog/Drizzle dispatch/workspace, serialize full native types/lint/format checks, review and apply0710 only under root's existing local authority, and observe the real authorized review flow if permitted. Do not activate real-company tax processing from synthetic arithmetic. The downloadable JSON is the immutable server snapshot, not a filing artifact or an assertion of completeness.
