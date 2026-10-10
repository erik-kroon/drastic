# Extraction state read evidence

Two real synthetic HTTP workflows reproduced the defects before the owner change: GET timed out while another transaction held only its inbox row lock; GET returned `409 StaleDependency` when a fault-injected mutable inbox binding no longer supplied the captured review basis. Both failed in `before/results.json` (2 failed, 8 unselected).

An intermediate inbox-only repair passed those workflows and the existing runtime-role extraction read/prepare/commit/cancel/replay journey (3 passed, 7 unselected), retained separately in `after/`. A subsequent lifecycle-row lock probe reproduced another timeout before the lifecycle reader was changed (1 failed, 10 unselected in `lifecycle-before/`). The final run passed all four workflows (4 passed, 7 unselected in `final/`). The locked-row GET completes before rollback. The unavailable-basis GET returns the exact retained request, attempt (including its existing diagnostics), and field decisions with `suggestionRecordId: null`, without inserting another suggestion. Preparation against that same unavailable basis still returns `409 StaleDependency`.

The unavailable-basis fixture deliberately clears only `supplier_inbox.draft_id`, then restores it. This simulates inconsistent retained state; it does not claim a public command naturally creates that history. Immutable request, attempt and draft records are not altered. No new diagnostic is inserted into an immutable attempt.

GET uses unlocked inbox and lifecycle readers for its review-basis read and tolerates only typed stale/missing basis failures. Preparation and commit retain their locked strict path. Other errors still propagate. No product screen, provider, schema or catalog description changed; no browser or hardware behavior was verified.

Repeat from the repository root:

```sh
OPENERP_E2E_ARTIFACTS=test-results/extraction-read-before bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'extraction state GET completes|extraction state retains diagnostics'
OPENERP_E2E_ARTIFACTS=test-results/extraction-read-final bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'extraction state GET completes|extraction state retains diagnostics|runtime-role extraction admits'
```

The first command fails only on the unfixed revision. Retained `before/`, `after/`, `lifecycle-before/` and `final/` artifacts contain separate outcomes, source-integrity inventories, lock observations and exact synthetic retained-state projections. The before inventory predates a test-instrumentation refinement that preserves a received HTTP status if a later assertion fails. The unchanged lock failure was a transport timeout with no received response.

Documentation was retained after the behavior runs; source integrity records those runs, not a subsequent documentation-only inventory. Full harness reports and disposable-runtime logs are written under `test-results/extraction-read-{before,after,final}/` and `test-results/extraction-lifecycle-before/`.
