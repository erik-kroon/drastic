# Accountant review pack (END-03)

## Accepted scope

Create a retained accountant-review snapshot from a **current immutable internal trial-balance report**. Materialize all pages and JSON/CSV bytes under one book barrier. Provide balances, all ledger-prefix lines (including explicitly excluded later-dated lines), receipts, evidence and separately visible source/control gaps. Old packs and artifact bytes survive later edits, posting and reopen.

This is synthetic review tooling. It does not activate a real company, establish opening balances or completeness, calculate taxes, transfer results, generate SIE/iXBRL/annual reports, or claim compatibility with any Visma product. Privately paid expenses and shareholder funding need evidence and accountant classification; this pack must not label them loans, conditional/unconditional equity, VAT-free or already settled by inference.

## Risks and acceptance cases recorded before implementation

- **Mixed snapshots:** report creation and pack creation can race with posting. Reject a report whose sequence is not the locked book sequence. Pack creation holds book FOR UPDATE; later reads use only materialized rows/artifacts. Each page names pack ID, section, digest and fixed total.
- **Intermediate correction:** never accept a client-chosen sequence. Use the current committed book sequence under its barrier, which excludes half-committed correction groups.
- **Unknown opening:** show observed pre-interval ledger totals separately from verified opening authority. No prior vouchers is not proof of zero opening. Always retain the unverified opening status, supplied explanation and evidence references.
- **False completeness:** bank, commerce and schedule hooks describe represented state only. Empty modules cannot mean not applicable. Missing company profile/inventory, owner-funding and VAT/tax providers remain explicit unavailable/unverified rows. User-declared exclusions remain visible and cannot waive checks.
- **Lost response:** exact actor/scope/input/key returns the stored creation receipt. Changed input or wrong scope cannot recover another pack.
- **Later changes/reopen:** currentness is separate from immutable content. A changed dependency marks the old pack historical, without changing a row or artifact hash.
- **Omitted evidence:** inventory every retained evidence record at capture, distinguish included opening/movement evidence from excluded-later and no-included-posting records, and include retained text/hash/source locators. An unlinked record is a review gap, not discarded noise.
- **Lineage loss:** include voucher, event, change set, approval, execution receipt, reversal link, posting purpose and original evidence refs. Opening and movement lines remain distinguishable; later-dated lines in the committed prefix are explicitly excluded from totals.
- **Large or partial export:** synchronous first-year package is bounded. Refuse before committing any pack if row/content/byte limits are exceeded. Never call truncation a complete export.
- **Formula injection/precision loss:** CSV cells use a documented text marker before source values and RFC4180 quoting. Exact minor-unit values remain strings. JSON is the lossless primary representation. File byte hashes cover the exact UTF-8 content delivered to the browser.
- **Cross-book/data leakage:** authorize every creation/read/download through current backend admission. Export filenames contain generated IDs only. Original evidence may be sensitive; show a download warning, not a public link.
- **Local-only currentness:** a green dependency comparison means unchanged captured sources, not statutory readiness, legal verification or external acceptance.

Root must run native types/lint and permitted local API/browser observations. This owner adds no tests/fixtures and runs no database writes, migrations, builds or servers. Static checks do not prove races, crash recovery, browser behavior or accounting correctness.

## Implementation / integration

Pending implementation. Exact interfaces, limits and observations will be recorded here before handoff.
