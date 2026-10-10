# Paid payroll recovery

P-01 (Paper node 43L2-0) was explicitly adopted by Erik Kroon on 2026-10-10 at
channel tolerance 16 and maximum difference 2%. Its real route is the book tax
workspace with `view=paid-recovery`. Saved assessments, not client money, drive
the list, comparison, blockers and split proposal. Read-only evidence choices
require payroll access, stay book-scoped and do not expose evidence content.

The initial screen proposes no financial effect. Split, attachment and
cancellation preserve exact idempotency intent through response loss and reload.
Independent qualification, a canonical claim review, exact approval, and each
future payroll offset remain distinct owner operations. Posted original history
is immutable. Synthetic qualification is not live legal or payroll qualification.

The real HTTP payroll recovery journey qualifies canonical claims, future
installments, executed zero-net settlement, refusal and populated backup/restore.
The real browser journey separately qualifies discoverability, saved comparison,
unqualified evidence, reload and cancellation. Visual comparison remains pending
until measured actual/diff evidence passes the adopted threshold.

## Repeatable operator and model proof

The old R43 composition and its scripted labels are superseded by adopted P-01. Real Vitest browser journeys now exercise the complete independent qualification, claim review/approval/execution, two payroll installments, zero-net noncash settlement, reload and cancellation paths. No original paid event is rewritten.

```sh
OPENERP_PAYROLL_MODEL_REVIEW=1 bun run test:e2e apps/api/tests/paid-payroll-recovery.browser.e2e.test.ts apps/api/tests/paid-payroll-recovery-completion.browser.e2e.test.ts
```

The first case additionally runs a bounded Luna readability and refusal review against the same disposable application and the real password-authenticated operator. Its private session file is removed and the pinned Codex proxy is stopped in `finally`; no application boundary is mocked. The model review is gated explicitly so routine CI remains deterministic. Missing authentication, a foreign origin or an unavailable model refuses the model proof; none of those conditions qualifies the screen. Vitest verifies financial transitions, while Luna reviews the blocked screen rather than approving financial commands.

A separate existing reminder recovery regression requires historical commit `3a3b2093`, absent from public Drastic history. Its attempted run refused before recovery. The same requirement is present on main. This is retained as an existing portability limitation, not a new payroll recovery failure or a passing reminder regression.
