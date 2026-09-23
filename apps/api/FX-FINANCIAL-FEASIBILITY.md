# Financial FX feasibility — contract decision required

Status: bounded source investigation, not an approved design or implemented financial
workflow. No migration is reserved. No new FX artifact, capacity projection, posting or
company/legal policy was added.

## Existing owners and their actual scope

| Owner | Established behavior | Missing financial meaning |
| --- | --- | --- |
| `1900-exchange-rate-reviews.sql` | Evidence-backed directional rate revisions and exact `synthetic_half_up_nonnegative_v1` conversion reviews. | No recognized foreign obligation or financial effect; reviews explicitly retain `postingSupported:false`. |
| `2300-exchange-rate-withdrawals.sql` | Permanent observation withdrawal, refusal of new revisions/conversions, successful old-key recovery and separate live currentness. | No policy for a posted carrying basis versus later rate withdrawal or settlement. |
| `1700-commerce-allocation-reversals.sql`, `commerce_create_invoice` | A synthetic invoice in exactly the book currency; one amount equals an existing posted recognition line. | No separate original obligation currency/amount and book carrying currency/amount. |
| `2200-synthetic-invoice-cancellations.sql`, `commerce_allocation_selection` | Same-account/currency invoice and settlement-control-line selection, current capacity and immutable allocation lineage. | No foreign units consumed, carrying portion released, cash/fee currencies or FX residual allocation. |
| `1700-commerce-allocation-reversals.sql`, `commerce_assert_allocation` | One allocation amount conserves existing invoice and payment-control-line capacity; explicit unallocation preserves history. | No paired-capacity owner. A second independent FX balance could conflict with these existing capacities. |
| Native journal kernel | Sealed book-currency adjustment/reversal, human approval, atomic posting and receipts. | A balanced journal alone does not identify FX recognition, realized gain/loss or remeasurement/register consequences. |

The inspected API SQL has no `exchange_conversion_reviews` consumer outside1900/2300.
The FX review data therefore cannot currently determine an invoice's foreign denomination,
remaining foreign capacity or settlement effect. Adding a foreign conversion to an existing
book-currency invoice must not silently reinterpret that immutable invoice's currency.

## Decisions needed before a financial packet

1. **Monetary-item ownership:** choose where a foreign-denominated obligation lives and how
   it relates to the existing commerce identity without duplicating recognition or changing
   the meaning of retained `synthetic_invoice_v1` records.
2. **Paired capacities:** choose the authoritative original-currency and book-carrying amounts,
   their precision, consumption and correction/unallocation lineage. Do not create competing
   mutable balances beside the existing commerce allocation owner.
3. **Effect roles and evidence:** explicitly select recognition, carrying release, cash, fees
   and realized gain/loss roles and signed mappings, including account-role evidence and the
   atomic register consequence. Generic adjustment/reversal purpose is not that selection.
4. **Valuation policy:** select rate-date/source rules, when current rate usability is required,
   how posted historical basis survives later rate revision/withdrawal, and exact partial
   release/final residual rules. FX01's one-amount nonnegative rounding policy does not answer
   those lifecycle questions.
5. **Remeasurement:** FX-03 additionally needs a reviewed eligible open monetary-item set,
   valuation cutoff, unrealized-effect mapping and future reversal/correction policy. None
   can be inferred from a trial balance or account number.

These are contract/accounting-policy choices under D-03/D-08, not merely absent runtime
code. Actual-company activation separately needs D-04 facts and applicable reviewed rules.
The current evidence does not settle any choice above.

## Smallest candidate after a decision, not an authorization

One explicitly synthetic customer foreign-currency receivable and one full settlement into
book-currency cash could reuse established customer-control direction, existing exact-rate
evidence and native plan/approval/aggregate guards. Exclude partial allocation, fees, netting,
foreign-currency cash and remeasurement from that first scope. Even this candidate needs an
approved foreign-obligation/paired-capacity identity and realized-FX effect mapping first.
It is not an accepted design, a production treatment or permission to start implementation.

No placeholder preparation artifact is proposed: another review object would not resolve
the missing financial owner. Existing non-posting FX01 review remains useful within its
current explicit limits.

## Investigation and proof limits

Read plan05, open decisions, ADR0004,1900/2300,0600/1700/2200 commerce owners and existing
FX/commerce handoffs. No tests, runtime/SQL execution, migration application, external
research/provider calls or financial/disposal changes were performed. This document records
a source-supported decision blocker, not an operational or legal finding.
