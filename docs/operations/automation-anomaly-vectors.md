# Independent supplier-warning expectations (AUT-07)

These expectations precede implementation. Warnings are deterministic diagnostics over captured facts, not fraud findings, legal VAT policy or authority to post. Each check returns `flagged`, `clear` or `unavailable`, with algorithm/policy version and evidence identities. Missing evidence cannot mean clear.

Warnings are computed before each supplier review is sealed and included in its immutable digest. Reading a sealed review returns its retained checks. A new seal recomputes against its new cutoff and dependencies; approval/posting never substitutes current warning facts for the approved review.

| Check | Positive authored case | Negative authored case | Missing-fact case |
| --- | --- | --- | --- |
| Changed destination | A completed payment binds retained destination A; reviewed counterparty/payee revision binds B | Both bound destinations are A | Prepared payee or observed bank settlement without completed-payment destination binding: unavailable |
| Amount outlier | At least three compatible prior gross amounts are 10000 minor units; target is 30001 | Same history; target is 30000 | Fewer than three compatible retained amounts: unavailable |
| Category VAT ratio | Captured supported category/profile resolves 25%; source net 10000, VAT 4000, gross 14000 conflicts | Same category, source net 10000, VAT 2500, gross 12500 agrees | Legacy missing category/profile/source tax basis: unavailable |
| Duplicate supplier number | Same book, same supplier, same document number has retained recognized evidence | Different document number, or same number for a different supplier | Missing document number: unavailable |
| New urgent supplier | No prior accepted purchase at cutoff; due date is cutoff plus three days | Established supplier, or due date is cutoff plus four days | Missing due date or incomplete history inventory: unavailable |
| Directory solicitation | Retained text explicitly presents an optional directory-listing offer with payment requested | Ordinary authored invoice text with no matching solicitation pattern | No retained source text: unavailable |

The initial amount heuristic is strictly greater than three times the median of at least three same-book/counterparty/kind/currency precedents with retained positive gross amounts. It uses exact integer comparisons; for an even population compare against the two middle values without floating point. The initial urgency heuristic uses the review cutoff's frozen book-calendar date and a three-day horizon, including overdue dates. These versioned warning heuristics do not impose blocking or mandate terms.

The VAT positive vector tests the diagnostic boundary; an existing earlier exact-treatment validation may already refuse such contradictory source facts. Preserve that refusal. Never weaken validation merely to make a warning reachable. Qualify public behavior separately from a classifier's authored evidence vectors. Full versus deductible VAT must not be confused: compare the retained source tax amount with the admitted category's exact rate calculation, not with the deductible posting amount.

Required retained artifacts cover positive, negative and unavailable cases, evidence identities and review digests. Resealing after changed facts produces newly captured checks; the original sealed review stays unchanged. Flagged and clear diagnostic paths preserve exact financial amounts and treatment. A warning alone cannot approve, block, pay, deduplicate or alter an existing stronger refusal.

Directory rules retain matched rule IDs, text digest and minimal safe evidence. They do not browse websites or claim a document is criminal fraud. Bank destinations come from bound historical evidence, never a current counterparty head. AUT-D04 supplies the UI design gate; backend read-model availability does not establish browser parity.
