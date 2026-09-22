# ADR 0002: Swedish VAT preparation profile boundary

- Status: research decision; candidate scope only. No approved compliance profile.
- Research date: 2026-09-22 UTC.
- Source manifest: [`sweden-vat-sources.json`](../sources/sweden-vat-sources.json).
- Design context: [compliance and interoperability](../compliance.md) and [profile delivery](../plans/05-vat-payroll-assets-fx.md).

## Decision

Official sources support designing a **narrow domestic, standard-rate, accrual VAT preparation workflow**. They do not establish an approved legal profile or verified facts for any business. This ADR does not enable posting, generate a filing-ready return, submit a return, initiate payment, or assert legal compliance.

A future candidate may prepare traceable **draft contributions** for ordinary Swedish sales and purchases. Its eligibility checks must fail closed. Missing facts must remain unknown, not become assumed defaults. A partial draft is not a complete VAT return.

Keep these separate:

1. Evidence and accepted transaction facts.
2. VAT classification and reporting-period attribution.
3. Draft return contributions and completeness review.
4. Filing and decision evidence.
5. Transfers to the skattekonto and tax-account charges or credits.

The observed standard rate is **25%**, subject to exceptions. “Domestic” does not mean “25%”. No active profile identifier, legal validity range or production release approval is established here.

## Evidence and date limits

The manifest records official URLs, retrieval timestamps, response hashes, observed page metadata, short verbatim excerpt snapshots and access failures. It is not a complete immutable archive of the pages. Complete HTML bodies were not saved in the repository. A future download may have different bytes.

`DC.Date.Modified` and HTTP dates describe pages, not legal commencement. The Riksdagen consolidated VAT law was observed as amended through SFS 2026:1025. Its transition provisions state that the law commenced on 2023-07-01, with exceptions preserving older law. That date is **not** this candidate profile's start date.

The retrieved 9 kap. 2 § contains both a pre-2028 and a future version. Both state 25%, but their exception references differ. The text cites amendment 2026:118, effective 2026-04-01, and a successor under 2026:119, effective 2028-01-01. Their transitions preserve older provisions for earlier taxable events. This is not evidence that the 25% rate began in April 2026. Do not select a rule from retrieval date, page order, or the rate alone. The exact transaction-date interval and applicable clause versions remain a release blocker. [sfs_vat]

The tax-procedure law was observed as amended through SFS 2026:1305. Its issue date and consolidation label do not resolve clause-level applicability. Two Skatteverket legal-guidance URLs returned “Request Rejected”, including an explicitly versioned URL. Neither is usable evidence. [sfs_taxprocedure; manifest `failedAccess`]

## Candidate boundary

These are proposed product restrictions, not a claim that Swedish law has only these cases:

- One identified Swedish legal entity and one accounting book, with SEK as accounting and invoice currency.
- Verified Swedish VAT registration covering the transaction dates and reporting period.
- Explicitly declared **faktureringsmetoden**, supported by registration or other authoritative business evidence. Do not infer it from turnover, invoices or bank activity.
- One explicitly identified registered reporting period and its start/end dates. Do not derive a filing deadline from a generic calendar default.
- Ordinary domestic supplies where place of supply, supplier VAT liability and the standard 25% rate have been reviewed.
- Ordinary domestic purchases with correctly charged Swedish 25% VAT, full invoice evidence, and a separately supported right to deduct the full VAT amount.
- Completed ordinary transactions with no advance payment, special timing, correction, mixed rate, mixed use or special scheme.
- Exact source amounts and references to the accepted classification and date basis. No guessed split of a bank amount into net and VAT.

An invoice may contain useful facts without proving every eligibility condition. A supplier's Swedish address, Swedish bank account or invoice VAT amount does not alone prove place of supply, the right rate, or deductibility.

### Facts still missing for any real business

No business facts have been accepted by this research. Before a candidate can be applied, obtain and review:

- Legal entity, organisation/VAT identifiers, registration status and registration-effective dates.
- Accounting currency, financial year, declared accounting method and any method changes.
- Registered VAT period, exact period boundaries and applicable authority-provided deadline.
- The nature and location of the supplies, applicable rate and any reverse-charge or exemption conditions.
- Invoice identity, parties, dates, net amount, VAT amount, rate, and supply description; invoice receipt evidence for purchases.
- Business purpose, taxable use and full input-deduction entitlement. The general rule is limited to use in taxed activity, and restrictions exist. [sfs_vat, 13 kap. 6, 31–32 §§; skv_input; skv_invoice]
- Complete source coverage for the period, including any unsupported transactions. Unknown coverage cannot become an empty or zero return.
- Tax-account ownership and separate evidence for deposits, charges, credits, filing status and decisions when relevant.

## Date basis: accrual is not the bank date

The general output rule uses the period when the supply was booked or should have been booked under good accounting practice. The general input rule uses the equivalent acquisition basis. Skatteverket describes invoice issue and invoice receipt as the usual operational points. They are not unconditional substitutes for the statutory rule. [sfs_vat, 7 kap. 14 and 31 §§; skv_when]

A future draft must retain invoice issue date, purchase-invoice receipt date where relevant, supply date, accounting date, proposed VAT period and the reason for that period. If dates disagree or evidence suggests the transaction should have been booked earlier, require review instead of silently using the bank date or current open period.

Advances have payment-based rules even under faktureringsmetoden. They are excluded here. Bokslutsmetoden/kontantmetoden has payment timing plus year-end treatment of unpaid invoices. It is not supported by this accrual candidate. [skv_when]

## Return-box contributions

The official box guidance supports the following mapping **only after eligibility and period review**. It does not prescribe bookkeeping account numbers. [skv_boxes]

| Draft item                     | Candidate contribution                     | Boundary                                                                                                     |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Ordinary domestic taxable sale | Net amount to box 05; output VAT to box 10 | Excludes supplies belonging in 06–08 and all nonstandard cases.                                              |
| Ordinary domestic purchase     | Eligible input VAT to box 48               | Purchase net amount does not go in 05 or ordinary reverse-charge purchase boxes. Deduction is not automatic. |
| Net VAT                        | Box 10 minus box 48 within this candidate  | This is not the general return formula.                                                                      |

The general box 49 formula is `10 + 11 + 12 + 30 + 31 + 32 + 60 + 61 + 62 - 48`. It reduces to `10 - 48` only after evidence establishes that all other contributions are absent. A negative result indicates VAT to recover, not evidence that Skatteverket has refunded it. Foreign VAT is not deductible in the Swedish return. The official zero-return instruction cannot justify declaring zero where coverage is unknown. [skv_boxes]

Preserve each contribution's transaction, invoice/evidence references, date basis, classification, exact amount and source/profile revision. Retain a reviewable list of exclusions and unresolved cases. Do not infer tax classification from a chart-of-accounts number alone or silently omit unsupported records from a purported complete return.

### Precision and rounding remain unresolved

The official XML guidance requires integers without decimals. It also documents sign handling. This does **not** establish whether or when amounts must be rounded or truncated, how negative fractions behave, or how period totals reconcile to ledger precision. [skv_returnfile]

Preserve exact underlying monetary amounts. Do not invent a per-line or per-box algorithm. Final whole-krona box values, rounding postings and filing-ready exports remain blocked until the authoritative rule, aggregation order, signed-value treatment and reconciliation are verified. A draft may expose exact unrounded contributions with that limitation clearly stated.

## Bank transfer versus skattekonto assessment

A bank-to-skattekonto transfer is evidence of money movement, not evidence of a VAT expense, assessment, return submission or settlement of a specific VAT debt. The general skattekonto has no allocation order between tax types; a deposit cannot be earmarked for a particular tax. [skv_taxaccount]

SFL 61 kap. 1 § distinguishes taxes/charges from incoming/outgoing payments. Under the general 61 kap. 2 § rule, payable amounts are registered on their due date. SFL 62 kap. 2 § and Skatteverket's payment guidance distinguish initiating a payment from its being booked on the authority's account. Do not equate a bank value date with confirmed receipt by Skatteverket. [sfs_taxprocedure; skv_taxdeposit]

For future accounting design, use separate conceptual events:

- **Transfer:** movement from the business bank to its verified tax account, subject to entity-specific accounting policy and receipt/reconciliation evidence.
- **Tax-account charge or credit:** a separately evidenced tax event with tax type, amount, effective date and authority reference.
- **VAT liability reconciliation:** a match to the reviewed return/decision and existing VAT balances, not a new expense inferred from the transfer.

This ADR approves no BAS account numbers or posting template. The exact accounts depend on the entity and book. A bank feed alone is insufficient to settle that policy.

A separate paper decision is not always required: SFL 53 kap. 2 § says a timely, properly filed return can give rise to a deemed decision matching the return. A draft does not qualify. Filing evidence, decision status and tax-account evidence must therefore remain distinct. The correction guidance also describes decisions specifying additional VAT and a due date. [sfs_taxprocedure; skv_corrections]

## Unsupported cases and changes

Exclude reduced or zero rates; exemptions and small-business exemption; international sales or purchases; imports/exports; EU trade; reverse charge, including domestic reverse charge; OSS/IOSS; margin schemes; vouchers; property/rent and construction special rules; own use; mixed or private use; partial deduction; representation and vehicle-specific deductions; investment-goods adjustments; foreign currency; and cash accounting.

Also exclude advances, deposits requiring tax analysis, special or disputed timing, missing/defective invoices, self-billing, simplified-invoice exceptions, credit notes, returns, discounts requiring adjustments, bad debts, late invoices and historical corrections. Exclude payroll, employer contributions, preliminary income tax, interest, fees and other skattekonto tax types from this VAT candidate. Their presence must not be relabelled as VAT.

These exclusions are deliberate first-profile limits, not legal conclusions that such transactions have no VAT consequences. A later profile needs its own evidence and review.

Corrections must not overwrite accepted history. A future correction workflow must link the original evidence, accounting changes, affected period and any corrected return/decision. This research does not choose a correction-period algorithm or move an error into the next open period.

## Release gates and consequences

The bounded scope can guide preparation-only development. It does not clear the following gates:

1. Independently verify and archive complete dated authority sources; review clause versions and transitions for an explicit validity interval.
2. Resolve rounding, sign conventions, aggregate-to-ledger reconciliation and any intended correction handling.
3. Verify the business and transaction facts listed above. Obtain qualified review of the proposed scope and accounting policy.
4. Establish period completeness. Unsupported transactions block a complete candidate return; they may remain clearly excluded from a partial draft.
5. Separately authorize and validate any production posting, filing/export or payment integration. Nothing here grants that authorization.

Until then, keep profile approval and effective dates unset. Do not advertise the system as Swedish VAT compliant, mark a return filed, accept business facts, or enable posting from this document. No application code, tests, database data or external submission is changed by this research.
