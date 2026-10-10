# Decision question catalog (AUT-09 / DRA-227)

The independent oracle is `docs/operations/automation-decision-vectors.md`, committed before implementation. The two workflows were authored before the domain/catalog implementation. They exercise a real admitted HTTP catalog against disposable synthetic PostgreSQL/API state and isolated protocol arithmetic against the nine independent expected outcomes. No model provider is called.

The catalog exposes the server-authored TRI-SH document-kind taxonomy as a synthetic-only shadow release. Its content digest pins criteria and both builder versions; its option digest pins the declared taxonomy. Caller query parameters cannot replace criteria. Unauthorized and foreign-book reads fail, POST cannot publish a release, and reading the catalog creates no vouchers.

Protocol verification retains full distributions, reported model identity and derived statistics. It refuses missing/extra questions/options, missing distributions, nonfinite/out-of-range probabilities, invalid sums, invalid argmax selections, kind/model mismatches and inconsistent score rubrics. Cardinalities are explicit: 255 choice options and 64 questions are admitted; 256 options and 65 questions are skipped without truncation. Score rubrics require 2–10 levels; choices require unknown/none and nontrivial options. Statistics never grant authority.

The near-uniform tolerance assertion first reproduced negative derived confidence in `test-results/dra227-confidence-failure`. Derived choice confidence is now bounded to [0,1], while the provider distribution remains unchanged. The nine authored gold outcomes were preserved.

Repeat the focused verification:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra227-final bun run test:e2e \
  apps/api/tests/decision-questions.e2e.test.ts
```

The narrow arithmetic regression command is:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra227-protocol bun run test:e2e \
  apps/api/tests/decision-questions.e2e.test.ts -t 'independent protocol vectors'
```

The successful artifact directory contains `results.json`, `junit.xml`, `decision-question-catalog.json`, `decision-protocol-vectors.json` and `source-integrity.json`. It records nine expected/observed positive vectors, 14 response refusals, four invalid requests, five invalid scores, cardinality outcomes and the unchanged near-uniform distribution. The retained run passes both workflows and has stable source inventory SHA-256 `dd40dc3c5fd0f30d1f6f80eae68bf7fed3115230d2420afca75ae9430ee82670`.

This is a catalog and structured protocol boundary. Typed maps cannot detect duplicate raw JSON keys after those keys have already collapsed; the server taxonomy is unique and AUT-10 owns duplicate-key rejection before wire decoding. There is no provider adapter, persisted result, queue, live option/state builder, suggestion, mandate or production qualification in this slice. Provider-reported confidence is retained separately from derived statistics; neither is empirical accuracy. No MCP catalog/schema, browser behavior or UI changes were introduced.
