# Pre-close corporate income-tax bridge and INK2/SRU — NEXT-22

## Current ownership

| Responsibility | Owner |
|---|---|
| Named Effect operations | [application/tax/corporate.ts](../src/application/tax/corporate.ts) |
| Pure calculation, INK2 field mapping, SRU writer and re-parse | [application/tax/corporate-basis.ts](../src/application/tax/corporate-basis.ts) |
| Tx-passing reads and DML | [db/tax/corporate.ts](../src/db/tax/corporate.ts) |
| Shared contracts, capabilities and HTTP group | [contracts/corporate-tax.ts](../../../packages/contracts/src/corporate-tax.ts), [capabilities/corporate-tax.ts](../src/application/capabilities/corporate-tax.ts), [routes/corporate-tax.ts](../src/transport/http/routes/corporate-tax.ts) |
| Typed tables, constraints and grants | [migrations/0013-next-22.sql](../../migrations/0013-next-22.sql), [db/schema.ts](../src/db/schema.ts) |
| Company admission family | [company-profile-basis.ts](../src/application/company-profile-basis.ts), `corporate_tax` family on the `taxPeriodOn` selector date |

## Three deliverables, three records, three transactions

| Deliverable | Capability | Financial effect |
|---|---|---|
| Sealed pre-close bridge | `tax_prepare_bridge` | none — posts nothing, adopts no loss right |
| Approved current-tax effect | `tax_execute_effect` | **the only one** — posts the remaining delta |
| INK2/SRU declaration lineage | `tax_prepare_declaration` | none — a report artifact |

The bridge, the effect and the declaration never share a transaction or a table.

## The bridge excludes current income tax exactly once

The retained statement result already contains the current income-tax expense that is
booked inside the retained profit-and-loss contributions. The pre-tax figure adds that
booked effect back exactly once:

```text
pretaxProfit = retainedStatementResult + incomeTaxExpenseEffect
```

Posting a current-tax effect therefore cannot change the number the tax was calculated
from. `retainedStatementResult` is the snapshot's own retained untransferred fiscal-year
result line, not a reconstructed year-to-date profit: the statement snapshot does not
retain the transferred movement, and no amount is invented for it.

## Only the delta is posted

```text
alreadyRecognized = sum of this owner's effective current-tax effects for the year
delta             = sealedYearTarget - alreadyRecognized

delta != 0  ->  Dr current income-tax expense   delta
               Cr current income-tax liability  delta
delta == 0  ->  approved no-effect receipt, no voucher, no voucher number
```

Preliminary tax paid to a tax account is never subtracted from the target to make a return
agree; tax prepayments, assessed charges and the liability reconcile separately.

The expense and liability accounts are reviewed account-role bindings
(`corporate_tax_expense`, `corporate_tax_liability`, optionally
`corporate_tax_other_expense`) resolved through the company admission owner. They are never
named by a request payload and never inferred from an account number or label. The expense
role must be excluded exactly once, which `reviewAccounts` makes structural: one expense
account, one liability account, all distinct, and none also a mechanical result-transfer
role.

## The effect is validated, never self-approved

`tax_execute_effect` requires a **separate operator's** current approval of this bridge's
sealed plan digest, obtained through the shared `POST .../change-sets/:id/approvals`
endpoint. The operation validates that approval with the shared
`readExecutionApprovalInTransaction` and refuses when the approver is the executing
operator. It never creates an approval, so an agent credential cannot authorize its own
accrual.

Before posting, the whole basis is re-resolved inside the executing transaction. A changed
pre-tax population, statement digest, rule release, admission witness, role binding or
recognised total refuses (`StaleDependency`) instead of re-deriving a different amount
against the same approval.

## The form and the engine start from one result

`prepareIncomeTaxFields` derives the reviewed INK2 fields from the same sealed bridge and
requires the declared taxable basis to reconcile to `bridge.taxableIncome`. Which current-tax
figure the form adds back depends on where its declared accounting result came from:

| Declared result | Add-back source | Why |
|---|---|---|
| `projected_bridge_result` | `current_tax` | the projected after-tax result already has the calculated current tax deducted |
| `ledger_statement_result` | `income_tax_expense_addback` | the retained ledger result only has the tax actually booked inside the retained population deducted |

A missing required reconciliation source blocks the declaration. A blocked lineage renders
no file at all.

## The SRU files are rendered and then independently re-parsed

Both deliverables of the file-transfer contract are produced and retained: the info file and
the blanket-letter file, with the exact bytes, byte lengths and SHA-256 digests. Before
retention, `reparseSru` re-derives the record structure, every field value and the form's own
cross-field total from the retained text without consulting the renderer, and compares each
recovered value with the exact value its prepared field holds. The info file carries no field
values, so it gets the structural check only and reports zero compared totals rather than
claiming a comparison it did not make.

This is an internal re-parse of these exact bytes. It is **not** a destination acceptance, a
signature, a filing, or evidence that Skatteverket accepted anything.

## No reviewed value is a default

No rate, rounding policy, loss profile, journal series, form version, form identifier, field
code, record marker, header, separator, encoding, terminator, filename or size bound is a
literal in the code. All of them are reviewed data carried by a `corporate_tax` section
inside the one existing `openerp.rule_releases` record. A release that declares a different
`calculatorVersion` is refused rather than reinterpreted. A release without a qualified
`corporateTax` section, or without the role bindings the bridge needs, is an explicit
refusal.

## Honest external gates

These are **not** satisfied by this work and nothing here should be read as satisfying them:

- **The reviewed Swedish corporate-tax rule release must be loaded into
  `openerp.rule_releases` before any capability in this group can succeed.** No reviewed
  INK2 field map, SRU grammar, rate, rounding policy or journal series ships in this
  repository, and none was invented. Until the reviewed content process loads one row with a
  `corporate_tax` section, every bridge refuses with `UnsupportedProfile`. The packet marks
  the concrete field codes, headers and encodings as required reviewed data, not guessed
  literals.
- The selected profile is the ordinary limited company. **NE and the comprehensive
  special corporate-tax regimes are outside it** and are refused rather than approximated.
- Export is not filing. No transmission, no destination acceptance, no signature and no
  statutory compliance claim is made or established here.
- `declaredResultSource: ledger_statement_result` requires a retained statement snapshot whose
  own result the declaration adopts. The mapping decides which reconciling figures the form
  must carry.

## Deliberate deviation from the packet

The packet sketches `prepareCorporateDeclaration` persisting the semantic fields in a short
transaction and rendering the SRU files in an effect-mq Bun job outside it. This
implementation renders and re-parses **inside** the same transaction that persists the
fields.

Reason: the render is pure, bounded, in-memory work over at most 2000 mapped fields, with no
I/O, so it adds no meaningful lock duration. Rendering inline gives a stronger invariant —
the semantic fields and the exact verified bytes commit together, so a retained declaration
can never exist without its files. The alternative needs a *pending* state that the
migration deliberately does not have (`corporate_tax_declarations_blocked_check` requires
`blocked -> file_count = 0` and there is no third status), and it makes the field lineage and
the file lineage disagreeable. Adopting the packet's shape would need an outbox record, a
runner credential, `OPENERP_PREPARATION_TOKEN` and a delivery endpoint, per ADR 0009.

## Verification state

See [the programme verification limits](../../../docs/plans/next-packet-progress.md). In
short: the packet's synthetic 20% vector was evaluated in a throwaway `bun` process against
the exported pure functions and every obligation held — pre-tax 1000000, before loss
1030000, current tax 206000, projected after tax 794000, form total 794000 + 206000 + 30000 =
1030000, an existing 200000 effect leaving a 6000 delta rather than 206000 again, and a
negative taxable result producing zero current tax rather than a negative receivable. That
is **arithmetic evidence only**: no database, no transaction, no HTTP call, no Worker
invocation and no rendered file has been observed. It is not retained as a test.
