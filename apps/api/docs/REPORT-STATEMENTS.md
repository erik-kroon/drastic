# Semantic profit-and-loss and balance-sheet snapshots

`semantic_statement_v1` is an internal semantic statement derived from retained ledger facts. It is
not a statutory financial statement, a reviewed opening, a tax bridge or a period close certificate.
Arithmetic and coverage are separate statuses and the snapshot states both.

## Ownership

| Responsibility                             | Owner                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| Pure calculation                           | `packages/domain/src/statements.ts`                          |
| Wire contract, capabilities and REST group | `packages/contracts/src/report-statements.ts`                |
| Named Effect operations                    | `apps/api/src/application/report-statements.ts`              |
| Tx-passing reads and DML                   | `apps/api/src/db/report-statements.ts`                       |
| DDL, immutability and grants               | `apps/api/migrations/0005-next-13.sql`                       |
| Capability binding                         | `apps/api/src/application/capabilities/report-statements.ts` |
| HTTP handlers                              | `apps/api/src/transport/http/routes/report-statements.ts`    |

The pure module has no database, network or transport access. PostgreSQL holds the sealed header, the
retained row membership and the retained contribution membership; it does not map accounts, select
opening representations, exclude transfers, compute a virtual result or evaluate a subtotal graph.

## The reviewed mapping release

A caller supplies one reviewed `semantic_statement_mapping_v1` release. Nothing about a financial
account is inferred from its number, code or label: an account contributes to a statement only
through a reviewed `accountRoleRules` entry and a reviewed leaf row that accepts its role.

- A role may be accepted by exactly one leaf row. A second destination refuses as
  `RepeatedRoleDestination` rather than splitting or silently dropping the account.
- A balance-sheet leaf row must hold one asset, liability or equity class. A role carries its own
  class, so there is no second classification vocabulary.
- `subtotalDAG` is evaluated in topological order. A node calculates over rows of one statement
  only, and a subtotal is a calculation over leaves, never an additional financial contribution.
- `mechanicalTransferRoles` names nominal roles. A mechanical transfer is excluded from ordinary
  profit and loss only when an owned transfer receipt retains it.

The sealed snapshot stores the release with its canonical digest, so a later release cannot change
what an older snapshot means.

## Opening selection

`openingBasis.representation` records which representation the capture used.

- `opening_set_voucher` when the fiscal year has a `historical_bases` row in `opening_set` mode
  with an opening voucher. That voucher becomes the opening provenance and is excluded from the
  year's movements, so an imported opening set is never counted twice.
- `prior_native_balance` otherwise: the committed balance of every account before the fiscal year
  starts. A first year does not imply a zero opening.

`reviewed` is always `false`. This release retains no reviewed opening set, and the model emits an
`unreviewed_opening` diagnostic whenever it falls back to prior native balances.

## Calculation

Everything is exact integer minor units on `bigint`. Debit and credit stay decimal strings on
`numeric` columns; no IEEE floating point is used anywhere in the model.

```text
rawClosing[account]  = opening[account] + sum(actual movement debits - credits)
fiscalYtdProfit     = -sum(year ordinary nominal activity)
profitForInterval   = -sum(interval ordinary nominal activity)
transferredYtd      = net credit to year-result equity from owned transfer receipts
virtualUntransferredResult = fiscalYtdProfit - transferredYtd
```

The balance sheet closes on the whole fiscal year to date. Its virtual result row is therefore
year-to-date, not the requested profit-and-loss slice. `row_expense` and the credit-normal rows
keep their signed effects; presentation only applies the reviewed sign, and the raw signed value
stays on every retained contribution.

`residualMinor = assetMinor - liabilityMinor - equityMinor - virtualUntransferredResultMinor`. A
nonzero residual produces a `balance_identity_not_holding` diagnostic and `coverage.arithmetic:
"fail"`; it never produces a corrected number.

## Transfer exclusion cannot erase activity

Only a component whose account holds a mechanical transfer role **and** whose voucher carries an
owned transfer receipt is excluded from ordinary profit and loss. This release implements no
result-transfer posting operation, so no retained voucher currently carries one and nothing is
excluded. An entry that shares a result-transfer voucher without an owned receipt stays in the
profit and loss and raises an `unexplained_transfer_entry` diagnostic. A genuinely zero result
records `noFinancialEffect: true` on a real snapshot with its own receipt; it never becomes a fake
zero voucher or a consumed voucher number.

## Snapshot reads

`GET .../statement-snapshots/:id` returns the immutable saved model plus a separately computed
`live` block. No current label, rate or profile fact is mixed into the saved financial values.
A later backdated posting can only change `live.postingsAfterCutoff` and
`live.currentForCurrentBooks`; it cannot change a retained row or contribution.

Row paging takes its scan window from the retained membership **before** applying the statement
filter, so a page that filters every row out still returns `next` while unscanned members remain.
Totals and `total` always describe the whole snapshot, not the page. Cursors must name a real saved
ordinal in that snapshot; an out-of-snapshot anchor refuses.

`GET .../:id/rows/:rowId` explains a leaf row through its retained contribution identities and a
subtotal or computed row through its saved child rows. The computed virtual result has no journal
contribution, so its explanation points at the retained profit-and-loss rows that produced it.

`GET .../:id/compare/:otherId` compares two frozen snapshots in one currency unit with exact
right-minus-left changes. Each side keeps its own saved mapping and row identity; a changed
statement, balance class or role set is displayed as `classificationChanged`, never edited to make
the graphs agree. Totals are null unless the page covers the whole retained row set.

## Current limits

The company profile contract is not part of this release. A mapping release therefore carries
`effectiveFiscalRules.status: "pending_company_profile"` with its named owner, and every snapshot
records `coverage.companyProfile: "pending"`, `coverage.external: "not_established"`,
`coverage.statutory: false` and `coverage.financialClose: false`. No company profile record is
fabricated and no framework is assumed qualified.

An unmapped nonzero account produces a visible `unassigned_account` diagnostic and a failing
balance identity rather than a silently shorter statement.

The legacy `reports_prepare_family` role-bucket family report remains in place. It serves
`cash_flow`, which this packet does not model, and its own `profit_and_loss`/`balance_sheet`
projections are a SQL-computed role-bucket view of a saved trial balance. Retiring those two
projections in favour of this semantic owner is a separate cutover and is not claimed here.

## Verification status

Source and type-level evidence only. No PostgreSQL instance, no `0005-next-13.sql` application,
no HTTP or MCP request, no browser session and no concurrent capture was observed for this slice.
The pure model's four packet vectors were evaluated in a throwaway process against the exported
function and are not retained as tests. Transaction behaviour, cursor behaviour under real
concurrency, cursor validity against the migration and the remaining acceptance cases all require a
real database and application boundary.
