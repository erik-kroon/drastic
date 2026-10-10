# Extraction review bounds and capture resilience

Synthetic owner-review bug 5 only. No provider calls, visual changes, production qualification or history rewrites.

The raw extraction contract admits 64 header fields and 50 lines with 16 fields each. The shared derived review/capture maximum is therefore 864. Native text currently supports seven header fields and nine fields per line; the compact source fixture supplies eight cells per line to stay inside the existing retained-attempt byte guard. It produces 457 merged fields and 407 native-derived options. The ordinary preview still serves seven header options because its existing line mapping is empty. The test host captures the native-derived options against that exact prepared subject; the public review cites that record and seals the retained decision inventory. Native attempts are hash-only and lack the transcript required by the example exporter; all 457 native decisions are therefore counted as `source_text_not_captured`, with zero native training examples. This does not claim the ordinary preview renders 407 options.

All suggestion sources are schema-validated before insertion. A legacy suggestion capture that fails its schema is counted as `undecodable_capture`; other retained review, correction and document schemas remain strict. The malformed legacy fixture appends a synthetic capture and provenance reference without changing original decisions or posted financial history.

## Before evidence

- `test-results/pr20-extraction-before-isolated`: fully unfixed public native preparation returned 500 for 457 merged fields; one failed workflow, seven unselected. Stable source hash `4bb270d418980f072247c1b82c525ed38717a8d6929c6f3276d543d91cae2474`.
- `/Users/admin/drastic/test-results/pr20-extraction-before-diagnostic`: the separate legacy-capture workflow recorded public export 500 and four schema-invalid source variants being inserted. Stable source hash `d8a4ec8f6d9b45d67d2941402a7ecc95f5f41b93b5aa4d144d33ec69df305ee1`. This predates the corrected sparse native fixture; its other workflow stopped at the unchanged attempt byte guard.
- `test-results/pr20-extraction-record-bound-before-v2`: supplemental boundary proof with only the provenance contract restored to its HEAD 400-option bound while the merged-field fix remained. The real retained native-derived capture failed at `ranked.options`. One failed workflow, seven unselected; stable hash `cb7d2ca54990430c1a1b4d89e1122f273f212806101381bc4fb71a1933577be8`. It is not a fully unfixed-tree claim.

Earlier diagnostic runs are retained separately; they are not passing evidence.

## Repeatable focused command

```sh
OPENERP_E2E_ARTIFACTS=test-results/pr20-extraction-final bun run test:e2e \
  apps/api/tests/supplier-extraction.e2e.test.ts \
  apps/api/tests/decision-provenance.e2e.test.ts \
  -t 'bounded native extraction|suggestion variants reject invalid captures|bank exposure derives unchanged|empty supplier hints preserve independent'
```

The harness creates disposable PostgreSQL and a Worker HTTP runtime. Artifacts retain preparation, committed review, export, invalid-insert counts, source integrity, test results and ordinary bank/supplier regression evidence. No browser rendering or visual parity is asserted.

## After evidence

- `test-results/pr20-extraction-final`: three workflows passed (bank positive capture, supplier positive capture, and invalid-capture/export resilience); the native workflow reached its existing missing-transcript boundary and failed its overbroad training-export assertion. Stable hash `f58502cd71df413992ec489637bb2ecf0d6ac995d2b1a1d8673d12bbe257fb60`.
- `test-results/pr20-extraction-native-final`: the corrected native eligibility assertion passed; one selected workflow, seven unselected. Stable hash `704e53be3452102318421c00be96e52d08af76fb6f9a6225ed3992e4b2260f9b`. Only the failed native workflow was rerun; the other three passing workflows were not repeated.
- [observed.json](observed.json) is derived from those retained artifacts: 457 committed fields, 407 captured native options, 457 missing-text exclusions; the malformed-capture seal exported one valid example and counted one `undecodable_capture`; all four invalid source variants left row counts unchanged at zero.

Narrow rerun:

```sh
OPENERP_E2E_ARTIFACTS=test-results/pr20-extraction-native-final bun run test:e2e \
  apps/api/tests/supplier-extraction.e2e.test.ts -t 'bounded native extraction'
```

`CHECK_CHANGED_TIMEOUT_SECONDS=180 bun run check:changed` passed before the final focused run. The later changes refine the native failure assertion/artifact only; production code stayed unchanged. Oxlint and whitespace preflight passed.

Clean worktree HEAD `111f1e9`, against main `8cc665e`, passed `check:changed:full origin/main`, `check:owners` (55/55) and `check:design origin/main`; tracked status stayed clean. MCP state/preparation outputs expose the changed bounded schemas. Deterministic MCP passed 3/3 in `test-results/pr20-extraction-mcp`; pinned Luna evaluation passed 1/1 in `test-results/mcpjam/3ad212d9-2437-473e-9cbe-97d01efed133`. Logs are `/tmp/pr20-extraction-clean-{full,owners,design}.log`, `/tmp/pr20-extraction-mcp.log` and `/tmp/pr20-extraction-mcp-eval.log`. These checks do not qualify browser parity or a live provider.
