# Independent verification-coverage expectations (AUT-06)

These authored expectations precede implementation. Coverage records retain book, frozen period boundaries, cutoff/ledger sequence, builder version and evidence identities/digests. Retained check outcomes and current dependency freshness are separate facts. An old passing record cannot establish current coverage after its dependencies change.

| Synthetic evidence inventory | Required observation |
| --- | --- |
| Check has never run | `not_run`, never pass |
| Arithmetic reconciles to zero but an expected statement/item is missing | Missing/incomplete coverage, never pass |
| Complete bank reconciliation, full retained period, zero unresolved items and admitted independent evidence | Pass for that declared bank check only |
| Later source revision changes the reconciliation dependency digest | Original record unchanged; current freshness stale |
| Ledger change relevant to the frozen period occurs after the check cutoff | Current freshness stale; no automatic promotion |
| Unrelated later-period event leaves the declared dependency inventory unchanged | Freshness follows actual dependency rules, not a blanket global sequence guess |
| Bank statement continuity or account mapping is incomplete | Missing with retained reason/evidence identity |
| Tax control arithmetic has zero difference but owner declares coverage `not_established` and reconciled false | Never pass, never financial-close-ready |
| No independent supplier/customer statement reconciliation owner exists | `not_run` or explicit unsupported/missing, never inferred from internal ledger totals |
| A record refers to another book or mismatched period/evidence | Admission refusal; no usable coverage record |
| Same command key and identical frozen inventory is retried | Same immutable record; no duplicate evidence claim |
| Same key carries changed inventory/period | Conflict; original record retained |

The public artifact retains source reconciliation/control receipts, check states, denominator/coverage facts, dependency digests and the stale-versus-retained distinction. It proves zero difference is insufficient when coverage is incomplete. No aggregate `ready` claim can silently omit an unsupported required check.

Coverage initially supplies evidence to future mandate conditions; it does not invent a new mandate requirement, relax existing authority, post, file or make a legal close assertion. Unsupported independent evidence remains visible. Synthetic mechanism verification is separate from production qualification.
