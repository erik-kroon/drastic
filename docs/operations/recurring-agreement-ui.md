# Recurring agreement UI

Erik Kroon adopted R-01 through R-04 on 10 October 2026 at the existing
channel tolerance 16 and maximum difference ratio 0.02. References and hashes
are retained in `verification/paper/kanon-manifest.json`.

These bureau screens belong to the recurring view of the sales route. R-01
shows saved agreements and retained cycle history; R-02 creates an agreement;
R-03 revises its future schedule; R-04 revises its future invoice template.
Creation and editing must remain reachable from the register with keyboard
controls and a clear return path.

## Behavior owners

Use `packages/contracts/src/recurring-invoices.ts` and the existing recurring
application operations. Preserve authority, revision checks, exact approvals,
atomic receipts and posted history. Creating an agreement does not issue an
invoice. Future revisions never rewrite prior cycles. Preparation creates a
reviewable draft; issuance and delivery remain separate facts.

Customer and source-draft selections start empty. A selected saved draft must
be reviewed before saving its template, including customer, rows, amounts and
date offsets. Select invoice rows by their readable contents; retain stable
component identifiers in the application binding rather than asking a user
to type identifiers. Require a reason for future changes.

## Retained qualification

The two real-route browser journeys pass together after accessibility integration.
They exercise same-key recovery after a lost response, keyboard review at 320px,
creation, future schedule and source-template revisions, saved revision history,
pause/resume, historical invoice refusal, partial bank correction and VAT/period
navigation. Source integrity is stable. The full changed-file check passes.

At 1440 by 900, R-01 through R-04 compare at 1.94%, 1.30%, 1.37% and 1.71%,
respectively, against the immutable adopted references. Actual, diff, source hashes
and repeatable seed evidence are in `verification/recurring-closeout/2026-10-10`.
The header's counts come from application owners and differ from the board example;
no counts, financial values or delivery outcomes are fabricated to pass.

Repeat with `PAPER_DEMO=demo PAPER_ARTIFACTS=test-results/recurring-targets node
verification/paper/start.mjs`, then `node verification/paper/seed-recurring-targets.mjs`
and `PAPER_ARTIFACTS=test-results/recurring-targets node verification/paper/capture.mjs
R-01` (repeat R-02 through R-04). Use `PAPER_RECURRING=1
OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/recurring-recovery.e2e.ts
tests/browser/invoice-bank-period.e2e.ts` for the behavior proof.

Broader loading/error states and native zoom are not visually qualified. Existing
invoice, VAT and period screens retain current appearance under the separate
explicit authorization; their visual parity remains unverified. This is synthetic
application qualification, not live delivery or production qualification.

All 17 API acceptance results pass across the full run (16) and a focused admission repeat (1). The full run exceeded its default 30-second wall budget in the 205-draft test; the isolated repeat took 22.14 seconds and retained the existing 79.6235 ms p95 limit, measured at 33.58 ms. The 1,000-agreement scanner completed with 148.31 ms claimed-to-draft p95. The real MCP suite and local Luna evaluation pass; the two socket-failing MCPJam protocol tests remain intentionally disabled under the earlier explicit authorization.
