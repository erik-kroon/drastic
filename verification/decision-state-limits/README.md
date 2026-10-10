# Decision model release limits

Each configured adapter retains `inputTokenLimit` in its identity evidence. Clef pins 64000 and Clef-flash pins 24576; hosted configuration cannot change either. The local fixture defaults to authored 24576. Self-hosted Clef and Jev require `OPENERP_DECISION_MODEL_INPUT_TOKEN_LIMIT`, an explicit positive safe integer; their windows are not guessed. Disabled mode ignores limit configuration. Direct adapter construction also rejects missing/invalid limits. These constraints are unrelated to quota, billing or weight qualification.

The adapter conservatively bounds the complete `JSON.stringify` request's UTF-8 bytes by that numeric ceiling, both before AUT28 sanitisation and on the actual outgoing envelope. This is a byte bound, not a tokenizer or a measured token count. Questions, criteria, model and structured state all count; the admission-only string representation of structured AiState is not used as the outgoing wire envelope. No trimming, fallback or retry occurs. Valid reported `usage.input_tokens >= inputTokenLimit` also refuses with `state_limit`. Every model identity remains `releaseQualification:unsubstantiated`.

`failure-contract.md` and the two new workflows were authored before implementation. The real loopback before run retained eight observed outcomes: all dispatched once and were validated, including oversized requests and reported usage at/above the bound. The authored binding before run retained both hosted oversized dispatches and missing/invalid manual-limit acceptance. The assertions failed, but the complete observations were persisted before assertions.

```sh
OPENERP_E2E_ARTIFACTS=test-results/decision-state-limits-before bun run test:e2e apps/api/tests/decision-model.e2e.test.ts -t 'decision state limits'
OPENERP_E2E_ARTIFACTS=test-results/decision-state-limits-after bun run test:e2e apps/api/tests/decision-model.e2e.test.ts
```

Before: 2 failed, 2 unselected; stable hash `c5388227f4398f8659df08c6a05462d5fbaee643d201e1cb831c524bbd9c6f4e`. After: all 4 workflows passed; stable hash `39d14ed92d554045d29755c1fbb1c254f2c13d9b79841f710e84dd397c0ecc12`. Exact-byte and usage-below cases remain validated. One-byte-over, multibyte Swedish, question-envelope overhead and post-tokenisation growth each refuse with zero HTTP calls; reported usage at/above refuses after exactly one response. Both hosted oversized binding cases have zero calls. Existing timeout, abort, wire-validation and binding regressions still pass.

Artifacts retain expected/observed typed outcomes, complete request byte sizes, limits, identity metadata, dispatch counts, result counts and stable source-integrity inventories. Prompt content and credentials are not retained by the new limit artifacts. The second workflow uses an authored local binding, not a Cloudflare live call or hosted weight qualification.

Focused type-aware lint passed. The dirty-tree changed check failed on the existing `apps/api/src/adapters/ai-egress.ts` import of `node:crypto` (TS2591; API tsconfig admits only Cloudflare worker ambient types); owned test types passed. The parent coordinates upstream integration and clean full/owners/design qualification. This private adapter identity/config change does not modify MCP catalog schemas or descriptions. No provider invocation, deployment or production qualification is claimed.
