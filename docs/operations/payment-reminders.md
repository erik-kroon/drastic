# Payment reminders

Working design for P09. This document is not runtime evidence or provider qualification.

## Delivery contract

The collections workspace prepares an exact reminder from an issued Swedish SEK accrual invoice, its current canonical residual and a reviewed customer recipient revision. The caller names sources, never an amount or raw destination. No fee, interest or attachment is included in this first profile. A browser operator approves the exact plain text and HTML bytes, recipient and retained source basis. Approval and durable outbox intent commit together.

Historical collection actions keep `sendAuthorized: false`. A reminder message, approval, admitted attempt and authenticated provider observation are separate retained records. Provider acceptance does not establish delivery. The local fixture is the only available transport. Live provider selection, credentials, customer contact and production release remain unavailable.

Before admission, the approving browser session, actor admission, operator membership, approval expiry, recipient revision, invoice residual and reminder hold must still agree. Authority locks precede the book lock. Admission freezes one attempt and external identity. Payment after admission changes current settlement without changing the admitted message. Cancellation after admission cannot promise recall.

The provider call runs outside the database transaction. A lost response leaves an admitted attempt with an unknown outcome. Recovery reads the same external identity from the fixture. It never sends a fresh identity or sends blindly to discover an outcome. An explicit retry of an unattempted refusal requires a new preparation and approval.

## Failure contracts written before production

| Given | Public action | Independently expected result | Bad implementation caught |
| --- | --- | --- | --- |
| Issued invoice gross 12500 SEK minor units | Prepare with reviewed recipient | Exact residual `12500`, recipient and invoice number in retained plain/HTML bytes | Request amount or raw destination controls send |
| Foreign book or customer recipient | Prepare/read | Refusal without source disclosure | Unscoped lookup or recipient fallback |
| Prepared reminder and a payment of 4000 before admission | Approve then queue | Stale refusal, zero fixture submissions; next preview residual `8500` | Sending stale debt |
| Open reminder hold before admission | Queue | Stale refusal, zero fixture submissions | Ignoring collection disputes |
| Changed or withdrawn reviewed recipient before admission | Queue | Stale refusal, zero fixture submissions | Contacting a stale address |
| Ordinary MCP or API credential | Approve | Forbidden; preparation/read remain available | Agent self-approval |
| Expired approval or deleted/revoked browser session or membership | Queue | Refusal, zero fixture submissions | Approval grants permanent authority |
| Approved reminder cancelled before admission | Queue | Cancelled, zero fixture submissions | Cancel/admit race contacts customer |
| Two approvals or claims race | Approve/queue twice | One approval, one attempt, one external identity | Duplicate contact |
| Provider accepts exact bytes | Read status | `provider_accepted`, delivered false | Acceptance is treated as delivery |
| Fixture rejects transport authentication | Queue | Unknown outcome; no accepted/delivered observation | Unauthenticated transport establishes an external result |
| Persistent runner has no configured delivery profile | Queue | Approval stays unadmitted; zero fixture requests | Default runtime can contact a provider |
| Fixture supplies authenticated delivered observation | Reconcile/read | Delivered observation retained, delivered true | Unauthenticated status can establish delivery |
| Runner dies after fixture acceptance before observation commit | Restart runner | Same attempt/identity reconciled, no second POST | Crash creates duplicate contact |
| Provider cannot establish result | Restart/reconcile | `outcome_unknown`; no blind resubmission | Unknown becomes failed/retryable send |
| Terminal fixture rejection | Queue again | Failed retained rejection; one submission | Rejection retried as a new message |
| Payment after admission | Read current state | Original sent-as-of bytes plus changed current residual | Settlements rewrite sent statement |
| Command or queue history pruned | Repeat approval/queue | Durable uniqueness preserves attempt and identity | Idempotence depends only on transient history |

## Proof plan

The public HTTP E2E journey uses synthetic legal issuance, reviewed recipients, disposable PostgreSQL, the persistent Bun effect-mq runner and an authenticated loopback HTTP fixture. It retains request/message/attempt/observation receipts and fixture wire bytes. Expected amounts and states are literal test vectors. The pre-feature journey must fail because reminder routes do not exist. Required fast/full/strict gates, unchanged owner regressions, repeatable runtime journey, current source inventory and timing measurements remain open until observed.

Timing uses five warmups and thirty measured samples. Existing collection read p95 may not exceed the larger of baseline times 1.20 or baseline plus 50ms. Added preview and admitted dispatch-to-observation p95 must stay at or below 2000ms. Queue wait is recorded separately. Root grants the shared workload lane before installation, checks, E2E or measurements.

## Boundary map and reviewed choices

| Owner | Responsibility |
| --- | --- |
| `application/commerce/legal-issuance.ts` and `db/commerce/documents.ts` | Retained issued legal document and actual customer party |
| `db/commerce/invoices.ts` | Current exact residual, revision, allocation and cancellation/credit state |
| `application/commerce/collections.ts` and `db/commerce/collections.ts` | Historical preparation records and current reminder hold |
| `application/commerce/customer-invoice-defaults.ts` | Reviewed current recipient revision and `payment_reminder` purpose |
| `application/commerce/reminders.ts` | Exact message preparation, browser approval, admission, cancellation and observation semantics |
| `db/commerce/reminders.ts` and migration `0066` | Five owned durable record families, scoped uniqueness and constrained writes |
| `runtime/reminder-queue.ts` and persistent Bun preparation runner | Scheduling, queue retries and recovery through the application owner |
| Local fixture adapter | Authenticated loopback byte transport and same-identity reconciliation only |
| Collections reminder review caller | Exact recipient/message review, approval and honest retained outcomes |

The dedicated reminder owner was selected over a generic notification engine. Invoice delivery and payment reminders have different admission facts and existing legal delivery handoffs do not prove external transport. Combining their models would broaden behavior without removing a required reminder boundary.

The independent root challenge retained five constraints. Observations after admission may be retained even after approval expiry, session expiry or payment. Unknown or absent reconciliation cannot authorize a new POST. Current authority precedes command replay, while a stale current residual blocks new admission without rewriting old attempts. The fixture is explicit, authenticated, loopback only and disabled by default. Recovery inventory must include all five reminder families and mutable outbox progress before integrated backup proof.

## Recovery inventory obligation

P08 owns recovery inventory v3. P09 will extend it with a distinct v4 schema after integration and retain sealed v2/v3 decoding. V4 must include complete scoped identities and fingerprints for all five reminder families, exact message/approval/attempt/observation body hashes and current outbox state, checkpoint, cancellation version, reason and checked instant. A row count alone cannot identify the approved bytes or the admitted external identity.

Before recovery code, its failure vectors are fixed. An omitted family, duplicate scoped identity, wrong-book reference, missing approved message, missing attempt for an observation, changed immutable body, changed outbox checkpoint, mismatched table fingerprint, renamed artifact path, wrong source version or inventory exceeding its reviewed row/byte bound refuses qualification. V2/v3 artifacts continue to qualify only their original captured families. A successful inventory match grants no permission to resume contact. Restored admitted attempts reconcile their original identity; restored unadmitted approvals still require current authority and expiry checks.

The performance baseline uses the owned detached pre-feature checkout and `OPENERP_REMINDER_BASELINE=1` with the named fixed-fixture test. Head qualification supplies its retained `performance.json` through `OPENERP_REMINDER_BASELINE_RECEIPT`. Ordinary E2E runs record absolute preview/dispatch budgets; without that receipt the comparison is explicitly `not_checked`, so they do not establish the accepted existing-operation regression budget.


## Source verification checkpoint

The initial public journey failed at the absent reminder route after valid legal issuance and reviewed-recipient prerequisites. Production source checkpoint `d9e31ec` subsequently passed the fast/full changed-file gates and the current primary strict type-aware lint with warnings denied. The supported web build generated its required modules and passed. This establishes source checks only. Newly authored concurrency/authentication/default-disabled E2E cases and the first v4 inventory expectation have not run. Persistent runner, crash recovery, complete v4 qualification, browser behavior and timing remain open.
