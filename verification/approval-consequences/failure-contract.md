# Preimplementation failure expectations

Synthetic fixtures only. These expectations precede approval capture and SE mapping implementation.

- A new single-line Swedish purchase approval retains its actual period identity/bounds, known-empty dimension requirements/assignments, exact stored AUT04 category/rate/deduction witness, source-to-posting line correspondence and synthetic mapping content identity/statement line in the same transaction.
- The exported known synthetic consequence uses those retained facts. Later account-code, period-bound, dimension-head or VAT-support changes cannot alter the captured inputs or consequence identity in a fresh export.
- Two source lines using the same expense account retain distinct posting-line IDs and their own exact deduction/rate. No account-only join or first-line category shortcut is permitted. Multi-line category opt-in remains unsupported; missing category remains unknown.
- Historical missing captures remain unknown. Corrections cannot borrow the original VAT reasoning.
- Existing supplier transport cannot express nonempty dimension assignments. Capture only the effective known-empty posting-owner path; do not fabricate nonempty facts or add a dimension feature.
- Synthetic SE account rules map 3000–3799 to synthetic net sales, 3800–3999 to synthetic other income, 4000–4999 to synthetic goods cost, 5000–6999 to synthetic external cost, 7000–7699 to synthetic personnel cost, 7700–7899 to synthetic depreciation and 7900–7999 to synthetic other cost. These are authored test boundaries, not statutory BAS/K2 qualification.
- Two external-cost accounts share a leaf; a goods-cost account differs. Unsupported assets, gaps and noncanonical account codes stay unknown. Reversed or overlapping ranges invalidate the whole release. Changed content changes the mapping digest and resulting consequence identity.
- Approval, exact review digest, dependency freshness, receipt atomicity and append-only history remain unchanged. No real books, legal/provider calls or mandate enablement.
