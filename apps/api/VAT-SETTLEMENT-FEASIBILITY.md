#4400 synthetic VAT settlement link — feasibility and failure contract

Status: feasibility review only. No4400 migration, settlement tables or execution endpoints
have been created. Existing4100 tax-account matching is not a VAT settlement.

## Failure contract before implementation

A permissible existing-effect link would have to:

- Pin a saved synthetic draft and require its current immutable fact/ledger basis, exact
  available net amount, explicit selected reporting period and source class.
- Pin the existing posted voucher/line, exact book currency and explicitly established
  accounting role/sign convention. Equal unsigned amounts or a BAS account number are not
  evidence of settlement identity.
- Distinguish net VAT liability, its reclassification, tax-account assessment and bank payment.
  Neither a draft nor a tax-account deposit proves filing, assessment or payment allocation.
- Reject all taxable fact/source effects as their own settlement. Physical guards in the
  actual VAT fact and expense-source owners must also refuse later taxable reuse.
- Preserve immutable link/reversal history, one active permitted relation, evidence/rationale,
  current operator authorization, exact-key recovery, open-period/account/correction checks
  and source↔ledger tax-account matching as a separate relation.
- Expose the retained/current relation in an actual control and dependency owner without
  changing source facts or creating a target-draft currentness cycle.
- Keep legal profile, source completeness, reconciliation, filing, payment and financial-close
  readiness unavailable. No financial posting is authorized.

## Findings under review

The saved calculator has exact `syntheticBoxes.box49.exactMinor = box10 - box48` only when
`otherBoxes` explicitly says absent. Reported-krona values and residuals are separate; they
are not an approved settlement rounding rule. A negative value means a candidate recoverable
amount, not an observed refund.

The3800 source mapping declares a selected account and `debit_minus_credit` for tax-account
source/GL comparison. It does not declare a VAT-liability account, return-transfer effect,
VAT assessment identity or the sign mapping from box49 to that accounting effect.

ADR0002 explicitly supplies no account/posting template and distinguishes transfers,
charges/credits and VAT-liability reconciliation. Plan05 names `VatSettlement` as a future
return-version→distinct-accounting-effect relation but does not choose that effect's role or
signed comparison. Exact amount alone therefore cannot resolve the missing mapping.

## Decision required — do not implement4400 from equal amounts

The current posted-journal model exposes only `adjustment` and `reversal` purposes
(`packages/domain/src/ledger.ts` and0001 admission). There is no immutable existing
VAT-settlement effect/report role to select. A generic adjustment line cannot tell us
whether it increases a VAT liability, clears that liability, moves the tax-account balance
or represents another tax. Changing its purpose would rewrite history and is out of scope.

For the same positive box49 net, a liability-clearing debit and a tax-account charge credit
have opposite `debit_minus_credit` signs.3800's selected-account declaration does not choose
between them. An explicit new synthetic role/sign policy could choose one, but no existing
owned contract authorizes that choice. Nor may a `tax_charge` classification be silently
specialized to VAT: it has no tax-type or return-assessment field.

Required root/product decision before implementation:

1. Name the bounded **synthetic accounting-effect role** being linked (for example, a
   reviewed liability-reclassification effect, not a bank payment or proof of authority
   assessment). Declare whether it references an existing tax-account match or another
   separately evidenced accounting-control effect.
2. Declare the exact mapping from saved `box49.exactMinor` to the chosen effect's signed
   `debit_minus_credit` amount, including positive/negative/zero behavior. Do not substitute
   reported-krona values or invent a rounding entry.
3. Declare account-role evidence and whether one link is permitted per draft version or per
   reviewed reporting-period identity. Draft selection currently has dates and evidence,
   not a dedicated registered-return obligation/settlement-capacity identity. Two current
   duplicate drafts must not make one underlying return look settled twice.

These are synthetic model decisions, not a request to activate a Swedish legal profile.
Until they are explicit,4400 is deferred. No placeholder `VatSettlement` table, review receipt
or pass-through endpoint was added that could imply this missing semantics already exists.

## Ownership work that remains feasible after the decision

`vat_fact_revisions` and `expense_tax_source_revisions` currently admit scoped retained
voucher references but have no settlement-role exclusion. A future link would need symmetric
book-locked guards there (including later revisions) and in its own admission, refusing any
voucher/effect already retained as a taxable source. Retaining evidence alone must remain
possible; it is taxable recognition of the settlement effect that must be refused.

Tax-account matching stays a distinct source↔ledger relation. If the chosen model references
an existing4100 match, the settlement relation should refer to that owned capacity, not
insert a second source/ledger reservation. Its reversal/currentness policy must be explicit.

A no-cycle currentness route exists: require the settlement posting to exist before the
selected current draft is prepared, reject all already-taxable source effects, refuse future
taxable reuse through the actual owners, and avoid injecting settlement inventory into
`vat_return_basis_body`. The separate called tax-account/VAT closing dependency owner can
carry settlement inventory without redefining the target draft's source basis. Existing
historical drafts stay unchanged; an older draft staled by the pre-existing posting cannot
be relabelled current.

## Evidence and verification

Read maintained plan05, domain rules and ADR0002; inspected saved calculator/contract box49
semantics,3700 draft-basis owner,1000 VAT fact admission,0710 expense-tax source/assessment
owners,3800 account/sign declaration and4100 matching ownership. These source findings
support the deferral decision; no runtime or database scenario was executed. Documentation
formatting and whitespace checks passed. No source code, migration, tests, external actions
or VCS history changes were made for4400.
