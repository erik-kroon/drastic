# Pre-close corporate income-tax bridge and INK2/SRU — NEXT-22

## Current ownership

| Responsibility                                                | Owner                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named Effect operations                                       | [application/tax/corporate.ts](../src/application/tax/corporate.ts)                                                                                                                                                                         |
| Pure calculation, INK2 field mapping, SRU writer and re-parse | [application/tax/corporate-basis.ts](../src/application/tax/corporate-basis.ts)                                                                                                                                                             |
| Tx-passing reads and DML                                      | [db/tax/corporate.ts](../src/db/tax/corporate.ts)                                                                                                                                                                                           |
| Shared contracts, capabilities and HTTP group                 | [contracts/corporate-tax.ts](../../../packages/contracts/src/corporate-tax.ts), [capabilities/corporate-tax.ts](../src/application/capabilities/corporate-tax.ts), [routes/corporate-tax.ts](../src/transport/http/routes/corporate-tax.ts) |
| Typed tables, constraints and grants                          | migrations/0013-next-22.sql, [db/schema.ts](../src/db/schema.ts)                                                                                                                                                                            |
| Company admission family                                      | [company-profile-basis.ts](../src/application/company-profile-basis.ts), `corporate_tax` family on the `taxPeriodOn` selector date                                                                                                          |

## Three deliverables, three records, three transactions

| Deliverable                  | Capability                | Financial effect                             |
| ---------------------------- | ------------------------- | -------------------------------------------- |
| Sealed pre-close bridge      | `tax_prepare_bridge`      | none — posts nothing, adopts no loss right   |
| Approved current-tax effect  | `tax_execute_effect`      | **the only one** — posts the remaining delta |
| INK2/SRU declaration lineage | `tax_prepare_declaration` | none — a report artifact                     |

The bridge, the effect and the declaration never share a transaction or a table.

## Currentness of the selected statement population

An immutable snapshot proves its bytes did not change. It cannot prove the population behind
them did not. A new or backdated non-tax posting after the snapshot leaves every retained byte
identical, so re-reading the snapshot and its digest detects nothing — and the shared posting
kernel will not catch it either, because a sealed plan records profile, writer epoch, period
and account dependencies, not a committed-sequence boundary.

So this owner asks the statement owner, using its own released read, at **capture and again at
execution**:

```text
reopenedAfterCapture                                   -> stale
postingsAfterCutoff - ownTaxPostingsAfterCutoff > 0    -> stale
```

`postingsAfterCutoff` is the statement owner's own count of vouchers committed after the
snapshot's `ledgerBoundary`; `reopenedAfterCapture` is a reopen transition on a period
covering the reported `asOf`, committed after the snapshot's `createdAt`. The global book
sequence is not compared, because it moves for reasons that cannot touch a closed year's
reported population.

### The exact conservative boundary

**Any** voucher committed after the snapshot's cutoff other than this owner's own
current-income-tax effects makes the snapshot stale, and a reopen of a period covering the
reported as-of date makes it stale even if the only later posting is this owner's.

That is deliberately stricter than strictly necessary. It refuses a bridge when a later
posting provably cannot touch the reported population. The trade is chosen on purpose: refusing
a proposal costs a fresh snapshot, while posting a current-tax accrual derived from a
population that has since moved is not recoverable by any later operation.

### Why the own-tax exclusion exists and what it counts

Recognising a tax effect is itself a voucher after the cutoff. Without an exclusion the first
effect would make every later bridge over the same snapshot refuse, which would make the owner
self-defeating.

Ownership is proved by a **committed `corporate_tax_effect` row**, never by an event-key
prefix. A key is a naming convention any posting path can choose, so a manual or generic
posting that merely _named itself_ like tax would otherwise escape the pre-tax guard. A voucher
is excluded only when all of these hold:

- a `corporate_tax_effect` row for this book **and the reported fiscal year** points at it;
- the effect is not the no-effect form, so it actually posted a journal;
- the voucher's own `change_set_id` equals that effect's `change_set_id`, tying the voucher to
  the tax effect's own sealed plan.

The statement owner's count and this subtraction use the identical cutoff, so their difference
is exactly the number of later postings that are not this owner's own committed tax effect. A
negative difference would mean the two reads disagree about the same boundary and is treated
as a defect, not as a stale population.

Scoping the exclusion to the reported fiscal year is deliberately narrow. It means a tax effect
belonging to a _later_ year still counts as a later posting and refuses this year's bridge,
which is over-conservative. Over-conservative is the correct direction here.

**Not executed.** An earlier revision of this exclusion used the event-key prefix and was
exercised against a real PostgreSQL 17. This revision has not: it was written after that probe
was ruled out, so its SQL is unverified by execution. Treat it as the one place in NEXT-22
where a query has not run against a database. The reopen half of the guard was executed in all
four cases (after capture and covering the as-of date fires; before capture, or a period ending
before the as-of date, does not).

## The bridge excludes current income tax exactly once

The retained statement result already contains the current income-tax expense that is
booked inside the retained profit-and-loss contributions. The pre-tax figure adds that
booked effect back exactly once:

```text
pretaxProfit = retainedStatementResult + incomeTaxExpenseEffect
```

Posting a current-tax effect therefore cannot change the number the tax was calculated
from.

`retainedStatementResult` is `balance.virtualUntransferredResultMinor`: the statement retains
its untransferred result line, not the transferred movement. It is reported under that name
rather than as a reconstructed year-to-date profit, and no amount is invented for the
transfer.

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

## A tax plan cannot be posted around its owner

`prepareBridge` seals an ordinary posting plan, so the bridge's change set is approvable
through the shared approval endpoint. Without an ownership projection, the _generic_
`changes_execute` could post that approved plan with no owner, write no
`corporate_tax_effects` row, and leave the year target unrecorded — after which
`tax_execute_effect` would still see an unrecognised target and recognise the same tax a
second time. A generic reversal of the resulting voucher would likewise bypass the tax
register entirely. Both now have source guards:

- `readOwnedSources` projects `corporate_tax_bridges` as a `corporate_income_tax` source
  keyed on the bridge's change set and exact retained event. The projection joins the
  sealed `change_sets.plan` and supplies the `postingPlan` shape the shared admission
  reader validates. Matching the event also guards a second plan over that same event.
  It carries no broad evidence-ID claim, so merely sharing supporting evidence does not
  claim another posting. Generic execution has no owner and refuses with
  `ApprovalRequired`; the tax owner must also match the retained bridge, change set and
  exact action.
- `readProtectedCorrections` reports `corporate_income_tax` for any voucher a
  `corporate_tax_effects` row points at, so a generic reversal refuses with
  `UnsupportedProfile`. No exception clause is needed because this packet implements no
  tax reversal; a reversal of a recognised current-tax effect would need its own owner.

Extending the `PostingOwner` union alone was not sufficient, because that type only records
what a caller may _claim_; the projection is what makes the claim checkable.

**The zero-delta path is not protected by pretending it posts.** A zero-delta bridge seals a
plan with no group, so generic `changes_execute` refuses it earlier on the plan shape
(`plan.groups.length !== 1`) and there is no voucher for a reversal to protect. Its only
route to the year target is `tax_execute_effect`, which validates the plan, validates the
approval, and writes the no-effect receipt. Nothing in this owner registers a voucher it did
not post.

## Lock order

`withBook` in `"update"` mode already admits the credential and takes the `books` row
`FOR UPDATE` inside `admitPrincipal`, so the book is held before this owner's code runs.
From there the order is period, the two income-tax accounts, the bridge, the approval, then
the counters. The bridge is read unlocked only to learn which period and accounts to lock;
the locked row is re-decoded and its digest compared, so the read-then-lock window cannot
slip a different bridge through.

The nonzero path deliberately does **not** lock the approval up front. The shared journal
primitive takes the plan, then the approval, then the counters, so pre-locking the approval
would invert domain-resources-before-approval. Four-eyes is checked from a shared read that
takes only `actorId`, which is immutable — `approvals` is only ever updated for
`consumedAt`. Revocation, expiry, consumption, operator membership and admission are all
re-validated under the write lock by the shared primitive.

A zero-delta recognition bypasses the shared primitive, so it validates its own sealed plan
through the shared `validatePlan` first, asserts that plan carries no group, and only then
writes its no-effect receipt.

### The retained receipt identity is the written one

`CorporateTaxEffect.groupReceiptId` is never a freshly minted identity. A nonzero
recognition reads back the posting-group receipt the shared primitive committed for that
change set, requires exactly one, and requires its plan digest to match the sealed plan. A
zero-delta recognition writes its own approved no-effect group receipt and retains that id.

## The form and the engine start from one result

`prepareIncomeTaxFields` derives the reviewed INK2 fields from the same sealed bridge and
requires the declared taxable basis to reconcile to `bridge.taxableIncome`. Which current-tax
figure the form adds back depends on where its declared accounting result came from:

| Declared result           | Add-back source              | Why                                                                                                 |
| ------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `projected_bridge_result` | `current_tax`                | the projected after-tax result already has the calculated current tax deducted                      |
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

A record marker is bound to the writer's own emittable character set without the space, so a
marker the contract accepts is always one the writer can put on a line and read back. The
markers the file-transfer contract actually uses are hash-led uppercase names, and they are
admitted. Whether a marker is usable _alongside_ a bundle's own separators is a property of
two reviewed fields together, so `renderSru` refuses a self-contradictory bundle before
emitting anything rather than the contract excluding reviewed markers.

## The corporate-tax family needs a fiscal tax period

`ProfileDates.taxPeriodOn` is **optional**, because `ProfileDates` is embedded in every
retained `ProfileWitness`. A witness sealed before this packet carries no such key and must
still decode; making the field required would have made every retained VAT and purchase
witness unreadable. `selectorDate` normalises a missing value to `null`, so an operation that
names no fiscal tax period gets no corporate-tax family at all. `bookStatus`, payroll
calculation, purchase recognition and the VAT return therefore do not supply it and cannot
observe this family, which is the point: they have no fiscal tax period. Only the pre-close
tax owner supplies `fiscalYear.endsOn`.

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
can never exist without its files. The alternative needs a _pending_ state that the
migration deliberately does not have (`corporate_tax_declarations_blocked_check` requires
`blocked -> file_count = 0` and there is no third status), and it makes the field lineage and
the file lineage disagreeable. Adopting the packet's shape would need an outbox record, a
runner credential, `OPENERP_PREPARATION_TOKEN` and a delivery endpoint, per ADR 0009.

## Verification state

See the programme verification limits. In
short: the packet's synthetic 20% vector was evaluated in a throwaway `bun` process against
the exported pure functions and every obligation held — pre-tax 1000000, before loss
1030000, current tax 206000, projected after tax 794000, form total 794000 + 206000 + 30000 =
1030000, an existing 200000 effect leaving a 6000 delta rather than 206000 again, and a
negative taxable result producing zero current tax rather than a negative receivable. That
is **arithmetic evidence only**: no database, no transaction, no HTTP call, no Worker
invocation and no rendered file has been observed. It is not retained as a test.

That vector fixture bypassed the contract schemas: it called the pure functions with
plain objects. It therefore did **not** exercise contract decoding, and it missed two
defects that decoding would have caught — the digest envelope and the record-marker
pattern, both fixed in the follow-up commit. Vector evidence must not be read as evidence
that a wire shape decodes.

Historical planning links and captures omitted from this source distribution remain in the private working archive.
