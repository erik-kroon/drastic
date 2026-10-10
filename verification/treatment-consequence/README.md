# Treatment consequences (AUT-03 / DRA-221)

The independent oracle is `docs/operations/automation-consequence-vectors.md`, committed before implementation. Synthetic leaf names do not adopt a production K2 mapping.

Failure contract, written before the classifier:

- Same captured leaf, account classification, placement, VAT category, normalized deduction, period and required dimensions must compare equivalent across accounts.
- Different deduction, explicit VAT category, asset/expense classification, placement, period or required/fixed dimension must compare different.
- Mapping content identity changes the class; a schema version cannot identify a release.
- Missing mapping, original-cutoff applicability, account mapping, category, deduction, period boundaries or dimension requirements yields unknown. Identical unknowns never compare equivalent.
- Invalid rational shares, dates, duplicate account/policy/assignment entries, missing required values and fixed-value mismatches cannot produce a known class.
- Rational normalization uses exact integers; reordered captured entries cannot change identity.
- The real export consumer retains available account, deduction and period IDs, but never invents missing VAT category, historical mapping or dimension requirements.
- Existing sealed v1 exports remain readable; new attachments belong to a versioned v2 export.

Before the resolved-VAT fix, the public export assertion also requires the retained exact rate and an explicit missing profile identity. Known classes must pin the actual profile content identity and normalized resolved rate: a category name and accounting period alone cannot distinguish a rate change inside that period. Existing independent vector outcomes stay unchanged.

The verification artifact records expected and observed vector outcomes separately. The public HTTP journey retains a real supplier review/export showing captured facts and an unknown consequence. No provider, model, UI or current-head reconstruction is involved.

The v1 classifier normalizes rational rates and deduction with integer arithmetic. Its class identity is the version-prefixed JSON of ordered typed components, including mapping checksum, explicit account classification/placement, VAT category and profile checksum, normalized resolved rate/deduction, frozen period and sorted required/fixed dimensions. It excludes the account identifier, so two explicitly classified accounts can have the same consequences. Missing or invalid captures have reasons and no identity; comparing either unknown returns unknown.

Supplier examples project retained reviewed accounts, rate and deduction, posting date/period ID and only an actually captured VAT witness checksum. Corrections use the replacement journal and omit unavailable replacement VAT reasoning. No current statement mapping, period or dimension catalogue is fetched. Banking/extraction labels are marked `not_accounting_treatment` with no invented treatment entries. New seals are v2; the optional consequence attachment keeps immutable v1 seals readable.

Repeat the focused verification sequentially:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra221-stable bun run test:e2e \
  apps/api/tests/treatment-consequence.e2e.test.ts \
  apps/api/tests/decision-examples.e2e.test.ts \
  -t 'independent consequence vectors|public decision export|sealed decision examples|committed correction relabels'
```

Artifacts include `treatment-consequence-vectors.json` (independent expected outcomes and observed classes), `treatment-consequence-export.json` (public review/export), sealed-export/correction evidence, repeated identical JSONL/manifests, `results.json` and `source-integrity.json`. Only a stable source-integrity result qualifies the run as fixed-revision evidence.
