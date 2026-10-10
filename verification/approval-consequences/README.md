# Approval consequence capture and synthetic SE mapping

New Swedish purchase reviews retain exact source-line-to-posting-line bindings created from the recognition journal's checked order. Approval records each source's stored VAT treatment, actual period bounds, mapping checksum/statement leaf and the existing posting path's known-empty dimension facts in immutable provenance. Export projects those stored facts rather than current account, period, dimension or VAT heads.

The mapping is an authored synthetic release, qualified `synthetic_only`. It is not an adopted statutory BAS/K2 mapping. Missing category or profile remains unknown; no category is inferred from an account or rate. Nonempty dimension requirements/assignments are not implemented by this supplier transport and are captured as unknown. Older prepared reviews without the new checked bindings retain `source_bindings_not_captured`; historical decisions without a capture retain `approval_consequence_capture_not_retained`. Neither path backfills history. The compatibility branch for a previously prepared review was inspected in source, not exercised by a retained public workflow. Replacement journals continue through the existing correction projection without inheriting original VAT reasoning.

`failure-contract.md` and both new workflows were authored before product implementation. The unfixed real HTTP run reached missing capture assertions after valid preparation, approval, posting and export: 2 failed, 2 unselected. Its stable source hash is `9da30887cde0ac2055a8434f9c5f839657cc931f322a5b834b6d9bf24d89d523`. The mapping's initially missing module is not claimed as a reproduced runtime defect.

Repeat the unfixed selection against the preimplementation tree:

```sh
OPENERP_E2E_ARTIFACTS=test-results/approval-consequences-before bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts -t 'approval consequences'
```

The implemented HTTP run passed 3 selected workflows, 4 unselected. It proves a known synthetic single-line consequence, unchanged fresh export after later heads, repeated-account source correspondence with independent full/half deduction and the existing missing-category export regression. Account-code and period-bound changes are controlled administrative mutations of synthetic heads; dimension and VAT-fact revisions use public commands. The artifact labels these separately.

```sh
OPENERP_E2E_ARTIFACTS=test-results/approval-consequences-after bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts apps/api/tests/synthetic-statement-mapping.e2e.test.ts apps/api/tests/treatment-consequence.e2e.test.ts -t 'approval consequences|synthetic statement mapping|public decision export'
```

That regex skipped the mapping workflow; its separate exact selection passed 1/1:

```sh
OPENERP_E2E_ARTIFACTS=test-results/approval-consequences-mapping bun run test:e2e apps/api/tests/synthetic-statement-mapping.e2e.test.ts -t 'synthetic SE mapping'
```

Both passing runs retain stable source hash `29e4143e1d13df6462ac0b6c9efa7f48751e23b106198ae59ac5c4b7146875b1`. Artifacts include actual approval/provenance IDs, stored source/posting bindings and capture, frozen exports, separately declared mapping expectations/observations, result counts and source-integrity inventories. `test-results/` is generated and ignored; commands reconstruct the evidence on disposable PostgreSQL/API instances.

`bun run check:changed` passed after implementation. The additive review output schema requires MCP qualification; clean full/owners/design and MCP checks are coordinated by the parent after commit. No browser/UI parity, live provider, production mapping qualification or mandate enablement is claimed.

Selected synthetic observations, outcomes and source-integrity inventories are retained in `before/`, `after/` and `mapping/` for review without the disposable runtime. They preserve the distinct failing and passing runs; later documentation retention does not imply a new behavior run.

The first clean full check at `a07b4c5` failed type-aware `no-misused-spread` on the JSON projection; type projects passed. The projection was changed to explicit owned JSON fields without suppressions. Focused type-aware lint, changed checks and the same three HTTP workflows passed at stable source hash `3fc7e6d7ac5749fceb6aa36cefd88f884cd2bc7e0b24d5828b252e5ce40f76d9`; observations and source inventory are retained in `json-projection/`. The separate mapping code and its previously retained pure-vector run were unchanged.

```sh
OPENERP_E2E_ARTIFACTS=test-results/approval-consequences-json-projection bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts apps/api/tests/treatment-consequence.e2e.test.ts -t 'approval consequences|public decision export'
```

Clean committed source `2e8aa3d` against pinned main `ff21273` passed full changed checks, owners (55/55) and design contract, with tracked status clean. Three deterministic MCP workflows and the pinned Luna eval test passed. Evidence summaries and source inventories are retained in `verification/approval-consequences/mcp/` and `mcp-eval/`. Zero measured screens is not visual parity. The initial projection lint failure is retained as a failed check; the explicit-field fix passed without suppression. No live provider, statutory mapping or nonempty-dimension qualification is claimed.
