# Supplier acceptance and offline payment export: source handoff

## Implemented source (migrations not applied)

`7100-supplier-acceptance.sql` extends retained supplier drafts through a **synthetic-only** review → same-operator approval → atomic posting/register/receipt. The operator pins a current supplier draft revision and digest, chooses payable and expense accounts and a period, and acknowledges synthetic scope. A source number, same-book original evidence, exact matched positive gross and evidenced zero asserted tax are required. The original supplier document number becomes the supplier register number; no number is issued on the supplier’s behalf. Original evidence is referenced by the kernel posting and supplier register. A prepared review fences separate posting of that original evidence. The execution rechecks draft and source history, then approves and executes the kernel posting and registers its payable control line in one SQL transaction. Revisions remain immutable and accepted draft heads cannot be edited. Legal identity, real VAT and company accounting profile are not activated. Existing generic correction guards still refuse a reversal of a commerce-bound recognition.

`7110-supplier-payment-batches.sql` provides a separate **offline synthetic** batch preview and immutable `pain.001.001.03` XML-byte export. An operator supplies debtor/payee account assertions with evidence references, selects 1–20 accepted supplier invoices, pins allocation versions and exact outstanding/partial amounts, then exports the reviewed digest. The export checks the live register again under the book lock and retains base64 UTF-8 bytes and their SHA-256. An invoice is reserved against another export after the first file; retrying the original idempotency key returns the same bytes. Its `exported` state is explicitly not bank-compatible, bank-accepted, paid, allocated or posted. No provider submission or settlement occurs. Unknown payee verification and bank scheme/profile contracts remain D-10 blockers.

The approved posting boundary already owns supplier acceptance recognition. Creating or revising a supplier draft alone still never books an amount. Payment file preparation/export also never books a payment. A bank observation or exported file cannot be interpreted as invoice settlement.

## Synthetic supplier credits and correction boundary

`7120-supplier-credits.sql` adds a same-operator review, approval and execution for a supplier credit against an accepted synthetic zero-tax payable. The supplier's distinct credit-note number and retained evidence remain original assertions. A credit may only reduce the currently unpaid residual; existing allocations and their payment vouchers stay immutable. A reviewed credit posts a debit to the original payable control account and a credit to the exact original expense account, both with zero asserted tax. Its separate register row links the original invoice, note, evidence, payable line and posting receipt atomically. The canonical invoice body deducts all credit effects from its effective amount and residual, and increases its capacity version. Register snapshots and period inventory account for credit rows and ledger effects at the selected cutoff. Generic correction of either original supplier recognition or the credit voucher stays blocked; corrections to an accepted synthetic obligation require a reviewed credit, not voucher deletion.

This is **not** a general statutory credit-note or VAT deduction profile. A paid amount cannot be credited by this path; refund and overpayment treatment remain unsupported. Partial credits against the remaining unpaid amount can coexist with retained paid allocations. No credit may reduce a payable linked to an outstanding exported payment file. D-08 rule activation and D-10 external outcomes remain explicit gates.

## Original zero-tax boundary

The original zero-tax credit profile does not support VAT-bearing credits. Edits to legally issued supplier records, generic recognition reversal, credit against already paid principal, refund, cash-method recognition, disputed source chronology and payment-file replacement remain unsupported. The original and every applied payment retain their own immutable identities. No part of this source change labels an exported file as accepted or paid.

## Verification limits

Contract TypeScript compilation, targeted formatter/lint and source review passed. An isolated temporary PostgreSQL 17 database accepted the three supplier migrations after the earlier supplier draft migrations were applied directly. The normal full migration runner stopped on the unrelated historical `4000-subledger-estimate-amendments.sql` syntax error, so this is SQL-definition compilation only, not an end-to-end upgrade. No tests were added or changed (D-09). No application execution, independent arithmetic, XML-schema, provider or bank behavior was verified. Existing invoice/payment controls and company activation remain separate gates.

## Synthetic gross-cost source-tax path (forward 8750–8751)

`synthetic-gross-cost-supplier-v1` accepts a draft whose exact positive asserted tax and gross are supported by source line evidence. The full gross debits one explicitly selected expense account and credits supplier payable; no input-VAT account or deduction fact is created. Its acceptance review retains the source tax and a legal blocker (`asserted_tax_not_deducted`). It is **not** a Swedish deductible-VAT purchase profile. The existing zero-tax profile still requires zero asserted tax.

`synthetic-gross-cost-supplier-credit-v1` takes an explicitly asserted `taxMinor` and a source credit note. A partial credit reverses gross cost/payable only. The source tax on all posted credits cannot exceed the accepted invoice's sealed asserted tax; each credit amount cannot exceed its current unpaid residual. Its tax field is an assertion for review, **not** a VAT recovery or report fact. Exported payment files still block credit. Payment allocation still requires a separate posted payment source, approval and capacity; neither export nor a reported provider status settles an invoice.

[Local HTTP proof](../../../docs/plans/evidence/ap-gross-cost-http.md) covers a positive source-tax invoice, partial credit, posted synthetic payment and rejected excess-tax credit. Actual VAT deductibility, Swedish treatment review, statutory credit notes, refunds and provider-confirmed settlement remain separate gates.

## Reviewed Swedish purchase posting (forward 8760)

The `swedish-purchase-v1` review takes one editable expense account and VAT rate per retained invoice line. A recent accepted invoice for the same supplier can suggest an account and rate; the operator can change both before preparing the exact voucher. The review checks each selected rate against the line's asserted tax within one minor unit, requires SEK with two decimal places, and uses the retained net and tax amounts. The journal debits the selected expense accounts and BAS 2641, then credits BAS 2440 for the evidenced gross. The 2440 and 2641 accounts must be active in the book. The accepted review keeps the line assignments for later correction.

The `swedish-purchase-full-credit-v1` path requires the complete original payable still unpaid, a distinct supplier credit number and retained credit evidence. Its reviewed voucher debits 2440 and credits the original expense lines and 2641 for their exact accepted amounts. The credit and payable register effect are committed together through the existing approval boundary. Partial, paid and foreign-currency credits remain outside this path.

This is still a synthetic-book journal profile. `taxAssessment=not_applicable`, `vatFactsCreated=false`, and `tax_profile_not_activated` remain explicit: the 2641 journal line is not a statutory VAT return fact or a verified deduction decision. The full migrations through 8760 applied to a disposable PostgreSQL database; contract/API type checks and targeted lint passed. No end-to-end posting or rendered browser proof is claimed for this new path.

## Reviewed line purchase source path (forward 8760)

`swedish-purchase-v1` currently runs only on a synthetic SEK book. It reviews explicit line expense accounts and 0/6/12/25 rates against evidenced source amounts, then posts net expense, input VAT (2641) and the supplier payable (2440) atomically. `swedish-purchase-full-credit-v1` reverses the exact original net/tax/payable **only while the whole original remains unpaid**. The [local HTTP observation](../../../docs/plans/evidence/ap-swedish-purchase-http.md) covers invoice recognition, full credit, a separate partial payment allocation and paid-principal credit rejection. The review still discloses `tax_profile_not_activated`; this is not authority to use actual company VAT facts or claim statutory completeness.

## Partial reviewed line credits (forward 8770–8771)

`swedish-purchase-partial-credit-v1` reviews exact credit-note net/tax for each selected original line. It verifies the original rate, cumulative original-line net/tax capacity and the invoice's live unpaid residual under the book lock. Execution reverses only the reviewed payable, expense and input-VAT portions; existing payment allocations remain immutable. [Local HTTP proof](../../../docs/plans/evidence/ap-partial-line-credit-http.md) includes two partial credits after a payment, a rate mismatch and exhausted-capacity refusal. No paid-principal refund or real-company VAT activation is implied.

## One payment source across supplier invoices

[Local split-allocation HTTP proof](../../../docs/plans/evidence/ap-split-payment-http.md) exercises a separately posted synthetic payable-control payment line across two accepted purchase invoices, including invoice/payment overcapacity refusals and same-key replay. It does not turn an offline export or provider report into a posted payment.
