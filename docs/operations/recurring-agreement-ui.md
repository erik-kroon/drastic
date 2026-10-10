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

## Qualification still required

Exercise creation, schedule revision, template revision, pause, cycle history,
stale source refusal, retries and reloads through the real synthetic runtime.
Retain empty, loading, error, keyboard and changed-source states. Compare each
adopted state with its saved Paper image at 1440 by 900 and save actual and
diff artifacts. Adoption alone is not implementation or parity proof.
