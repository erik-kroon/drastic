# Closeout API helper reconciliation

The retained closeout worktree moves command receipts, identifiers and hashing out
of the posting owner. Its helper imports were not accompanied by their new source
files. The broader API refactor on the primary working tree remains separate.

Before moving these functions, preserve these failure contracts through existing
real API E2E journeys:

- Same payload and key replay the exact stored result without a second posting.
- Changed payload, actor or operation refuses an existing command key.
- Admission reservations remain binding before a command receipt exists.
- A failed transaction leaves no partial financial group or receipt.
- Revoked authority refuses replay; locks and financial owners stay unchanged.
- Hashes, ID format and database-derived timestamps keep their current semantics.

Run posting-admission, financial workflow and scoped-authority journeys on the
isolated current-main checkout, retain synthetic results, and run the full changed
check and ownership guard. This change does not qualify the broader refactor,
new UI, providers or production.
