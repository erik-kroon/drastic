# Repeat the synthetic document demo

Failure contract before implementation. Refuse missing tracked launch inputs, changed source during a run, a failed startup or test, a missing journey result, different original or bank input hashes, nonzero reset balances, wrong posting amounts, duplicate financial effects, unresolved unreadable-evidence refusal, and lost-response recovery without the same retained receipt. Stop after the first failed reset. Keep its failure manifest. Never attach to an existing company database or reuse a previous passing report.

Use the [Luna setup recipe](README.md#first-setup) from a fresh checkout. Install the locked dependencies and matching Chromium first.

```bash
bun install --frozen-lockfile
bun run setup:browser
node verification/testerarmy/demo.mjs
```

The command runs the existing browser journey twice, serially. Each run starts a new synthetic PostgreSQL cluster, applies the actual migrations, provisions `entity_synthetic/book_synthetic`, and starts the real Worker API and web application. Reset means closing that runtime and creating the next fresh cluster. No company records are deleted.

Both runs use the same two-page PDF, filename, bank row and exact amounts. The public API prepares the synthetic supplier identity, manual acceptance review, and retained bank statement. Upload, questions, closure, draft handoff, approval, posting and bank allocation use real UI commands. The synthetic manual profile does not establish Swedish VAT treatment, document extraction or a live bank connection.

The journey forwards an execution request to the actual API and drops its successful response. Reload must show the committed receipt with one posting. It also refuses to resolve a question whose supplied evidence cannot be opened.

The expected reset ledger is sequence zero with zero account totals. Posting adds debit 125000 minor units to account_bank and credit 125000 to account_clearing. Allocation consumes the single 125000 bank row and leaves the ledger unchanged.

The command prints its `test-results/demo/<run-id>/manifest.json`. It records code revision and hashes, runtime versions, expected outcomes, startup logs, the two journey results and their screenshot paths. A manifest can report VERIFIED only after both runs pass and source hashes stay fixed. Reports and browser traces remain private local artifacts because traces can contain session cookies. Review evidence before sharing it.

This bounded demo does not close A03, A06, P03, P04, DRA-95 or the wider bureau workflow. Those owners retain their parity, accessibility, performance, company and provider acceptance checks.
