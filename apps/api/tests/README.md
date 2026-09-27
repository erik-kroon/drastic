# Accounting E2E suite

User authorization: the initial Vitest work was approved on 2026-09-22. On 2026-09-27 the user also approved focused FWD E2E tests, with failure cases defined before implementation and retained run artifacts.

## Post-migration review regressions

The user explicitly approved focused E2E additions for the architecture-review fixes.
These failure contracts precede the new test implementation:

| Given / when | Required observation and counterfactual |
| --- | --- |
| Fresh migrated runtime role admits, executes, reviews, cancels and retries extraction | Immutable request rows need no UPDATE grant; one retained result survives redelivery. Removing lifecycle UPDATE permission is detected. Locking the immutable request again must fail this journey. |
| Executor credential, identity admission or book membership is revoked before capture or while object reading is paused | No unauthorized source read before capture; no result publication after revocation. Restoring authority permits the same durable request to resume. A wrong entity/book scope is refused. |
| Requester session ends after admitting service-intent work | Current authorized executor can finish; cancellation or supersession still fences publication independently of session expiry. |
| More than 200 accepted historical drafts, then a new draft | Creation succeeds, bounded pages cover retained heads, accepted revisions remain readable and ledger history is unchanged by listing. Restoring the lifetime cap must fail. |
| Duplicate pages cross draft and registered-invoice anchors | Both emitted cursor kinds resume; wrong-context, malformed and invalid-kind/revision cursors fail. Exact nonzero, zero and unknown summary totals retain their meanings. |
| Swedish calendar crosses summer/winter month/year boundaries | Actual company overview and backend admission use Stockholm dates; an open page refreshes at midnight and after tab suspension. Restoring UTC slicing must fail. |

The seam is HTTP into workerd/PostgreSQL plus the real Bun extraction handler with
a controlled retained-object adapter for publication races. Browser observations
use the real web app where available. Run artifacts distinguish those surfaces;
an isolated calendar check is not browser or database clock proof.

The failure cases below precede the test implementation. Tests drive HTTP into the real Worker and PostgreSQL. Database access outside the Worker is limited to fixture setup, failure injection and independent observation.

| Failure                                       | Required observable result                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Posting silently loses precision              | Posting 9007199254740993 minor units preserves the exact debit, credit and balances.                |
| Review mutates the ledger                     | Evidence, preparation, validation and approval leave sequence and journal rows unchanged.           |
| Replay or concurrent retry posts twice        | Same key and payload returns one receipt; exactly one voucher, outbox entry and sequence increment. |
| Key reused for another request                | Conflict; original receipt and balances remain unchanged.                                           |
| A response is lost after commit               | Receipt lookup and retry recover the committed result without another posting.                      |
| Wrong actor, book, digest or expired approval | Request fails with no committed posting.                                                            |
| Locked period or changed dependency           | Execution fails; approval remains unconsumed, sequence and outbox unchanged.                        |
| Invalid amount or unbalanced journal          | Public boundary rejects it; no journal rows are written.                                            |
| Correction destroys history                   | A linked reversal cancels balances; original voucher is unchanged.                                  |
| Runtime login can bypass protected history    | Runtime grants and integrity guards reject protected-history mutation.                              |
| Transaction fails after writing some rows     | Voucher, lines, counters, approval consumption, receipt and outbox all roll back.                   |
| Reapplying migrations corrupts state          | Second run preserves populated ledger; changed recorded checksum fails loudly.                      |
| Old installation takes the new baseline       | A receipt naming a migration the current set lacks is refused before any migration SQL runs.        |
| MCP bypasses HTTP admission                   | Real JSON-RPC requests enforce authentication and expose no approval tool.                          |

Current cases cover credential, Better Auth session and approver-membership revocation, plus receipt replay after approval consumption or expiry. The suite does not provide automated browser coverage, a complete supplier AP journey or actual-company acceptance.

The FWD journeys add native synthetic invoice issue/document/allocation/reference matching, explicit MCP exposure and approved execution/recovery, and run-manifest source identity. Their failure contracts and limits are in [the execution record](../../../docs/plans/16-comparison-reconciliation.md#execution-record). A passing selected journey does not qualify every feature in the catalog.

Run `bun run test:e2e` from the repository root. PostgreSQL 17 binaries (`initdb`, `pg_ctl`, `pg_config`) and Bun must be available. Set `PG_BINDIR` when the binaries are outside PATH. Each invocation owns a fresh temporary PostgreSQL cluster; it never uses ambient database credentials. Missing prerequisites fail the run.

## Run evidence

The latest run writes `test-results/e2e`. Before a new run starts, the runner moves the previous directory into `test-results/e2e-history/<timestamp>-<suffix>`. Both paths are ignored by Git. Local history is not a production archive; retain release evidence under the operator's custody policy.

- `manifest.json` binds HEAD, tracked diff, lockfile, migration checksums and runtime versions. It also lists each tracked or untracked file in the declared source roots, its SHA-256 and tracked state. Deleted tracked files have a null hash. Ignored files and symlinks are not accepted as implicit source inputs: ignored files are outside this inventory, and discovered symlinks refuse the run.
- `source-integrity.json` compares the source inventory at startup and teardown. A mismatch fails the run. It checks those two observations, not continuous filesystem history.
- `results.json`, JUnit output and the command exit status establish which cases ran and passed. A stable source hash alone is not a passing test result. Missing results, teardown failure or an empty run cannot establish readiness.
- Journey JSON files retain synthetic source references, exact outcomes and receipts. `bank-reference-journey.json` also contains the rendered document; `mcp-authority-journey.json` contains the classified catalog.
- Worker, migration and PostgreSQL logs support diagnosis. Fixture access tokens are disposable and are excluded from saved artifacts.

The manifest identifies declared repository inputs, not dependency-directory bytes or a deployed bundle. Use the frozen lockfile and separate deployment checks for those boundaries. These synthetic tests are not Swedish accounting compliance certification.
