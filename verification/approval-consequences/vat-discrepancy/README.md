New supplier approval captures permit a known VAT rate only when the retained recognition line uniquely matches the selected source-line ID and has `exact_match`. A retained discrepancy, missing binding or ambiguous binding captures a null rate and remains unknown. Posted tax, reviewed deduction, category witness and immutable old captures are unchanged. The retained recognition remains the source of the discrepancy outcome.

Failure-first `72ff0e5` executed the public preparation, approval, posting and export workflow. A 25/100 reviewed rate on net 10,000 posted source tax 2,501 under authored tolerance 1, yet its capture still qualified as known. The null-rate expectation failed after all observations were retained. Fix `5268d43` passed all five VAT workflows from its clean commit. The fix and test were cherry-picked to their owning PR27 as `df1cae9` then `852f92d`; a clean lower-PR replay passed the new workflow, with four unselected cases.

The new workflow covers exact tax 2,500, retained tax 2,501, and two source lines sharing one expense account with total posted VAT 5,001. It checks per-source-line capture and rereads the original sealed exact export unchanged. The uncategorised multiline case tests binding, not multi-line category adoption. Authored category/rate fixtures do not qualify Swedish tax law.

```sh
OPENERP_E2E_ARTIFACTS=test-results/vat-discrepancy-repeat bun run test:e2e apps/api/tests/vat-purchase-categories.e2e.test.ts
```

Changed checks passed against `127cf2c`, including API/test types, after an initial lint failure was fixed without suppression. The lower clean worktree frozen install passed. Final clean integrated full, owners and design gates remain pending. No contract schema, MCP catalog, UI, live provider or historical backfill changed in this fix.
