# Decision provenance (AUT-01 / DRA-219)

The failure contract is [AUT-01](../../docs/operations/automation-handoff-2026-10-10.md#aut-01-record-decision-provenance-for-every-human-treatment-decision).
The focused journeys use HTTP into the existing disposable PostgreSQL/Worker
runtime. They cover explicit citation scope and session refusal, omitted exposure
across sessions, unchanged/corrected bank ranking choices, partial supplier hints,
empty hints, replay, changed replay payload, transaction rollback, immutable rows,
batch members, extracted fields and historical vouchers. Another current operator
can approve a sealed review without inheriting the preparer's exposure.

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra219-provenance bun run test:e2e apps/api/tests/decision-provenance.e2e.test.ts apps/api/tests/supplier-extraction.e2e.test.ts apps/api/tests/period-work-batch.e2e.test.ts apps/api/tests/sie-historical-owners.e2e.test.ts -t 'bank exposure|supplier approval refuses|empty supplier hints|runtime-role extraction admits|approved period batch recovers aggregate|SIE multi-member chunk'
node verification/decision-provenance/summarize.mjs test-results/dra219-provenance
```

`decision-provenance-summary.json` derives class counts and decision identities
from the observed journey rows. The summary requires passing test results and a
stable source inventory. The run also retains migration/source hashes, Worker
logs and the independent journey artifacts. Expected injected 500s are rollback
and recovery observations.

Supplier account/VAT hints cover two dimensions of a complete treatment; their
whole-treatment class stays `unknown_exposure`, with the dimension comparisons
retained. Empty option lists are recorded but do not count as exposure. Earlier
presentations with the same exact subject and option-set digest are covered by a
valid current citation; differing earlier options remain unknown. API credentials
have no browser session identity, so their exposure boundary is the actor. No
credential hash or token is retained.

Explicit citations are refused when their book, actor, session or exact subject
revision differs. Server-inherited preparation citations are used only when they
belong to the current reviewer and session. Batch provenance comes from the
server's batch context, never a caller-selected class. Historical voucher records
retain the actual approver separately from the executor. Opening basis adoption
is excluded because it is not a human treatment decision for an imported voucher.

The web changes transport rendered suggestion IDs and bind the supplier hint
cache to a draft revision. Source checks verify the wiring; these HTTP journeys
do not observe browser rendering or transport. No visual parity or real-company
qualification is claimed.

An extraction `accepted_suggestion` action without a meaningful served citation is `unknown_exposure`: the server resolves its value from a stored suggestion. A manually retained value without exposure can remain independent. The focused extraction journey retains both observations in `extraction-uncited-provenance.json`.

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra219-extraction-final bun run test:e2e apps/api/tests/supplier-extraction.e2e.test.ts -t 'uncited extraction acceptance|runtime-role extraction admits'
```
