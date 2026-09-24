# Terminal disposal correction-impact closure —4900

## Failure contract (before implementation)

This packet closes only two discovery/admission edges left after4200: a posted disposal
voucher and its retained acquisition/imported basis voucher. It grants no correction,
reversal, reopening, financial posting or source-completeness authority.

- A correction impact for either voucher must identify the terminal disposed schedule,
  include the immutable disposal digest and report `blocks:true`.
- Current correction admission must reject those relationships before preparing or approving
  a new generic correction.4200's shared/deferred/physical refusal remains unchanged.
- Use exact same-book retained voucher identities. Do not infer ownership from amounts,
  account labels, coincident evidence, dates or the current chart.
- Do not add another recognition-voucher edge: existing schedule resources already block
  those. Do not introduce a resource kind, unused provider or financial engine.
- Keep historical reviews/receipts and successful exact-key replay immutable. Existing
  currentness reads may mark old impact reviews stale; do not rewrite their basis.
- Preserve4700's tax-account resources, prior bank/commerce/owner/schedule/report/closing
  branches, deterministic ordering and the1000-resource fail-closed limit. No truncation.
- No history is deleted, no posted balance or register is released, and no new generic
  exception may bypass4200's terminal disposal owner.

## Inspected consumers

1700's current resource function identifies recognition through `subledger_preparations`,
not disposal reviews or original basis.0410 `correction_impact_basis` materializes every
resource and turns `blocks:true` into an explicit blocker; `correction_require_unbound`
uses the same resources for early admission. Bundle preparation and `check_correction_bundle`
re-evaluate current impact before approval/execution. Shared kernel/deferred/physical
4200 guards remain a separate fail-closed boundary.

The contract already supports `kind:"schedule"`, a schedule ID/path, `blocks:true` and
optional `dependencyDigest`. The immutable disposal digest binds its review, original
basis and posting receipt. The two direct matching paths are:

```text
disposal.posting_receipt_id -> execution_receipts.voucher_id
OR disposal.review_id -> review.basis.carryingBasis.input.voucherId
```

Both relationships remain anchored to one disposed schedule in the authorized book.
Ordinary recognition resources are not expanded by this packet.

## Coordination gate

The failure contract was recorded while4700 still owned the replacement. Root then handed
off completed4700.4900 was built from that exact function only after the handoff. The final
1000-resource refusal stays after all composed contributions. No tests/runtime work is
authorized.


## Implemented source

`migrations/4900-subledger-disposal-correction-impact.sql` replaces only the private resource
reader. It directly aggregates the two same-book terminal ownership edges from immutable
`subledger_disposals`, their retained reviews and execution receipts. One matching schedule
resource carries the disposal digest, a specific disposal-versus-acquisition detail and
`blocks:true`. It joins the existing resource composition before the unchanged final bound.
No new table, helper, endpoint, contract, resource kind or grant is introduced.

4700's complete tax resource query, optional `taxAccountMatch` metadata, effective usable
state, capacity-based digest and blocking semantics are copied unchanged. Its owner provider
and all earlier resource branches are unchanged. If no disposal matches, the empty added
array leaves the prior resource values and final ordering unchanged. A shared original
basis voucher can identify multiple disposed schedules; each remains explicit. The final
1000-resource refusal applies to the entire composed set, with no truncation.

Existing0410 consumers immediately gain the two edges: impact snapshots display the blocker;
`correction_require_unbound` refuses new standalone preparation; bundle preparation and
approval/execution re-evaluate the current composed basis. Old successful command keys still
return their retained receipts through unchanged owning commands. Currentness changes do
not rewrite stored impact history.4200's shared/deferred/physical financial guards and
terminal correction refusal are untouched.

Existing recognition-voucher resources remain exactly as before; no optional recognition
expansion was added. The path remains `/schedules/:id`. Existing `CorrectionImpactResource`
already supports this schedule kind and optional dependency digest, including4700's
independent optional tax metadata.

## Verification limits

Source diff against the handed-off4700 owner contains only the local result variable,
direct disposal aggregation, composition concatenation and an explanatory comment.
All tax/owner/earlier resource branches and the final1000-resource refusal remain unchanged.
Source whitespace inspection found no trailing whitespace. No TypeScript changed, so no
formatter/type/lint command was needed. No tests/helpers/fixtures, SQL parser/application,
database/runtime exercise, external/provider call, UI or VCS work was performed.
4900 is unapplied and runtime-unverified. Runtime rollback/admission behavior is not proven
by this source inspection.
