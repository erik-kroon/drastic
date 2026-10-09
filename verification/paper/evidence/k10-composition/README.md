# K-10 bars and list contract

Owner: Erik Kroon. Screen: Att göra at `/entities/$entityId/books/$bookId/`. Audience: bureau. Approved board: K-10, immutable `kanon-2026-10-09`; baseline and JSX hashes remain in the manifest. Adopted states: populated, selected, empty, loading and error.

Behavior comes from WorkHome, attention/work-return application owners and docs/domain.md. The retained original/root/stage/recovery obligations remain frozen. Blocked, stale and unknown outcomes belong to the existing original/supplier/journal detail owners; this slice retains those bodies.

Canonical parts: AreaBar, BarTab, ListDetailPage, WorkList, WorkGroup, WorkRow and the actual shared DetailPanelSurface. WorkHome owns all reads, stored amount formatting, root/stage projection and routing. BookWorkspace consumes a zero-inset shell only at the exact home route. Other screens retain current gutters and focused-review behavior.

Failure obligations, recorded before implementation:

- Pending/error suppress stale attention data. Watch reads sales; bank errors have an independent retry. Successful zero rows alone establish empty.
- Requested root, exact completed stage and cross-root stage refusal do not fall back to the first row. Focus the heading only after a successful idle read, once per changed key.
- Selected buttons retain pressed state and native autofocus through reload, supplier handoff and scoped owner return. Paging clears stale task/stage.
- Stored amounts/scales and saved journal/supplier identity/scope checks stay in current owners. The home original preview has no independently supplied expected SHA; do not claim such a binding.
- Supplier expiry retains its role/fresh-read-gated renewal and replaces normal preview actions. No generic parent approval or second primary is introduced.
- Mobile navigation remains reachable with its safe-area reserve. Dark, true200% zoom, wider document/recovery states and full panel composition need their own qualification.

Missing decisions: full expiry/no-selection panel composition and separately adopted foundation specimens. This slice can qualify bars/list behavior without closing full K-10 parity.

Recipe: `OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/work-home-return.e2e.ts`, isolated stored synthetic originals and receipts, pinned proxy/Luna, viewport1440×900, sv-SE, Europe/Stockholm. Retain JSON/screenshots and source-integrity provenance. A separate full-frame comparison uses the manifest channel tolerance16 and max diff2%; never crop, rescale, replace baseline or hide regions.

Baseline path: `verification/paper/baseline/kanon-2026-10-09/K-10.png`. Measured full-frame difference: **4.0141%**, above the adopted 2% limit at channel tolerance16. See [comparison/result.json](comparison/result.json), actual and diff. This is a synthetic selected-original workflow with different board content and an unpinned clock; it is a truthful drift measurement, not complete parity qualification. [behavior.json](behavior.json) retains the passing original/root/stage/receipt workflow and 375px geometry. [receipt.json](receipt.json) binds the stable candidate hashes to base revision26f00b6; the runtime scratch was removed. Native200% zoom and full required-state captures remain unverified. No production qualification is claimed.
