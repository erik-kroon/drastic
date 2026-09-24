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

## Implemented isolation

`5400-tax-match-subledger-disclosure.sql` forward-replaces only public
`get_tax_account_match`. The original authorization, book barrier, private-view call and
NotFound branch remain unchanged. The wrapper appends two fields outside the saved `match`:

- `subledgerBasisReference`: nullable `{scheduleId,basisDigest,voucherId,lineId}`.
- `roleCompatibilityAssessed:false`.

The join starts from the exact scoped match row and uses all three physical basis-line key
columns: book, voucher and line. Its basis digest comes from the immutable basis associated
with that schedule.1500 primary keys physically bound the result to zero or one; no limit,
amount/account matching, truncation or guessed economic role is involved.

This reports a retained registration even after unmatch or when the original match is unusable.
It is not a claim that two active financial roles conflict or that reuse is permitted. It does
not assess basis currentness, schedule eligibility, correction validity or legal readiness.
Null identifies no retained basis row for this exact pair, not proof of accounting compatibility.

### Actual consumers and historical compatibility

The new getter-only `TaxAccountMatchDetail` extends the existing view fields. The shared
`TaxAccountMatchView` remains unchanged, including its use in lists and saved control matches.
The existing public GET success schema, read-only capability output and its HTTP query decoder
use the new detail schema. No route, capability key, query statement or registry is added.

The private `tax_account_match_view` and every caller remain untouched. Existing matching
commands/replays, match/unmatch bodies, list items, controls, dependency digests, active-state
hashes, correction admission, currentness and physical guards therefore do not gain the new
fields. The wrapper does not call public `get_schedule`, schedule eligibility, basis evaluation
or any live provider.5300's independent reciprocal schedule overlay needs no shared helper or
cross-domain relationship schema.

## Source review and checks

Checked executable public-wrapper references, all shared response-schema uses,4100 match table
identity columns and1500 basis-line/basis primary keys. Compared the forward wrapper against
4100: only the local reference lookup and additive public envelope change. Source review covered
cross-book/other-voucher same-line isolation, no reference, retained inactive/unusable matches,
unchanged active/usable output, saved-control/list compatibility and no extra command material.
These are source findings, not executed database cases.

The owned contract and public HTTP decoder passed Oxlint with zero warnings/errors. Owned
Oxfmt and `git diff --check` passed. Shared type checks remain root-owned. No tests, runtime/SQL,
migration application, new accounting roles, provider calls or VCS history actions occurred.
