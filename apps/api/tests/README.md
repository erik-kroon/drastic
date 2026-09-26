# Accounting E2E suite

User authorization: on 2026-09-22 the user requested implementation with Vitest and evaluation of TesterArmy.

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
| Runtime login can bypass admission            | Direct table writes fail under the actual Worker database role.                                     |
| Transaction fails after writing some rows     | Voucher, lines, counters, approval consumption, receipt and outbox all roll back.                   |
| Reapplying migrations corrupts state          | Second run preserves populated ledger; changed recorded checksum fails loudly.                      |
| Old installation takes the new baseline      | A receipt naming a migration the current set lacks is refused before any migration SQL runs.         |
| MCP bypasses HTTP admission                   | Real JSON-RPC requests enforce authentication and expose no approval tool.                          |

The retired token-session and browser sign-in tests were removed because they targeted routes and UI that no longer exist. The expiry case was removed because it tried to update an immutable approval. The suite currently has no automated browser, supplier AP, current-session security, or approval-expiry journey. Existing local HTTP/browser proof artifacts are not recurring regression coverage. A green kernel suite is not browser or AP acceptance.

Run `bun run test:e2e` from the repository root. PostgreSQL 17 binaries (`initdb`, `pg_ctl`, `pg_config`) and Bun must be available. Set `PG_BINDIR` when the binaries are outside PATH. Each invocation owns a fresh temporary PostgreSQL cluster; it never uses ambient database credentials. Missing prerequisites fail the run.

Artifacts are written under `test-results/e2e`: JSON and JUnit results, a source/migration manifest, Worker and PostgreSQL logs, and independently observed ledger evidence. Fixture access tokens are disposable and are excluded from saved artifacts. These synthetic tests are not Swedish accounting compliance certification.
