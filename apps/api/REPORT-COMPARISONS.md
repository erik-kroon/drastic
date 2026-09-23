# Saved report comparisons (4600)

## Existing owner and failure cases before implementation

0120 retains synthetic trial-balance headers and every frozen account line.3400 adds movement
paging for one report/account and saved-header discovery. Neither compares two saved snapshots.
The latest0120 header omits currencyScale; live book scale is mutable, so old scale cannot be
safely inferred. Root approved only a forward prepare_report replacement to capture scale in new
headers. Historical bytes/replay remain unchanged; comparisons reject missing historical scale.

- Authorize the same book before reading either saved ID. Reject foreign/unknown IDs, unsupported
  report kind, missing retained scale and currency/scale mismatch. Never consult current book scale.
- Compare stored account lines only: no live account inventory, voucher query or recalculation.
  Keep frozen labels, report headers/IDs, full snapshot digests, intervals and committed cutoffs.
- Union stable account identities. Same code/name on different IDs is not one account. Missing side
  is null, never a manufactured zero. Per-account differences require both saved sides.
- Preserve signed formulas: movement=debit-credit; closing=opening+movement; difference=right-left.
  Different intervals/cutoffs are diagnostic arithmetic, not statutory/prior-year comparability.
- Full-side totals cover all retained lines, not only the page. Aggregate difference is unavailable
  if either side lacks any union account; do not imply absent representation is zero.
- Support at most10000 complete lines per report and100 union accounts/page. Refuse oversized
  inputs before hashing/aggregating rather than return partial financial totals or hidden truncation.
  Every account in an accepted pair remains discoverable in stable identity order.
- Cursor pins both report IDs/order and an actual union account. Reject malformed, switched-pair,
  cross-book and absent-anchor cursors. Later posts/renames cannot change any page or source digest.
- Read-only comparison writes no rows or receipts and has no close, opening, transfer, legal or
  filing authority. Do not label earlier postings as reviewed opening balances.
- New prepare_report differs from0120 only by retained scale; preserve every guard, lock, replay,
  line formula and receipt. No historical backfill or book metadata change.

## Status

Implementation in progress. No runtime/database proof.
