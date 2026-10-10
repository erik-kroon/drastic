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

Storage must reject fractional minor units before coercion. A `NUMERIC(38,0)` column alone can round incoming fractional values; use a validated integer boundary and an exact database constraint that checks the original value. See [PostgreSQL's numeric semantics](https://www.postgresql.org/docs/18/datatype-numeric.html). Bounds and the new canonicalization are selected in the shared plan; independent codec/canonicalization vectors remain an acceptance prerequisite (D-03). The clean replacement does not interpret or migrate old digests.

Use civil dates for documents, economic occurrence/service interval, accounting, tax point and settlement. Use UTC instants for ingestion, recording, approvals and provider events. Fiscal-year boundaries are explicit and need not follow the calendar year. Retrying a command preserves its selected accounting date.

## Invariants

Supplier credits may be partial, but their retained gross amounts together must
not exceed the original supplier invoice amount. Every retained credit consumes
capacity. The separate invoice-cancellation workflow reverses the full original
amount and therefore retains its one-cancellation-per-invoice identity; it is not
the partial-credit record. See DF-09 proof.

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

## Forecasts and knowledge boundaries

The Cash requirements extend the read model without changing I-01–I-12. A forecast binds an authorized entity/book, reviewed account set, common economic `asOf`, knowledge `recordedCutoff`, source revisions and explicit assumptions. Later evidence cannot rewrite an older forecast. A period assessment likewise binds its ledger and source coverage; a technical lock alone does not prove completeness.

One economic payment can have invoice, instruction, bank, allocation and voucher evidence. Remaining amounts come from the owning register; opening inclusion and supersession/settlement relations decide whether a contribution belongs in the future. Equal amounts/dates cannot prove identity. A reservation, recurring estimate, payroll cost or tax declaration must not repeat the same cash effect through another representation.

Cash calculates exact daily balances and the minimum including the opening, then subtracts the selected buffer once. Negative headroom remains negative. Unknown amounts, dates, rates, unbridged observations and failed reads cannot become zero. Separate coverage, freshness, reconciliation and uncertainty, and preserve original currency plus any qualified conversion basis. Scenario edits change assumptions, never legal due dates or financial records.

Civil accounting and due dates remain dates. When a timestamp must become a date for the Swedish view, use explicit Europe/Stockholm semantics; do not shift an already established civil date through UTC conversion. Saved results and exports carry their source boundaries, included/excluded contributions, quality and calculation/scenario versions.

## Posting and corrections

For one atomic group: establish trusted scope, acquire the book mutation barrier, recover/check idempotency, load the exact plan and approval, check authority and dependencies, enforce period/accounts/semantic identities, allocate transactional series and commit counters, write effects/receipt/outbox, then commit. All writers that can invalidate these checks must obey the [shared lock order](plans/00-shared-contracts.md#runtime-and-transaction-ownership); integration must verify existing mutation paths against it.

The transaction contains no model, provider or rendering calls. Lost transport during commit means outcome unknown until a durable receipt establishes it. Retry uses the same identity. Outbox delivery failure cannot undo or repeat the posting.

A reversal uses original amounts, accounts and dimensions with opposite sides. A reversal plus replacement is one atomic group. The original remains in sums alongside the reversal. An inactive account or closed period needs an explicit supported correction policy, not silent bypass or backdating.

## Openings, reconciliation and reports

The working balance model is `approved OpeningSet for year + movements within that year through the committed cutoff`. The opening links to the prior close or a declared migration baseline. Imported history does not get added again as an opening voucher. A midyear reduced-history cutover must declare the detail it cannot reconstruct.

Reports distinguish ordinary activity, adjustments and mechanical result transfers so closing entries do not erase the income statement's activity. Pin the opening version, ledger cutoff, relevant source/subledger revisions, rule/mapping versions and non-ledger disclosures. Generate readable and machine-readable outputs from that semantic snapshot.

A zero difference with missing statement items is incomplete. A historical report can remain valid evidence of what was produced while being outdated for current books. Neither condition may be shown as current readiness.

Historical planning links and captures omitted from this source distribution remain in the private working archive.

## Supplier document intake (local fixture boundary)

The authenticated operator endpoint returns a per-book `@intake.invalid` forwarding destination; it is not a live mailbox. Local inbound-webhook email requires that exact book destination, an envelope ID and at least one attachment. Each attachment binds its own file/revision identity to the envelope. An immutable envelope manifest refuses changed attachment sets or bytes on resend. Bulk upload and fixture cloud-folder import compose existing source retention and supplier inbox review, not posting. Inbox reads expose the retained provider/account/folder/file/revision or envelope/attachment provenance; source occurrence identity remains independent of content hash. Identical bytes from different channels retain separate occurrences. Review can create a supplier draft but cannot post without the existing exact approval path.

Cloud import is **disabled without a configured loopback fixture**. An integration operator must provision a book/provider/account/folder binding in `supplier_intake_connections` before any fetch; a book operator cannot assign another folder using the shared fixture secret. The fixture is not Drive or Dropbox authorization or live synchronization. The local adapter accepts only an authenticated bare `127.0.0.1` origin with an explicit port; the caller cannot supply a URL, provider state or bytes. No real provider, mailbox, credentials, payment or statutory service is contacted.

One batch accepts 1–32 items. The existing HTTP request ceiling remains 8 MiB and each source remains at most 5 MiB (base64 expands bytes inside the body); large files must use separate bounded batches. A batch result preserves each retained/duplicate/refused/unknown/expired outcome and advances a fixture cursor only when all items have retained occurrences. Book+actor+key reserves exact input before item work. Same-key replay returns the durable result without contacting the fixture. If transport disconnects, the durable result is unknown with no invented item IDs; a crash after reservation but before result is also recoverable as unknown. The caller retains the original key and exact input to recover its result. A **new attempt key** re-acquires an unresolved page using the same provider file/revision coordinates and does not advance its cursor until resolved. An unavailable fixture configuration refuses before reservation. This fixture does not qualify live mailbox/domain routing, provider OAuth, retention/security approval, or a production import schedule.
