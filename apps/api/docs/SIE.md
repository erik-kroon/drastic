# SIE exports

Drastic has separate synthetic SIE4I transaction-transfer and SIE4E selected-book exports. Both retain exact CP437 bytes. Neither establishes company qualification, SIE certification or recipient acceptance.

The source review pins SIE 4C, edition 2025-08-06, SHA-256 `96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1`. It covers types 1–4, not SIE 5.

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
- `GET /:id/rows`: page immutable account, balance, opening-line and movement-line membership.
- `POST /:id/render`: resume attachment as the capture's author.

The capture covers the selected book through `asOf`. Earlier-than-year-end selections disclose year-to-date scope. It includes inactive accounts, raw opening and closing balances, raw nominal movements and complete native vouchers. Rendering never queries current account names, catalogue heads or live ledger rows. Repeating the same actor/scope/key/input recovers the same capture; changed input conflicts. Export does not post or consume an approval.

### Original dimensions and object balances

New captures use `openerp-sie4e-v3`. Retained v1 and v2 captures keep their version and interpretation. Migration `0024-sie-object-openings.sql` permits `opening_line` rows in the existing immutable membership table; it adds no financial write or privilege.

The profile freezes a map from native dimension codes, ordered by C collation, to SIE dimension numbers starting at **20**. Numbers below 20 have reserved meanings under section 8.17 and cannot be assigned by catalogue position. Native object codes remain quoted strings: `0012` does not become `12`, and case does not change.

The renderer emits `#DIM`, `#OBJEKT` and each line's original object group. Declarations use retained dimension revisions and captured object labels, including archived values. Conflicting retained labels for the same code refuse; the exporter does not choose a newer name or create a replacement code. Original revisions, source codes, exemptions and the distinct non-value states remain in each retained line's `originalDimensions`.

The independent comparison checks declaration numbers, codes and labels, plus every ordered transaction assignment, account, amount, date and description. Missing, changed or duplicate assignments and object controls refuse attachment. It checks opening plus movement equals closing for each account and each exported account/object pair, using movements parsed from the bytes.

The v3 profile emits `#OIB` and `#OUB` for each balance-sheet account/object pair present in opening or current movement contributions. Credit balances remain negative; zero opening and closing balances remain explicit. Each record names one dimension and one object. Two dimensions partition the same money independently and must not be added together.

Opening contributions use exactly one basis: prior native history, or the selected opening-set voucher. An opening-set voucher contributes once to opening balances and never to current movements. A date before that voucher refuses. Retained opening rows preserve their native identities, exact amounts and original assignment states; later backdated postings, catalogue edits or archives cannot change them. Objects used only in the opening remain declared.

The independent parser recognizes object controls in `export_validation` mode. Its default historical-import mode reports `unsupported_object_balances`. Explicit `synthetic_sie4_partition_v1` capture permits the retained partition owner to validate complete object openings, movements and closings against actual native journal tags. This profile requires a retained synthetic occurrence and grants no external source qualification. See [historical import ownership](SIE-HISTORICAL-IMPORT.md#current-retained-partition-owner). Section 6 permits omission of `#PSALDO`; this profile does not emit period balances or prior-year record families.

### Refusals and bounds

- Unsupported book profile, currency or scale.
- No established opening set or prior native history. Absence of history is not a reviewed zero opening.
- Missing account classification, non-four-digit account codes or nonzero nominal-account openings. Offsetting nominal object openings also refuse even when the account total is zero.
- Incomplete or inconsistent voucher membership, unbalanced amounts or dates outside the selection.
- Missing dimension revisions, conflicting retained labels or an opening that falls after the requested as-of date.
- Text outside CP437, control characters or literal backslashes. Embedded quotes are escaped; no text is replaced or transliterated.
- More than 500 accounts, 2,000 movement vouchers, 20,000 movement lines, 20,000 opening lines or 20,000 retained assignments across the selection. Bounded reads fetch one extra row to detect overflow.

The database also bounds capture bodies to 1 MiB, row bodies to 64 KiB and artifact bytes to 8 MiB. A failed render leaves the immutable capture discoverable with no attached artifact. Editing current labels cannot repair its frozen text; a different supported basis needs a new capture. Current access is required for recovery and reads.

## Verification

The focused native test is [sie-dimensions.e2e.test.ts](../tests/sie-dimensions.e2e.test.ts):

```bash
bun run test:e2e apps/api/tests/sie-dimensions.e2e.test.ts
```

It creates original postings, catalogue revisions and opening-basis selection through the real workerd API against disposable PostgreSQL. The test-only Wrangler environment supplies local R2 storage for retained SIE source bytes. It checks both opening representations, exact large integers, signed/zero object balances, all non-value assignment states, archive changes, backdated activity, authority, replay, altered bytes, unsupported text and nominal-opening refusals. Compatibility fixtures install read-only v1/v2 captures over API-created ledgers and exercise resume and byte recovery; they do not seed financial records.

The runner retains `test-results/e2e/sie-dimensions.SE`, `sie-dimensions-journey.json`, and paired `.SE`/`-journey.json` artifacts for `sie-prior_native_balance` and `sie-opening_set_voucher`. Each journey binds the capture, membership, parsed file and expected object controls. The source manifest, integrity result and suite reports identify the tested source. Prior runs move to `test-results/e2e-history/`. See the FWD-09 completion record for current evidence.

These are local synthetic observations. The user selected local completion first. Actual recipient import remains blocked on a named system/version and an authorized test company. Actual-company source completeness, browser behavior, prior-year record coverage and statutory acceptance are separate gates.

## Recipient reconciliation procedure

1. Run the focused command above. Keep its manifest and `source-integrity.json` with the exported bytes. Verify each file's SHA-256 against `exported.artifact.sha256` in the matching journey JSON; for example, run `shasum -a 256 test-results/e2e/sie-opening_set_voucher.SE`.
2. Record the receiving product, version, importer settings and reviewer. Import one file into an empty authorized synthetic test company for fiscal year 2026. Use a fresh test company for the other opening representation.
3. Confirm SEK and CP437 text. Both files declare dimension 20 (`Department`) and dimension 21 (`Project`). Preserve codes `0012`, `New` and `Case-A`, including case and zeroes, and the captured Swedish labels.
4. Confirm **one current voucher with two lines**. The opening voucher must not appear as an additional current movement. Match its series, number, date, descriptions and assignments against `parsed.vouchers` in the journey JSON.
5. Compare account controls: account 1930 opens at **125.00**, moves **125.00**, and closes at **250.00**; account 2999 opens at **-125.00**, moves **-125.00**, and closes at **-250.00**.
6. Compare every `expectedObjectControls` entry. On 1930, Department/0012 opens and closes at 125.00; Department/New opens at 0.00 and closes at 125.00; Project/Case-A opens at 125.00 and closes at 250.00. On 2999, Department/0012 and Project/Case-A each open and close at -125.00. The current unassigned credit remains in the account total without an invented object.
7. Retain the import log and receiving-system account, object and voucher reports, linked to the exact file hash. Any ignored dimension, recoded object, altered label, duplicate movement or amount difference keeps acceptance open. Record acceptance only for the observed product/version/profile.

Historical planning links and captures omitted from this source distribution remain in the private working archive.
