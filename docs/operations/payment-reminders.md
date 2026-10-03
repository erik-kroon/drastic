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
| Fixture supplies authenticated delivered observation | Reconcile/read | Delivered observation retained, delivered true | Unauthenticated status can establish delivery |
| Runner dies after fixture acceptance before observation commit | Restart runner | Same attempt/identity reconciled, no second POST | Crash creates duplicate contact |
| Provider cannot establish result | Restart/reconcile | `outcome_unknown`; no blind resubmission | Unknown becomes failed/retryable send |
| Terminal fixture rejection | Queue again | Failed retained rejection; one submission | Rejection retried as a new message |
| Payment after admission | Read current state | Original sent-as-of bytes plus changed current residual | Settlements rewrite sent statement |
| Command or queue history pruned | Repeat approval/queue | Durable uniqueness preserves attempt and identity | Idempotence depends only on transient history |

## Proof plan

The public HTTP E2E journey uses synthetic legal issuance, reviewed recipients, disposable PostgreSQL, the persistent Bun effect-mq runner and an authenticated loopback HTTP fixture. It retains request/message/attempt/observation receipts and fixture wire bytes. Expected amounts and states are literal test vectors. The pre-feature journey must fail because reminder routes do not exist. Required fast/full/strict gates, unchanged owner regressions, repeatable runtime journey, current source inventory and timing measurements remain open until observed.

Timing uses five warmups and thirty measured samples. Existing collection read p95 may not exceed the larger of baseline times 1.20 or baseline plus 50ms. Added preview and admitted dispatch-to-observation p95 must stay at or below 2000ms. Queue wait is recorded separately. Root grants the shared workload lane before installation, checks, E2E or measurements.
