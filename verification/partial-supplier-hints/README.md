# Partial supplier hints

The owner already compared exact account/rate dimensions, including rational cross multiplication. It always reported the whole treatment as not comparable, and the shared classifier rejected partial coverage before considering an observed correction. A cited hint now records `changed` when any reviewed line contradicts the suggested account or rate; the shared classifier accepts that observed correction. Partial equal treatments remain `unknown_exposure`; uncited exposure remains conservative.

Sealed exports add optional inventory/exported classification counts. Older sealed exports can omit these counts. The offline report keeps the existing baseline as `descriptive_nonrepresentative`, adds independent/corrected populations and marks corrected cases `representative:false`. Independent representativeness is also not established by these synthetic cases. Unknown consequential accuracy remains `{numerator:0,denominator:0,value:null}`.

Failure expectations and the HTTP workflow preceded product edits. Initial fixtures proved VAT disagreement incorrectly persisted unknown and report populations absent, but a one-line seed could not suggest for a two-line account case due to the intended description filter. That zero-hint account case is not a reproduced correction defect. The intermediate after run passed two regressions and failed that fixture expectation; its evidence remains separately retained.

The refined fixture uses two source lines throughout, checks the served top account/rate before approving and posts all decisions after serving their hints. Its before artifact observes independent/unknown/unknown/unknown. The report assertion fails on missing populations while retained actual rows prove the cited account and VAT corrections were unknown. The implemented same-surface run observes independent/unknown/corrected/corrected and passes separate counts, VAT-only changed dimension, semantically equal `1/4` versus `25%`, partial-unchanged, foreign authority and rollback assertions.

Repeat on preimplementation/implemented source respectively:

```sh
OPENERP_E2E_ARTIFACTS=test-results/partial-supplier-hints-cited-before bun run test:e2e apps/api/tests/decision-provenance.e2e.test.ts -t 'partial supplier hints distinguish'
OPENERP_E2E_ARTIFACTS=test-results/partial-supplier-hints-cited-after bun run test:e2e apps/api/tests/decision-provenance.e2e.test.ts -t 'partial supplier hints distinguish|empty supplier hints preserve|supplier approval refuses foreign citations'
```

Before: 1 failed, 6 unselected; stable source hash `21c89ca5ff58a72575d982e570dee20399fcd0079ea5a07389f26d49136407e1`. After: 3 passed, 4 unselected; stable behavior-run hash `26f68a56f02fd0d47083956c15a414ffd2be7d2418e15b832e444d5a4dfa9449`. Each artifact retains actual suggestion IDs/options, approval IDs, provenance, sealed exports, independent/corrected report populations, results and source-integrity inventory. Earlier distinct artifacts are `partial-supplier-hints-before`, `-report-before`, `-posted-before` and `-after`.

A subsequent test-array type annotation changes no executed behavior. Focused type-aware lint passed. Final changed checks and clean full qualification are recorded by the parent checkpoint. The report script has no dedicated tsconfig; it is linted/formatted and exercised through the real HTTP CLI workflow. No model accuracy, representative corrected accuracy, statutory qualification, browser parity or provider execution is claimed.

Legacy sealed-export omission compatibility is source-inspected through the optional schema, not separately exercised by a retained HTTP-seeded old export. Selected before/after observations and intermediate fixture outcomes are retained alongside this README; generated runtime directories remain in `test-results/`.

Clean source `c69e875` against pinned main `ff21273` passed full changed checks, owners (55/55) and design contract with tracked status clean. Three deterministic MCP workflows and the pinned Luna eval test passed. MCP result/source-hash summaries are retained; full generated inventories remain reproducible under the documented `test-results/` commands. The report CLI is linted/formatted and HTTP-exercised, without a dedicated tsconfig. No model evaluation accuracy, visual parity or production qualification is claimed.
