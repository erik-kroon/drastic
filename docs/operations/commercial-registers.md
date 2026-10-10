# Commercial register closeout

C-01 Articles (Paper 43T4-0) and C-02 Quotes/orders (440W-0) were explicitly adopted at channel tolerance 16 and maximum difference 2% on 10 October 2026. They replace the deleted M5/M12 targets and their staged historical pixel milestones. The actual routes are the book sales workspace with `view=articles` and `view=orders`.

## Delivered behavior

Articles retain immutable revisions, exact minor-unit prices, edit abandonment, Escape and focus return, reload and archival. The canonical table keeps unit/VAT/price/account columns aligned with their headers. Unresolved VAT and missing revenue accounts remain explicit. No example account is written into product data.

Quotes retain complete saved content, real stored gross amounts, explicit unknown document number/validity, revision history, order conversion and cancellation. Revisions require a deliberately selected, independently loaded saved source plus a reason. No source is preselected. Late, failed, wrong-book and mismatched source reads cannot qualify a submission. A captured request survives uncertain responses and reload without taking newer form values. Escape closes detail and returns focus to the selected row.

Existing sales navigation destinations stay reachable. This implementation does not invent incoming-order/ROT/RUT owners, sent/expired lifecycle states, document numbers or transition dates. Those historical owner dependencies remain unresolved product requirements under the commercial domain; C-01/C-02 adopt their truthful present-state rendering.

## Evidence and repeat

`verification/commercial-closeout/2026-10-11/` retains unscaled 1440 × 900 actual/diff/capture/result files for C-01/C-02 and the four recurring screens after shared-control integration. The immutable 2% policy passes all six. Browser behavior is separate: four real synthetic journeys passed in run `eef87643-77f7-4512-bf4b-79608a62f095`, including two bounded Luna steps. Their report and source inventory identify the exact tested source; the integrated sources passed three cases in `13b73c90-3114-4904-9c70-23f8c9fb818e`. The independent-approver case initially refused its missing fixture, then passed alone in `56f7ae7d-5d42-466c-8120-30679c305b7e` with that required fixture enabled. Both source inventories stayed stable.

```sh
CHECK_CHANGED_TIMEOUT_SECONDS=600 bun run check:changed:full origin/main
bun run check:owners
bun run check:browser
PAPER_DEMO=demo node verification/paper/start.mjs
node verification/paper/seed-commercial-targets.mjs
node verification/paper/seed-recurring-targets.mjs
node verification/paper/capture.mjs C-01
node verification/paper/capture.mjs C-02
PAPER_FIRM_RECOVERY=1 bun run test:browser tests/browser/article-register.e2e.ts tests/browser/quote-revision.e2e.ts --ai-trace
```

Use one runtime and run commands sequentially. Stop the disposable runtime after capture. Session-bearing traces remain local. Only the adopted captured light states are visually qualified; other states, dark theme, native zoom and production qualification are not claimed.
