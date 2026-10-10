# Monthly close predicate. Synthetic evidence

This implementation captures one immutable aggregate observation over an existing exact calendar-month period. HTTP capture is operator-only; HTTP and MCP reads reuse the same application owner and perform no writes. Retained outcomes are separate from live freshness. The required `vouchers_supported` and `facts_complete` owners remain not established, so these fixtures never qualify a month as done. Outside checks are diagnostic only.

The selected corrected aggregate architecture is recorded in [synthesis.md](synthesis.md). The judge originally preferred the separate-check candidate; [judgment.md](judgment.md) retains that disagreement and the mandatory corrections. These files describe design, not runtime proof.

Each operation establishes repeatable read before admission and composes the existing bank/VAT transaction-taking readers. Whole-transaction retries are bounded to the existing TransactionRetry error. Exact command replay returns the original observation; a GET independently rechecks owner freshness. The canonical attention scope includes period work and undated documents. Question scope conservatively covers all book-wide latest question revisions; answered-but-unclosed questions remain unresolved. Only immutable metadata is digested, without question/answer text. Missing heads make the inventory unestablished.

Bank freshness preserves the existing global sequence dependency of whole inventory/source coverage and the period-end dependency of each capacity reconciliation. Digest keys named `retained...` identify original owner witnesses; they do not claim to be newly observed current hashes. Actual reconciliation checkpoints, owner currentness, and `observedBookSequence` distinguish current observations. VAT preserves the existing actual-return owner currentness rules. No accounting arithmetic is duplicated.

## Repeat the workflows

Run sequentially from this checkout, with its frozen dependencies:

```sh
OPENERP_E2E_ARTIFACTS=test-results/close-predicate-qualification bun run test:e2e apps/api/tests/close-predicate.e2e.test.ts
bun run check:changed
```

The suite starts a disposable PostgreSQL/Worker runtime. It uses public synthetic commands and explicitly seeded synthetic VAT qualification. It exercises exact month bounds, whole bank inventory, missing mappings/statements/continuity, concurrent exact-key replay, changed-key-payload conflict, foreign/month identity refusal, immutable grants, separate live bank/VAT freshness, open questions, actual zero tax control, and read-only HTTP/MCP row-count stability including receipts and queues. It does not invoke live providers or submit statutory reports.

## Retained worker results

| Artifact directory | Observed result | Stable source inventory hash |
| --- | --- | --- |
| `test-results/close-predicate-before` | 0 passed / 2 failed: absent GET/POST route | `f5e22419f5a65cc845cbabba0b0feace5e59b1f2ce14a5882769760447ef5fb1` |
| `test-results/close-predicate-missing-before` | 0 passed / 1 failed: real missing-source report reached absent capture route | see its `source-integrity.json` |
| `test-results/close-predicate-after` | 2 passed / 1 failed: bank and missing-bank workflows passed; VAT stopped on omitted required synthetic statement fields | `d78ed4254441000f2af3c581a43695fed23ae71499a8fe1bb3ea6e24a98bd155` |
| `test-results/close-predicate-vat-after` | 1 failed / 2 unselected: metadata reader incorrectly assumed bare digest format | `1bf81146cd0e4efea6e427963fda4fd56c78978e29545915ad600bdb837cc71e` |
| `test-results/close-predicate-vat-final` | 1 failed / 2 unselected: metadata reader incorrectly assumed a stored digest on QuestionEvent | `f8b1cd2ebc28d7e9289bc5fe6ed05be4e22dd304297ab744ea3e37d9a778eda8` |
| `test-results/close-predicate-vat-verified` | 1 passed / 2 unselected, including actual zero tax control and VAT stale/failed observations | `00369453b271ab7b4e52354a22f3e9dc109b0f8020e79a19a4ec5ee5aa508987` |

Each directory retains results, source-integrity and runtime logs; successful workflows additionally retain their JSON observations. The tax owner produced exact zero closing difference, `coverage: not_established`, and `reconciled: false`; no close-ready claim follows from zero arithmetic. The first missing-bank failure occurred before later continuity cases, so that before-run alone does not prove those cases.

Final worker `bun run check:changed` passed after explicit freshness-metadata edits. Those edits postdate the worker behavior hashes above; clean committed three-workflow qualification, full/owners/design checks and required global MCP/pinned Luna evaluation are coordinated separately by the parent. Final clean qualification is recorded below.

No browser rendering, UI parity, production close, statutory validity, live provider or unavailable owner qualification is claimed. The new MCP read-selection evaluator is authored but not run by the worker. Existing upstream protocol-matrix skips remain unchanged.

## Clean-source optional-field correction

The parent clean committed run at `c43d8a3` failed all three workflows at capture with HTTP 500. Its retained `test-results/close-predicate-qualified` artifact and `/tmp/aut06-clean-e2e.log` identify a present `observedBookSequence: undefined` on unavailable check freshness, which strict `Schema.optionalKey` correctly rejects. The correction omits the optional property when no current book sequence was supplied; it does not relax the wire schema. This clean failure is the before-fix reproduction. The corrected clean runtime qualification follows below.

## Clean runtime qualification

The corrected committed source at `614879d` passed all three workflows. Test-only commit `ff39478` then retained the independent bank owner receipts, freshness digests and observed book sequences, asserting those sequences against persisted state. The final clean `test-results/close-predicate-retained` run passed three workflows with stable inventory `e00efa81a3be174085464b641dd4929728dda09fc44b48d406d85bf756dda051`. [after](after/) retains the complete observations/results. [clean-failure.json](clean-failure.json) and [before](before/) retain the actual failures separately.

MCP admission passed at `614879d` with two unchanged upstream protocol cases skipped. The subsequent test-only commit changes no runtime/catalog; [mcp](mcp/) retains that result. Pinned `gpt-6-luna` through the Codex proxy passed three iterations each for ledger read, approval refusal and month-close read, one Vitest suite, at `ff39478`. [mcp-eval](mcp-eval/) retains run `a5a89923-8975-4ca2-806b-130092008f62` and its stable final source inventory. This tests tool selection, exact scope and persisted-state nonmutation; it does not qualify the skipped protocols or production providers.

Frozen installation passed in the clean worktree. The final proof commit runs `check:changed:full`, `check:owners` and `check:design` against base `6e2a0ae5c5d88ac40381254a45ba8b6a23d72110`; their exact verdicts and commit are recorded in [draft PR 32](https://github.com/erik-kroon/drastic/pull/32). Static design-contract checks are not visual parity. The [read-only code review](comment-review.md) found zero actionable comment/suppression/workaround findings. Thirty-two retained JSON files passed the credential scan. No live financial provider, real book, browser composition, baseline or statutory qualification.
