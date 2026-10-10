# Firm memory v2

V1 `rank` and `baseline` remain available with exact normalized description matching. V2 uses a separately versioned exact nonempty token-set key: NFC/lowercase Unicode letters, full Swedish/English month lexicon, numeric/date token removal and whole English/Swedish ordinal removal (`31st`, `1st`, `1:a`, `2:e`). Order and duplicate words do not matter. Changed remaining words reject; there is no fuzzy score.

The shared book/counterparty/kind/currency/scale, related-lineage, cutoff and missing-fact guards remain unchanged. Both baseline algorithms use the same raw target eligibility population. An empty v2 key yields no suggestion and remains an unmatched raw-eligible target; it cannot shrink coverage denominators. Amount-band distance, receipt recency and ID tie ordering remain unchanged.

Supplier serving pins v2 in the context digest, response and immutable `firm_memory_v2` capture. V1 capture decoding and comparisons remain supported. Fact projection/capture schema versions and old sealed exports are unchanged. New comparisons retain the existing partial corrected/unknown semantics. The report evaluates the same frozen corpus with both algorithms, overall and within independent/corrected populations; corrected remains nonrepresentative and unknown consequential accuracy remains null.

Failure expectations and public/corpus tests preceded product implementation. The first public run failed because its Swedish preparation fixture lacked BAS payable/input-VAT accounts; this is not the defect. The corrected unfixed run completed valid legacy citation and exports, then failed missing monthly recall: `test-results/firm-memory-v2-recall-before`, 1 failed/3 unselected, stable hash `1c3258ab879150ecfbe1d6288099c3e867276a775903cab850742b58f3cc8e51`.

The first after run passed 4 and failed the new correction assertion: a manual-profile seed supplied no account hints. The fixture now uses public Swedish preparation/execution; no product rules changed for that prerequisite. Review also found that the initial v2 empty-key eligibility implementation could shrink the denominator. The existing corpus assertion was strengthened before correcting it; `firm-memory-v2-denominator-before` retains the failure (eligible2 versus0), stable hash `c774f6b0b6a75ee0f048c77ae70a93a4f09ec698c4dc8bbbb7314a315136a8a3`.

```sh
OPENERP_E2E_ARTIFACTS=test-results/firm-memory-v2-recall-before bun run test:e2e apps/api/tests/firm-memory.e2e.test.ts -t 'public monthly firm memory v2'
OPENERP_E2E_ARTIFACTS=test-results/firm-memory-v2-denominator-before bun run test:e2e apps/api/tests/firm-memory.e2e.test.ts -t 'independent v2 token corpus'
OPENERP_E2E_ARTIFACTS=test-results/firm-memory-v2-final bun run test:e2e apps/api/tests/firm-memory.e2e.test.ts apps/api/tests/decision-provenance.e2e.test.ts -t 'firm memory|independent v2 token corpus|partial supplier hints distinguish|empty supplier hints preserve'
```

Final: 6 passed/5 unselected, stable behavior-run hash `b17cbc8b6885ca081d1c4b8059a66276086574c70a0734e51617d11354637f5e`. Eight token vectors, nine hard-filter variants and deterministic ties pass alongside the unchanged v1 oracle and public correction/partial-hint journeys. The actual sealed public corpus has two eligible targets for each algorithm: v1 suggested0, v2 suggested1; both have no known consequential comparisons and accuracy0/0:null. These are synthetic recall observations, not production/model accuracy.

The legacy proof appends an explicitly authored, valid retained v1 capture from real exact-match facts, then cites it through public approval and checks original ID/body/option digest unchanged after v2 serving and sealing. It is not claimed to be a historical pre-upgrade public serving run. The old sealed snapshot is read after later operations and remains exactly equal. The registry same-input ID fixture was corrected before implementation; stable IDs are a previously shipped invariant, not a v2 fix.

Focused type-aware lint and `bun run check:changed` passed. The report has no dedicated tsconfig; it is linted/formatted and exercised through the actual HTTP CLI. Parent clean full/owners/design and required MCP qualification follow the additive source/response schema change. No model call, live books, statutory qualification, UI composition or browser parity is claimed.
