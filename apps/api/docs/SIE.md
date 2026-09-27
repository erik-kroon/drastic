# SIE exports

OpenERP has separate synthetic SIE4I transaction-transfer and SIE4E selected-book exports. Both retain exact CP437 bytes. Neither establishes company qualification, SIE certification or recipient acceptance.

The [source review](../../../docs/sources/sie-4c-review.md) pins SIE 4C, edition 2025-08-06, SHA-256 `96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1`. It covers types 1–4, not SIE 5.

## Owners

| Responsibility                             | Source                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| SIE4I workflow                             | [application/sie/book-export.ts](../src/application/sie/book-export.ts)               |
| SIE4I persistence                          | [db/sie-transactions.ts](../src/db/sie-transactions.ts)                               |
| SIE4E capture, render and attachment       | [application/sie4e.ts](../src/application/sie4e.ts)                                   |
| SIE4E scoped reads and writes              | [db/sie4e.ts](../src/db/sie4e.ts)                                                     |
| SIE4E arithmetic, rendering and comparison | [jurisdictions/se/src/sie/sie4e.ts](../../../jurisdictions/se/src/sie/sie4e.ts)       |
| Independent inbound parser                 | [application/sie-import-parser.ts](../src/application/sie-import-parser.ts)           |
| Original dimension assignments             | [application/dimensions/assignments.ts](../src/application/dimensions/assignments.ts) |

Application workflows own capture and sealing. PostgreSQL provides scoped persistence, grants and immutable records. The old procedural SQL implementation and its installation instructions are superseded; their historical account remains in this file's history through `d7d5ec5`.

## SIE4I transaction transfer

`openerp-sie4i-v1` transfers all complete movement vouchers from one immutable accountant-review pack. It excludes opening and after-period rows. It emits identification, account, voucher and transaction records, without balance records. It is not a full-book export.

The scoped `/sie-transfers` API prepares and lists captures. `GET /:id` reads a capture and its nullable artifact; `POST /:id/render` resumes rendering. The capture binds the pack, selection, identity evidence, generation date and renderer. Downloads use retained base64 bytes, not text re-encoding. The review UI verifies the hash and length before offering the `.SI` download.

The retained profile supports native synthetic SEK books at scale two. Complete voucher membership, exact amounts, representable text and current authority remain required. The FWD-09 observations below do not verify the separate 4I UI or transfer journey.

## SIE4E selected-book export

```text
Public prepare request
  → scoped transaction: freeze year, opening, accounts, lines and original assignments
  → outside transaction: render CP437 bytes, parse independently, compare retained facts
  → scoped transaction: recheck authority and evidence, attach immutable bytes and manifest
```

The scoped `/sie-book-exports` API provides:

- `POST /`: prepare with an idempotency key, fiscal year, as-of date, legal identity evidence and account classifications.
- `GET /`: list captures at a pinned ordinal boundary.
- `GET /:id`: read the capture and nullable artifact.
- `GET /:id/rows`: page immutable account, balance and line membership.
- `POST /:id/render`: resume attachment as the capture's author.

The capture covers the selected book through `asOf`. Earlier-than-year-end selections disclose year-to-date scope. It includes inactive accounts, raw opening and closing balances, raw nominal movements and complete native vouchers. Rendering never queries current account names, catalogue heads or live ledger rows. Repeating the same actor/scope/key/input recovers the same capture; changed input conflicts. Export does not post or consume an approval.

### Original transaction dimensions

New captures use `openerp-sie4e-v2`. Retained v1 captures keep their version and interpretation. The existing capture kind and persistence tables remain in use.

The v2 profile freezes a map from native dimension codes, ordered by C collation, to SIE dimension numbers starting at **20**. Numbers below 20 have reserved meanings under section 8.17 and cannot be assigned by catalogue position. Native object codes remain quoted strings: `0012` does not become `12`, and case does not change.

The renderer emits `#DIM`, `#OBJEKT` and each line's original object group. Declarations use retained dimension revisions and captured object labels, including archived values. Conflicting retained labels for the same code refuse; the exporter does not choose a newer name or create a replacement code. Original revisions, source codes, exemptions and the distinct non-value states remain in each retained line's `originalDimensions`.

The independent comparison checks declaration numbers, codes and labels, plus every ordered transaction assignment, account, amount, date and description. Missing, changed or duplicate assignments refuse attachment. It also checks account opening-plus-movement equals closing.

Section 6 makes object and period balances optional for 4E. This profile does not emit `#OIB`, `#OUB` or `#PSALDO`. It refuses explicit dimension assignments in the opening basis, including prior native history, rather than lose their representation. It does not claim a complete dimensional-opening profile or recipient import.

### Refusals and bounds

- Unsupported book profile, currency or scale.
- No established opening set or prior native history. Absence of history is not a reviewed zero opening.
- Missing account classification, non-four-digit account codes or nominal accounts with nonzero openings.
- Incomplete or inconsistent voucher membership, unbalanced amounts or dates outside the selection.
- Missing dimension revisions, conflicting labels or dimensional openings.
- Text outside CP437, control characters or literal backslashes. Embedded quotes are escaped; no text is replaced or transliterated.
- More than 500 accounts, 2,000 vouchers, 20,000 journal lines or 20,000 retained assignments. Assignment reads fetch one extra row to detect overflow.

The database also bounds capture bodies to 1 MiB, row bodies to 64 KiB and artifact bytes to 8 MiB. A failed render leaves the immutable capture discoverable with no attached artifact. Editing current labels cannot repair its frozen text; a different supported basis needs a new capture. Current access is required for recovery and reads.

## Verification

The focused native test is [sie-dimensions.e2e.test.ts](../tests/sie-dimensions.e2e.test.ts):

```bash
bun run test:e2e apps/api/tests/sie-dimensions.e2e.test.ts
```

It creates original postings and catalogue revisions through the real workerd API against disposable PostgreSQL. It checks exact codes and labels, account controls, unchanged ledger state, saved-byte recovery, archive changes, wrong-book reads, changed-key input, semantic mutations, conflicting labels, dimensional-opening refusal and CP437 failure recovery.

The runner retains `test-results/e2e/sie-dimensions.SE`, `sie-dimensions-journey.json`, the source manifest, integrity result and suite reports. Prior runs move to `test-results/e2e-history/`. See the [FWD-09 execution record](../../../docs/plans/16-comparison-reconciliation.md#fwd-09--failure-contract-before-implementation) for the current evidence.

These are local synthetic observations. Actual-company source completeness, recipient import, browser behavior, dimensional opening balances, prior-year record coverage and statutory acceptance remain open.
