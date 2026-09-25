# Domain model and accounting invariants

Status: working design with partial implementation. This document defines meaning and constraints; it is not an executable schema. [ADR 0002](adr/0002-exact-posting-and-approval.md) records the financial posting choices, amended for wire compatibility by [ADR 0004](adr/0004-complete-accounting-delivery-contract.md). [ADR 0010](adr/0010-application-owned-accounting-replacement.md) supersedes the earlier implementation/compatibility ownership while retaining these financial requirements.

## Ownership and trust boundary

The application process owns authentication, authorization, policy, calculations, workflow decisions and scoped financial writes. PostgreSQL owns relational records, DDL, constraints, grants, row locks, the narrow integrity layer and durable receipts. Direct application DML is a trusted backend capability, not a browser interface. Database integrity cannot establish human approval, and a compromised backend can manufacture a balanced action within its grants.

Use one short book-scoped transaction for each atomic financial group. Recheck current authority, scope, immutable plan and dependencies inside that transaction; pass its transaction through every persistence call. Lock authority before the book, then periods/accounts, domain resources, approval and counters. Financial transactions use no session-level tenant context and no advisory locks. The separate effect-mq Bun listener is delivery infrastructure only.

The clean replacement has no old-schema adapter, old-digest interpreter, dual writer or feature-function compatibility path. Historical records and dated evidence remain intact as history; they are not a second live accounting authority.

## Canonical vocabulary

Use these terms in maintained documents. Existing shared contracts own actual wire names; establish new wire and SQL names with their consuming operation.

| Term                        | Meaning                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| LegalEntity                 | The legal company represented by users; distinct from an administrative tenant/workspace. |
| Book                        | A scoped accounting authority with currency, fiscal years and writer identity.            |
| CompanyProfileVersion       | Sourced, effective-dated accounting method, registrations and framework facts.            |
| SourceObject / SourceRecord | Retained bytes / one source occurrence with its revisions and provenance.                 |
| FactAssertion               | A sourced claim with status, effective time and resolution history.                       |
| BusinessEvent               | The economic occurrence to which recognition and settlement relate.                       |
| AccountingCase              | The review dossier of evidence, events, decisions and blockers.                           |
| AccountingDecision          | A versioned treatment, rationale, facts and selected rule/profile versions.               |
| ChangeSetRevision           | Immutable proposed effects, grouped by atomicity, with dependencies and digest.           |
| Approval                    | Authority for an exact revision/digest and selected immutable groups.                     |
| PostingEffect               | A semantic accounting effect independent of job/request identity.                         |
| ExecutionReceipt            | Durable result of one atomic group; links effects and commit sequence.                    |
| OpeningSet / ReportSnapshot | Approved year opening basis / immutable report inputs, calculations and artifacts.        |

Source claims may be unreviewed, accepted, conflicted or superseded. A source assertion, a human confirmation and a deterministic calculation carry different authority. Resolution preserves prior claims. Chat history is not the accounting record.

## Financial representation

Posted lines retain paired `debitMinor` and `creditMinor` canonical nonnegative integer strings, at most 38 digits each, with exactly one positive side; for example `{"debitMinor":"125000","creditMinor":"0"}` within a plan with explicit currency and scale. Signed balances use a separate signed canonical integer codec. Do not accept floats, exponent notation, negative zero, leading zeros or implicit locale parsing at this boundary. [Shared exact-value contracts](plans/00-shared-contracts.md#exact-values-and-canonical-identity) specify source decimals, rounding and digest compatibility.

Book-currency scale belongs to versioned book/profile metadata. Rates, quantities and intermediate calculations use separate exact decimal/rational values until a named rounding boundary. Original-currency amounts remain available; they do not redefine the book-currency balance invariant. UI formatting does not participate in arithmetic.

Storage must reject fractional minor units before coercion. A `NUMERIC(38,0)` column alone can round incoming fractional values; use a validated integer boundary and an exact database constraint that checks the original value. See [PostgreSQL's numeric semantics](https://www.postgresql.org/docs/18/datatype-numeric.html). Bounds and the new canonicalization are selected in the shared plan; independent codec/canonicalization vectors remain an acceptance prerequisite ([D-03](open-decisions.md)). The clean replacement does not interpret or migrate old digests.

Use civil dates for documents, economic occurrence/service interval, accounting, tax point and settlement. Use UTC instants for ingestion, recording, approvals and provider events. Fiscal-year boundaries are explicit and need not follow the calendar year. Retrying a command preserves its selected accounting date.

## Invariants

| ID   | Invariant                                                                                                                                  | Enforcement owner                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| I-01 | Every financial reference belongs to the authorized legal entity and book.                                                                 | Trusted application scope plus composite database constraints and privileges. |
| I-02 | A voucher has at least two nonzero lines and exactly equal book-currency debit/credit totals.                                              | Exact domain validation and final database aggregate check.                   |
| I-03 | Posted economic content is immutable; correction preserves the original and lineage.                                                       | Restricted database writes and explicit correction operations.                |
| I-04 | One semantic effect per `(book, causal event, posting role, occurrence)`. A source revision or new job ID does not create new recognition. | Persistent uniqueness at the posting boundary.                                |
| I-05 | Execution uses the stored sealed revision and authorized groups; no replacement lines arrive in the execution request.                     | Approval checks inside the posting transaction.                               |
| I-06 | Relevant row revisions and collection predicates remain valid at execution.                                                                | Dependency manifest plus locked recheck.                                      |
| I-07 | Number allocation, financial effects, approval consumption, receipt and outbox commit together.                                            | One short PostgreSQL transaction per group.                                   |
| I-08 | A retry with the same scoped key and request returns its recorded result; a different request conflicts.                                   | Durable idempotency identity and request fingerprint.                         |
| I-09 | Allocations and installments conserve the source amount, including explicit FX/rounding effects.                                           | Domain-specific constraints in the shared transaction.                        |
| I-10 | Snapshot cutoffs follow commit order; year openings and prior movements are never counted twice.                                           | Transactional book counter and explicit opening/report basis.                 |
| I-11 | Reconciliation requires independent coverage and item checks as well as totals.                                                            | Versioned reconciliation inputs and checks.                                   |
| I-12 | Report, filing, signature and provider outcome refer to exact versions; local readiness is not external acceptance.                        | Immutable snapshot/artifact manifests and provider event history.             |

## Observation, recognition and settlement

An invoice and a bank row can be two observations of related activity. They do not automatically produce two expenses. One payment may settle several invoices; several payments may settle one invoice. A receipt match preserves a relationship without proving the tax treatment.

An owner-paid expense and company reimbursement are separate events: recognition of the cost/asset and liability, then settlement of that liability. Commercial open items and recognized GL balances are distinct under the selected accounting method. A year-end-recognized invoice retains that recognition link when paid later.

Use stable source IDs when available. Otherwise retain file identity and row occurrence, and resolve overlaps explicitly. Equal date, description and amount cannot be a destructive deduplication key: two legitimate payments may be identical.

## Posting and corrections

For one atomic group: establish trusted scope, acquire the book mutation barrier, recover/check idempotency, load the exact plan and approval, check authority and dependencies, enforce period/accounts/semantic identities, allocate transactional series and commit counters, write effects/receipt/outbox, then commit. All writers that can invalidate these checks must obey the [shared lock order](plans/00-shared-contracts.md#runtime-and-transaction-ownership); integration must verify existing mutation paths against it.

The transaction contains no model, provider or rendering calls. Lost transport during commit means outcome unknown until a durable receipt establishes it. Retry uses the same identity. Outbox delivery failure cannot undo or repeat the posting.

A reversal uses original amounts, accounts and dimensions with opposite sides. A reversal plus replacement is one atomic group. The original remains in sums alongside the reversal. An inactive account or closed period needs an explicit supported correction policy, not silent bypass or backdating.

## Openings, reconciliation and reports

The working balance model is `approved OpeningSet for year + movements within that year through the committed cutoff`. The opening links to the prior close or a declared migration baseline. Imported history does not get added again as an opening voucher. A midyear reduced-history cutover must declare the detail it cannot reconstruct.

Reports distinguish ordinary activity, adjustments and mechanical result transfers so closing entries do not erase the income statement's activity. Pin the opening version, ledger cutoff, relevant source/subledger revisions, rule/mapping versions and non-ledger disclosures. Generate readable and machine-readable outputs from that semantic snapshot.

A zero difference with missing statement items is incomplete. A historical report can remain valid evidence of what was produced while being outdated for current books. Neither condition may be shown as current readiness.
