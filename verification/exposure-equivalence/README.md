# Exposure equivalence across subject revisions

Owner review bug 7 only. A currently authorized citation accounts for earlier same-book, same-actor, same-subject exposure when the stored option-set digests match, even when the subject revision digests differ. Earlier different options remain uncited and produce `unknown_exposure`. The fix changes the exposure lookup's subject comparison from revision digest to stable subject identity. Direct citation authorization and freshness validation are unchanged.

The synthetic HTTP journey discovers row B, advances the bank source with an unrelated non-overlapping statement, refreshes B, and matches using its fresh citation. Before the fix this produced `unknown_exposure`; afterward it produces `accepted_unchanged`. A separate case consumes another row's candidate before refreshing B, retaining a different option-set digest and `unknown_exposure`. An equal-option capture for a different bank row remains forbidden, and directly citing the old B capture remains stale.

## Repeatable proof

```sh
OPENERP_E2E_ARTIFACTS=test-results/pr20-exposure-before bun run test:e2e \
  apps/api/tests/decision-provenance.e2e.test.ts \
  -t 'bank exposure equivalent options across revisions'

OPENERP_E2E_ARTIFACTS=test-results/pr20-exposure-after bun run test:e2e \
  apps/api/tests/decision-provenance.e2e.test.ts \
  -t 'bank exposure equivalent options across revisions|bank exposure derives unchanged|same bank subject stale citation'
```

Before: one selected workflow failed at the unchanged-option label assertion, with stable hash `0bf5f663b22ad71754752669806628f17fb59b4fadc6cc7018d62642d8222310`. After: three selected workflows passed and three were unselected, including existing foreign-book/actor/session authorization and stale-citation checks. [observed.json](observed.json) derives capture IDs, identities, option/revision digests and actual decision provenance from the after artifact; it retains that run's stable source hash.

The harness uses disposable PostgreSQL and the Worker HTTP application. No history backfill, schema or UI change, provider call or browser qualification is part of this slice. The focused results prove these bookkeeping label boundaries, not independent accounting accuracy or model qualification. Changed-file and clean-commit checks are recorded separately by the owner checkpoint.
