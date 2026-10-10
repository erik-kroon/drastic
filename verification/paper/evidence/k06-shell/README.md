# Shared bureau shell

K-06 supplies the shell values. BookWorkspace, BookNavigation and FirmsWorkspace now use one implementation in `packages/ui/src/kanon/workspace.tsx`. Application callers retain scope authority, queries, destinations, active/current states and prefetch. The shell retains pathname scroll reset, focused-review suppression, native account disclosure, mobile dialog and current content gutters. Legacy page headers and metrics remain separately owned.

Two source-grounded architecture candidates were compared: actual extraction with the existing slots, and a compound root/context beside the old shell. Extraction was selected because it preserves one lifecycle owner and needs no speculative context or inset mode. All three shell callers migrated directly; no old-path shell aliases remain. The K-06 rule background applies to selected navigation, so the redundant neutral presentation flag and its caller-only calculations were removed.

Before implementation, failure obligations covered denied book scope, active/current navigation, scoped counts/prefetch, focused return, scroll reset, mobile focus/closing/safe area, theme reload and original/task/receipt retention. The selected-original baseline passed against the built synthetic web runtime with Luna. Literal shell expectations were written before implementation and failed on the legacy colors, initials and avatar dimensions.

Repeat with `OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/dark-theme.e2e.ts` and `OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/work-home-return.e2e.ts`, sequentially. Browser receipts and checks will be retained alongside this file.

This qualifies implementation and selected real-route behavior only. K-06 remains unverified: the explanatory board requires separately owner-adopted specimens and a comparison policy. K-09 portfolio composition and K-10/K-11 full-frame parity remain pending. No baseline, adoption owner or tolerance changed.

Both selected browser recipes passed after extraction. `theme.json` records exact rendered shell dimensions/colors and light/dark/reload/restoration; `home-return.json` retains selected-original, stable-root, exact-stage and unchanged pre-posting ledger observations. `receipt.json` records source integrity, one Luna judgment for home and zero for deterministic appearance, and successful owned-runtime cleanup. Native mobile, true200% zoom and portfolio behavior remain separate queue items.
