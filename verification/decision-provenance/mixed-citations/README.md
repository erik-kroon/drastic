# Mixed supplier citations

A real supplier HTTP workflow observes a hint, posts another invoice, observes a second hint for the unchanged target draft, then approves with both citations. The first comparison is partial and not comparable; the second records an account correction. Nothing injects suggestion rows or comparison results.

At `849b385`, the E2E failed: expected `unknown_exposure`, received `corrected`. The report counted one corrected example. At `73be9ad`, all eight provenance workflows passed. The mixed approval and sealed export record `unknown_exposure`; both independent and corrected report counts are zero. A single changed partial hint remains corrected in the existing passing workflow. Both runtime inventories stayed stable.

```sh
OPENERP_E2E_ARTIFACTS=test-results/mixed-citation-before-real bun run test:e2e apps/api/tests/decision-provenance.e2e.test.ts -t 'mixed changed and incomparable supplier citations retain unknown exposure'
OPENERP_E2E_ARTIFACTS=test-results/mixed-citation-after bun run test:e2e apps/api/tests/decision-provenance.e2e.test.ts
```

The initial helper invocation failed before classification assertions; it is not the failing reproduction above. The changed check's initial 60-second TypeScript deadline expired without diagnostics; its retry with `CHECK_CHANGED_TIMEOUT_SECONDS=180` passed. Final integrated clean-worktree static checks remain pending. These observations qualify synthetic implementation only, not production accounting or visual parity.
