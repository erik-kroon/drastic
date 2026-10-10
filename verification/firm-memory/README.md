# Firm memory (AUT-05 / DRA-223)

`firm_memory_v1` replaces the latest-five SQL with a retained-snapshot projection and deterministic ranking. Book, counterparty, owner-derived document kind and currency/scale are hard filters. Description matching is NFC, whitespace-collapsed and lowercase exact matching. Integer amount-band distance (100 currency units), descending original receipt sequence and codepoint decision ID determine rank; at most five precedents are served. The history digest includes immutable provenance and correction inventory, excluding new suggestion-serving records.

Each precedent retains original decision cutoff, receipt/label sequences, source decision/document identities, correction lineage, provenance, chosen journal and known/unknown consequence evidence. A committed correction replaces the journal, clears compatibility tax hints and retains explicit missing VAT reasoning. Reversed records without replacement are excluded and counted by the shared AUT-02 projector. Current account/counterparty heads never reconstruct supporting history. The live target is its admitted exact draft revision.

The existing HTTP suggestion endpoint returns full precedents and compatible legacy items. Its AUT-01 record stores both the full ranking and the exact flattened/deduplicated legacy items; approval compares the items actually returned and retains partial coverage. This is request/owner integration: browser rendering or visual parity of new precedents was not verified. Old sealed exports and suggestion records remain decodable; new examples use schema `decision_examples_v3` and the memory version.

## Repeatable verification

The failure expectations were authored first in `docs/operations/automation-memory-vectors.md`, followed by the two workflows in `apps/api/tests/firm-memory.e2e.test.ts` before owner implementation.

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra223-focused bun run test:e2e \
  apps/api/tests/firm-memory.e2e.test.ts \
  apps/api/tests/decision-provenance.e2e.test.ts \
  apps/api/tests/decision-examples.e2e.test.ts \
  -t 'same-book firm memory|independent firm memory vectors|empty supplier hints|sealed decision examples preserve'

OPENERP_E2E_ARTIFACTS=test-results/dra223-serving-final bun run test:e2e \
  apps/api/tests/firm-memory.e2e.test.ts -t 'same-book firm memory'
```

The first run passed the independent vectors, existing Swedish suggestion/provenance journey and public bank/manual-voucher reversal export journey (three workflows); the new serving journey failed at the standalone CLI import. A narrow rerun then exposed its missing `/api` routing prefix. The final affected workflow passed after both CLI fixes, including public serving/repeat/foreign-book isolation, public supplier correction, and the sealed-export baseline. The owner source remained stable in both retained runs with SHA-256 `8d25b40d55a81832e9c059b8366095d29096652afa2a4bc8b46519558a930c1a`. This is the behavior-run source hash. Subsequent type hardening validates the already observed SQL string cutoff with `MinorUnits` and makes test ID comparison explicit; those unchanged valid-input behaviors were not rerun at the final source revision. Final `CHECK_CHANGED_TIMEOUT_SECONDS=180 bun run check:changed`, `CHECK_CHANGED_TIMEOUT_SECONDS=180 bun run check:changed:full`, and `bun run check:owners` passed (55/55 wired leaves). The standalone CLI is linted/formatted and exercised by the public workflow; no tsconfig covers it.

Artifacts: `test-results/dra223-focused/firm-memory-vectors.json`, `test-results/dra223-serving-final/firm-memory-serving.json`, and `test-results/dra223-serving-final/firm-memory-baseline/report.json`, with `results.json`, JUnit and `source-integrity.json` in each directory. Results are synthetic only. The baseline has two eligible targets, one suggested target, zero known comparable consequences, zero correct consequences and two unknown consequences. Coverage is 1/2; consequence accuracy is unavailable (0/0). The isolated preauthored known-consequence vector demonstrates 1/1 comparison arithmetic; it is not production K2 qualification. A correction committed after a target cutoff is excluded as `later_label`, rather than importing its future label or reverting to an obsolete original.

To report an already sealed export through admitted public HTTP:

```sh
OPENERP_API_URL=http://127.0.0.1:8787 \
OPENERP_OPERATOR_TOKEN=synthetic-session-token \
  bun verification/firm-memory/report.ts ENTITY BOOK EXPORT OUTPUT_DIRECTORY
```

The directory must exist. The CLI uses the server-origin `/api/v1` route, verifies scope, and records the sealed export identity/digest, input denominators/exclusions, temporal targets and source decision IDs. It neither reads PostgreSQL directly nor performs training. Evaluation targets are only independent/corrected; unknown consequences are never counted correct, and zero denominators are `null`. Entire related document/correction groups are excluded from each target's history.

No real data, live providers, production VAT/K2 adoption, training, deployment, UI changes or MCP catalog/schema changes are included. The current captured supplier consequences remain unknown where mapping, dimension, period or category evidence is unavailable. Compatibility hints require retained reviewed account/rate facts; generic corrected journals never borrow original VAT. The existing supplier standalone-reversal gate is preserved; actual reversal exclusion is verified through its supported bank/manual-voucher owner.

Versioned v2 matching, common-population side-by-side reports and synthetic recall evidence are documented in [firm-memory-v2](../firm-memory-v2/README.md). The v1 algorithm and historical sealed snapshots remain supported.
