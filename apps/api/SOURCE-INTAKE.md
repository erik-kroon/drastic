# Source intake: bounded UTF-8 bank CSV

## Working contract

IMP-01 plus a bounded IMP-02 slice: scoped exact-byte retention → immutable CSV preview and diagnostics → explicit operator approval → atomic admission through the existing bank import authority → saved receipt and observed-source discovery. This does not post, match, classify tax, settle invoices or establish required-source completeness. Existing JSON import and bank allocation authority remain unchanged.

The supported reviewed profile is `bank_csv_utf8_v1`: UTF-8 (optional leading BOM), explicitly selected comma/semicolon/tab delimiter, LF or CRLF record endings, RFC-style double quotes and doubled-quote escapes (including quoted delimiters/newlines), a mandatory unique header, explicit date/description/signed-amount columns and optional provider-ID column. Dates are explicitly YYYY-MM-DD or DD/MM/YYYY; decimal separator is explicitly dot or comma; sign orientation is explicitly inflow-positive or outflow-positive. No locale guessing, thousands grouping, currency inference or automatic reordering. Unused columns remain in original records and produce review warnings. The operator declares bank source/account, currency/scale, inclusive interval and independent opening/closing minor-unit totals plus a completeness assertion/basis.

Bound this first slice to 64 KiB original bytes, 200 data records, 32 columns and 4000 bytes per field. Normalized evidence must fit the existing 65536-character/262144-byte evidence authority. Larger work is refused visibly, never admitted in truncated form. IMP-03 chunking/leases and broader provider profiles remain separate.

Content is immutable book-scoped bytes keyed by SHA-256. Occurrence identity is `(book, sourceSystem, sourceAccountId, occurrenceKey, sourceRevision)`, supplied separately from its content hash and filename. Identical bytes can have distinct occurrences; the same occurrence cannot change content or acquire a second admission. Mapping edits create new immutable previews, not overwritten interpretations. Admission calls existing `create_evidence` and `import_bank_statement` with deterministic internal command keys under the same book lock. No alternate observation/matching/ledger authority is created. Existing importer overlap/profile constraints remain authoritative, including the current synthetic-only admission gate.

## Risks and acceptance cases before implementation

- Identical byte content under two distinct declared occurrences remains two provenance records; retrying the same occurrence with changed content or metadata fails, and retrying admission cannot duplicate observations.
- Preserve BOM, exact bytes, line endings, quoted delimiters, escaped quotes, multiline text, blank fields, row ordinal and physical-line/byte locators. Never collapse equal transactions.
- Invalid UTF-8, NUL, bare CR, mismatched configured line endings, unclosed quotes, text after closing quote, embedded quote in unquoted text, blank records, too many rows/columns or oversized fields produce blocking diagnostics tied to retained bytes.
- Reject ambiguous/non-calendar dates, unsupported decimal/grouping syntax, excess fractional digits, money overflow, out-of-interval records, wrong widths/headers, duplicate provider IDs and control-total disagreement. Money uses exact numeric integer operations, never binary floating point.
- A structurally incomplete or partly invalid preview cannot be approved/admitted. Every data record must yield one observation. Original bytes and rejected-record diagnostics remain retrievable.
- Scoped token/session and book authority are checked in every public SQL operation. Operator approval binds immutable preview digest, selected interpretation and current dependency versions; expiry, role loss or changed source/configuration blocks admission.
- Persist approvals, normalized evidence links, stable statement/occurrence identity and replayable receipts. Admission writes all observations and the receipt together or rolls back. No posting, matching, payment or invoice residual side effect.
- Preview/discovery counts describe observed sources only. Unknown sources, opening basis, VAT, liabilities, company facts and legal classification stay unknown.
- UI file read races cannot attach old bytes to a new selection. No private bytes in localStorage, URLs, logs, fixtures or source code. Network uncertainty retains command keys; saved discovery recovers state after reload.
- Source control was removed by the user. Do not initialize Git, recover history, restore/delete files or commit. Existing migrations through0900 are immutable.

## Implementation status

Design and risk cases recorded. No code/runtime claim yet. Root owns shared exports/API/capability catalog, Drizzle dispatcher and schema mappings, Better Auth composition and workspace mount. Worker can format/lint owned files only; no tests, fixtures, DB writes, migrations, servers, builds or dependencies.
