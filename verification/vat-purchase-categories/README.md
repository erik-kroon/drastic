# AUT-04 purchase category verification

The investigation and independent boundary/failure expectations are in [the proposal](../../docs/plans/04-vat-purchase-categories.md). ADR 0002 remains research: these synthetic releases do not adopt production tax law or establish deduction entitlement.

The supported opt-in path is a single-line supplier-accrual acceptance with one preexisting independently reviewed VAT fact revision. The server uses the existing admitted VAT profile at the retained tax point, checks exact reviewed rate/deduction and immutable support, and captures the release/category/resolver/support witness in the sealed review. Approval and execution check support revision identity and withdrawal without resolving another rate. Original-key replay returns its immutable receipt after support supersession. Cash-source adoption refuses category opt-in; owner-paid requests keep the legacy treatment input. No UI, live provider, new MCP entry, training or production release is included.

The existing HTTP schema annotation was insufficient to reject nested excess input. The actual group `HttpApi.PayloadParseOptions` annotation now rejects forged supplier witnesses and unsupported owner-paid categories. A valid owner-paid legacy review succeeds before the refusal assertion. Stored/output schemas retain optional witnesses and historical records remain decodable.

Repeat the final application workflow:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra222-verified bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts
```

Narrow reruns:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra222-boundary-rerun bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts -t 'purchase category release boundary'
OPENERP_E2E_ARTIFACTS=test-results/dra222-refusal-rerun bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts -t 'purchase category opt-in refuses'
```

The final HTTP run passed 2/2. `test-results/dra222-verified/vat-purchase-category-boundaries.json` retains both synthetic rates (25% before the boundary; 20% on it), exact treatment, support and release identities, sealed review/posted receipt/export, and later reclassified support. Assertions verify posted supplier hints carry only the stored witness, export no longer reports its stored category as missing, legacy input invents no category, and future activation does not reinterpret the approved treatment.

`vat-purchase-category-refusals.json` retains 17 cases: 13 preparation refusals, three reviews sealed before subsequent withdrawal/supersession, and the unsupported owner category refusal after a valid legacy review. The observed database review count is three and the failed-preparation retained count is zero. No profile/section/category/support, foreign/withdrawn/superseded support, unknown entitlement, source/date/rate mismatches, partial deduction and ambiguous multi-line support refuse. Later withdrawal refuses approval/execution; later supersession refuses execution. Preparation errors are 422 `UnsupportedProfile`; stale sealed support is 409 `StaleDependency`; forbidden request fields are 400 `InvalidRequest`.

Two regression failures were captured before their fixes: `test-results/dra222-request-refusal` records the valid preapproval forged-witness request incorrectly returning 200 after silent stripping; `test-results/dra222-superseded-failure` records a superseded support revision incorrectly authorizing preparation. They are intentionally failed evidence, not final verification.

The final HTTP and deterministic MCP source-integrity artifacts are stable with SHA-256 `da34745b4163555461234f2edb0e89157265486d9764a047d4c18e880ef2ab3b`. Protocol checks passed 3/3 under `test-results/dra222-final-mcp`. The pinned Luna evaluation passed 1/1 (three iterations for each of two cases) under `test-results/mcpjam/aece9ad6-1f85-4e06-b97b-54f673e3e2f2`; its manifest, run, case observations and integrity record are retained.

Repeat the required contract verification sequentially:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra222-final-mcp bun run test:mcp
bun run test:mcp:eval
CHECK_CHANGED_TIMEOUT_SECONDS=180 bun run check:changed:full
bun run check:owners
```

This proves synthetic application behavior and retained evidence. It does not qualify a production Swedish VAT release, observe browser rendering, support cash/owner category resolution, or make unknown statement-mapping/period-bound/dimension captures known. Category identities are never inferred from historical rates or accounts; correction journals without retained VAT reasoning remain unknown.

Final `check:changed`, `check:changed:full`, `check:owners` (53/53 wired leaves) and `git diff --check` passed. Check logs are retained beside the HTTP artifacts as `check-changed.log`, `check-changed-full.log` and `check-owners.log`. All checks ran sequentially; no full application suite or browser run was used.
