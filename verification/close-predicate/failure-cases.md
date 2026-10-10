# AUT06 / P1 independent failure contract

Authored before owner implementation. Existing automation-coverage-vectors remain the oracle.

- Stored fiscal-year/partial-month periods cannot masquerade as a monthly target. Dates come from a retained exact calendar-month period, never from caller cutoff/outcomes.
- A never-run check is not_run. Missing P2 supporting documents and P8 complete facts remain not_established and gated; reported tax/subledger/AP/AR/provider checks cannot establish done.
- A signed whole declared September bank inventory may pass only its bank check; zero-difference source coverage without complete statements/signatures cannot pass.
- Cross-book IDs and evidence from another month are refused. Same command key/payload returns original immutable capture after freshness changes; changed payload conflicts, concurrent replay writes once.
- Retained outcome remains unchanged when a bank source, relevant ledger or operational inventory changes. Current freshness comes from exact existing owner dependencies. A later-period nonfinancial operation with unchanged declared dependency inventory remains fresh. Exact bank reconciliation uses a period-end ledger dependency; whole declared bank inventory coverage and actual VAT currently include a global committed-sequence dependency, which is preserved even for later-period postings.
- Actual VAT control may pass only its existing coverageComplete/controlsReconciled/periodVerified/calculationSupported facts. Incomplete source coverage at zero amount is never a pass. No independent tax/subledger owner is invented.
- An open review/question inventory prevents the operational gate passing. Closed/resolved changes invalidate the captured inventory identity rather than rewriting history.
- HTTP and actual MCP read return the same retained IDs/digests and live freshness, write zero records/commands/receipts/queues, and cannot approve or post.
- One repeatable transaction snapshot composes in-TX owner ports; no nested public transactions or copied arithmetic. Immutable row grants reject runtime UPDATE/DELETE.

Fixtures: synthetic month periods and real public commands; synthetic VAT release/fact/activation fixture seeding explicitly does not adopt tax law. No model/provider, screen or statutory qualification.
