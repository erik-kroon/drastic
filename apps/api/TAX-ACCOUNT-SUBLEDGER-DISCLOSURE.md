#5400 tax match / retained subledger-basis disclosure — failure contract

This is a factual public-read overlay, not an exclusivity or accounting-role policy.

Pre-code inspection:4100's public `get_tax_account_match` authorizes scope, takes the book
read barrier and calls private `tax_account_match_view`. Only its public statement/HTTP/MCP
read uses the wrapper. The private view also feeds list/control/dependency/correction owners;
those must remain unchanged.1500 `subledger_basis_lines` is unique by exact
(book_id,voucher_id,line_id), with one immutable basis per(book_id,schedule_id).

Failure contract:

- Select only an exact book/voucher/line identity, never equal amount/account/evidence or
  globally assumed line ID. Scoped authorization and NotFound behavior precede disclosure.
- Return the retained schedule ID, basis digest and exact line identity outside saved match
  bytes. Null means no retained basis reference for that pair, not compatible roles.
- Include the factual reference for historical/unmatched or currently unusable matches too;
  do not classify it as an active conflict, assess compatibility or suppress the history.
- Preserve original match/unmatch/active/usable values exactly. Do not change the private
  view, control/dependency/currentness/eligibility functions or physical guards.
- Isolate the public response contract from the shared private-view/list/control schema.
  Update only the existing public read's decoder/schema; no new endpoint or registry key.
- No approval/command material, whole basis/source inputs, allocation release, new artifact,
  financial calculation, accounting role, legal inference or tests/runtime execution.
