# VAT facts and return captures

## Current owners

- [Fact admission and draft operations](../src/application/vat-returns.ts) retain reviewed source facts and synthetic review drafts.
- [Actual-return capture](../src/application/vat/actual-return.ts) reads qualified inputs, invokes the pure calculator outside its capture transaction, and seals an immutable result after checking the same dependencies again.
- [The Swedish calculator](../../../jurisdictions/se/src/vat/actual.ts) owns exact box projection and control reconciliation.
- [Database reads](../src/db/vat/actual-return.ts) and [credit-component reads](../src/db/vat/credit-components.ts) use the caller's transaction. SQL does not own the workflow.

These are distinct products. Synthetic drafts do not declare company VAT. An actual-return calculation requires reviewed company/rule/period inputs and still records no submission, assessment or payment. A synthetic E2E exercise cannot qualify a real company.

## Fact admission

An operator records a fact with retained source and review evidence, explicit treatment, amounts, dates, registration/method opinions and an exact voucher/tax-line link. Missing facts remain unknown. A revision keeps the component's source key and record class; it does not relabel synthetic history as company data.

Original sale qualification stays with this owner. A native credit is not copied into a second manual negative fact. Later revisions and withdrawals retain earlier records and invalidate affected currentness.

## Native producers

| Origin                       | Published source                                  | Capture rule                                                                                                                           |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `manual_admission`           | Current `vat_fact_revisions` and withdrawal state | Retain the reviewed original fact and its declared tax point.                                                                          |
| `owned_purchase_recognition` | `purchase_tax_facts`                              | Read the purchase owner's signed components and original-line journal ordinals.                                                        |
| `owned_owner_purchase`       | `owner_purchase_tax_facts`                        | Use the same purchase calculation and deduction decision. Funding does not create another VAT owner.                                   |
| `owned_customer_credit`      | `customer_credit_tax_corrections`                 | Link the exact original voucher to one current reviewed sale fact with matching full invoice totals in the selected registered period. |

Credit capture refuses a missing, withdrawn or ambiguous original. It does not infer a tax point from an invoice number, payment, supply date or ledger date. Cross-period credit treatment remains outside this slice. Credit components retain the original fact ID, their own signed amounts and the exact output-VAT line ID.

Owner-purchase source VAT and deductible VAT remain separate. Capture never recalculates a deduction. Zero deduction and zero-tax credits use no fabricated monetary VAT line. Every physical control line is counted once. Conflicting or duplicate manual/owned representations block readiness instead of increasing declared amounts.

## Period, bounds and currentness

The reviewed `vat_period` fact selects cadence. Monthly and quarterly windows must match complete calendar months/quarters. A yearly window must match a retained fiscal year. The fact's effective interval must cover the selected window. Partial or unsupported windows refuse.

Rates, mappings, filing units and rounding come from the selected reviewed VAT release. Existing exact-rate restrictions still apply. An unmapped treatment or tax amount outside that release is an explicit exclusion, not a default rate.

Capture refuses more than 500 selected facts across all producers. It records whole-book populations, selected membership, recognition IDs, source digests and producer inventories. It includes every VAT control movement at the captured ledger boundary, including unexplained rows.

Reads return saved amounts plus separate currentness. New native components, changed fact revisions or withdrawals, ledger movement, profile-witness changes and family membership changes can make a saved return stale. Saved amounts and receipts are not rewritten. Earlier captures remain readable; missing new population fields are compared against the live producer inventory.

The credit receipt's `taxConsequenceObserved: false` is its immutable issue-time statement. Inclusion in a later VAT capture is proved by that capture's contribution and lineage records, not by rewriting the credit receipt.

## Public boundary

Base path: `/api/v1/entities/:entityId/books/:bookId/vat-returns`.

| Operation                         | Meaning                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `POST /facts`                     | Record an operator-reviewed fact revision.                          |
| `POST /facts/:id/withdrawal`      | Retain an explicit withdrawal.                                      |
| `GET /facts`, `GET /facts/:id`    | Inspect retained facts and their history.                           |
| `POST /drafts`, `GET /drafts/:id` | Prepare or read the separate review-draft product.                  |
| `POST /actuals`                   | Capture and seal the qualified calculation with an idempotency key. |
| `GET /actuals/:id`                | Read its immutable result and currentness.                          |

No public operation accepts caller-calculated boxes as a sealed result. MCP fact-review authority remains excluded; shared preparation/read operations keep the same backend admission.

## Verification and limits

The FWD-04 E2E case in `apps/api/tests/credit-document.e2e.test.ts` drives native sale, credit, owner purchase, fact admission and return capture through HTTP. Setup installs labelled synthetic qualification metadata only; it does not seed financial effects.

Independent vector: sale net/VAT `10000`/`2500`, credit `2000`/`500`, owner source VAT `250` with deduction `125`, and owner source VAT `100` with no deduction. Expected output/input/net VAT is `2000`/`125`/`1875`. The fixture's reported boxes 10/48/49 are `20`/`1`/`19`, with net residual `-25`.

Cases cover zero-tax credit with only two journal lines, exact original linkage, missing/ambiguous/withdrawn original refusal, cross-period refusal, invalid monthly window, duplicate-source blocking, source-versus-deduction amounts, and unchanged saved returns after later facts. The monthly vector is exercised; quarterly/yearly window rules are source-inspected, not separately qualified company journeys.

Run `bun run test:e2e` and inspect `test-results/e2e/owned-vat-journey.json` with the manifest, source-integrity result and test report. Read the packet record for current verification status. Company qualification, filing, assessment and payment remain separate gates. Old SQL dispatcher instructions and migration-1000 installation steps are superseded; Git history retains them.

Historical planning links and captures omitted from this source distribution remain in the private working archive.
