#5500 commerce admission for tax-reserved payment lines

## Current ownership

Application operations live in [application/commerce/register.ts](../src/application/commerce/register.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Failure contract — recorded before code

4100 already rejects commerce allocation-leg inserts when the exact book/voucher/line has a
row in `tax_account_match_capacity`.1700's payment-capacity helper and4301's candidate reader
currently ignore that reservation. Align early admission with the existing physical fence.

- Reserved lines must not appear as candidates or pass direct capacity/preparation reads.
- A reservation created after preparation must make the existing plan-current check false,
  blocking new approval/application before inserts. Include unusable-but-reserved capacity.
- Filter candidates before materialized capacity evaluation; one reserved line must not fail
  the entire page. Never match only a line ID, amount or account, or another book's identity.
- Preserve exact amounts, capacity versions, output shapes, plan/history/replay bytes and
  successful-command replay order. Do not change any physical guard or accounting-role rule.
- After explicit unmatch releases the reservation, ordinary existing admission applies again.
  Do not invent a cross-register history version or permanently invalidate old approvals.
- Active commerce allocations cannot normally coexist with tax reservation under4100.
  Preserve unallocation calculations and completed-history reads; do not release capacity here.
- Forward only the latest1700 helper and4301 candidate reader. Preserve original migrations,
  dirty commerce/frontend work and shared schemas. No UI, tests, runtime/SQL compilation,
  migration application, provider actions or VCS history changes.

### Implemented source

`5500-commerce-tax-reservation-admission.sql` adds only two checks:

1.1700 `commerce_payment_body` refuses an exact retained reservation with4100's existing
`StaleDependency` message. It does not filter by match usability.
2.4301 `commerce_invoice_payments` excludes that same exact pair in its materialized
`eligible` CTE, before calling the payment helper. Its history branch is unchanged.

Existing consumers inherit the check: direct payment capacity,2200 allocation selection,
and0600 preparation/currentness/approval/application. The existing currentness owner catches
`P0001` and returns false. Successful command replay still precedes those checks.

The helper's1700 unallocation consumer retains its existing logic.4100 already prevents an
active allocation from sharing a tax reservation. Completed unallocation reads bypass live
snapshot checking, and target release is checked before payment capacity evaluation.

No contract, endpoint, registry, schema or UI change is needed. No native fence is weakened.
No amounts, capacity versions, saved bodies, digests, receipts or history are rewritten.

### Source checks

Compared both functions against their latest owners: only the three-line helper fence and
two-line candidate predicate differ. Authorization/book barriers and the complete history
branch are unchanged. Owned documentation formatting and `git diff --check` passed.
No tests, SQL compilation/execution, migration application or runtime checks were run.
Runtime behavior remains unverified; independent source review remains a separate gate.
