# Decision examples (AUT-02 / DRA-220)

An operator seals an export with `POST /v1/entities/:entityId/books/:bookId/automation/decision-examples`, an idempotency key and `{ "purpose": "training", "selectedDecisionIds": [] }`. An empty selection means the complete recorded inventory. GET of its returned ID reads the immutable sealed revision. Training here names an evidence export; no training or external data flow occurs.

The seal uses one PostgreSQL statement snapshot for inventory, retained reviews, source evidence, served options and reachable committed correction lineage. It never joins current account or counterparty heads. The original decision cutoff is distinct from the export lineage cutoff. Builder versions name current projections of retained snapshots, not builders claimed to have run historically. Missing captures are explicit exclusions or missing facts. Future provenance stamps its capture version and extraction review basis; old rows are not backfilled.

Supplier review snapshots produce useful exact journal/treatment examples even when no suggestion was served. Options distinguish no recorded exposure, served options only and uncited exposure; none claims the complete historical chart universe. Uncited options remain explicitly missing rather than becoming evidence of independence. Correction journals relabel the chosen journal without inventing replacement VAT reasoning. Reversal without replacement excludes the original. Payroll and employee inventories are counted using metadata without reading payloads; personal replacement payloads are similarly fenced. Included document text and descriptions are sanitized for Swedish personal identity numbers; exact typed financial strings remain unchanged. Other free-form data is omitted.

Evaluation permits only independent/corrected provenance. Explicitly selecting any other class refuses the seal. Complete inventory evaluation records counted exclusions. Exports retain per-example digests, source/redacted digests, lineage references, inventory digests and denominators.

To export an existing sealed revision using its admitted HTTP operation:

```sh
OPENERP_API_URL=http://127.0.0.1:8787/api OPENERP_OPERATOR_TOKEN=... node verification/decision-examples/export.mjs ENTITY BOOK EXPORT_ID OUTPUT_DIRECTORY
```

The output directory must exist. Credentials stay in the process environment and are never written to JSONL or the manifest. The script writes `examples.jsonl` and `manifest.json`; repeating the same revision yields identical output. Use isolated synthetic records for local verification. Production training, consent and providers are outside this issue.

Supported bank matching examples retain their predecision row basis and immutable selected ledger identity. An immutable exact-match withdrawal excludes the label before any journal reversal; bank matching never borrows a current row to reconstruct its original state. Voucher metadata is deduplicated before aggregation when supplier and bank roots overlap.

When both a journal reversal and match withdrawal exist, the pinned projection reports `reversed_without_replacement` as its primary reason. The sealed lineage inventory retains both immutable evidence links.

Focused synthetic verification uses `bun run test:e2e` with the decision-examples, document-reader, employee-claims, variable-pay-review, decision-provenance, supplier-extraction, period-work-batch and sie-historical-owners files. Retained artifacts are under `test-results/dra220-final`; its sole CLI mount-path failure is superseded by the passing `sealed decision examples` rerun under `test-results/dra220-seal-final`, including identical `examples-one` and `examples-two` JSONL/manifests. The uncited-exposure assertion is retained separately under `test-results/dra220-uncited-final`.

Repeat the focused cases on a fresh disposable runtime:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra220-final bun run test:e2e \
  apps/api/tests/decision-examples.e2e.test.ts \
  apps/api/tests/document-reader.e2e.test.ts \
  apps/api/tests/employee-claims.e2e.test.ts \
  apps/api/tests/variable-pay-review.e2e.test.ts \
  apps/api/tests/decision-provenance.e2e.test.ts \
  apps/api/tests/supplier-extraction.e2e.test.ts \
  apps/api/tests/period-work-batch.e2e.test.ts \
  apps/api/tests/sie-historical-owners.e2e.test.ts \
  -t 'sealed decision examples|evaluation explicitly refuses|committed correction relabels|decision example projection preserves|R40 retains three outcomes|retained unknown absence|bank exposure|runtime-role extraction admits|approved period batch recovers aggregate|SIE multi-member chunk'

OPENERP_E2E_ARTIFACTS=test-results/dra220-seal-final bun run test:e2e \
  apps/api/tests/decision-examples.e2e.test.ts -t 'sealed decision examples'

OPENERP_E2E_ARTIFACTS=test-results/dra220-uncited-final bun run test:e2e \
  apps/api/tests/decision-provenance.e2e.test.ts -t 'bank exposure'
```

Each run retains `results.json`, `junit.xml`, source-integrity checks and synthetic evidence artifacts. Reusing an artifact directory replaces its previous run; copy retained evidence first if it must be preserved.
