# One-shot tax-account classification resolution

## Current ownership

Application operations live in [application/vat/tax-account.ts](../src/application/vat/tax-account.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Selected failure contract — before implementation

A retained event classified `unknown` currently cannot be matched and remains unknown in
controls. Add one immutable, evidenced operator resolution to an existing supported non-unknown
classification. This is not reclassification of known events, a financial posting, a VAT
settlement role, legal activation or a completeness claim.

- Keep original statement/event bytes, statement digest, amounts, dates, account and source
  identities unchanged. Exactly one resolution per book/event; no supersession or withdrawal.
- Current operator authorization, book lock and exact-key replay precede fresh checks.
  Require original statement digest, scoped retained evidence, rationale and one of
  `tax_charge`, `tax_credit`, `interest`, `payment`, `transfer`, `other`.
- Refuse originally known or already-resolved events on fresh keys. Preserve successful replay.
  Bound the complete resolution inventory to1000/book under the book lock; never truncate.
- Resolution body: `id`, `digest`, `scope`, `eventId`, `statementId`, `statementDigest`, `input`,
  `evidenceSha256`, `createdAt`, `receipt`. Input: `expectedStatementDigest`, `classification`,
  `evidenceId`, `rationale`.
- Compact immutable resolution reference: `id`, `digest`, `eventId`, `classification`.
- Read response: `statementId`, `statementDigest`, original `event` (id/ordinal/input),
  nullable `resolution` (full body), and `effectiveClassification`. No original storage fetch.
- `tax_account_match_basis` must use the effective classification and conditionally capture
  `classificationResolution` (compact reference). Leave original event capture unchanged.
  Originally unknown events had no valid old matches; one-shot resolution cannot later change.
  Existing match usability, reservations, unmatch and correction guards remain unchanged.
- New control captures use `synthetic_tax_account_gl_control_v3`, include
  `classificationResolutions` (compact references for selected events), and derive unknown IDs
  from the same effective classification. Preserve every other amount/gap/matching calculation,
  old v1/v2 bytes, all-or-refuse limits and false coverage/reconciled/financialCloseReady claims.
- Extend account dependency hashing and whole-book closing dependencies with resolution
  inventory only when nonempty; unchanged accounts/books retain their previous dependency
  shapes/digests. Closing fields: optional `classificationResolutionCount` and
  `classificationResolutionDigest`. Do not hash controls into their own dependencies.
- SQL names: `resolve_tax_account_event_classification(token,scope,event_id,key,input)` and
  `get_tax_account_event_classification(token,scope,event_id)`.
- REST: POST `/tax-account/events/:id/classification-resolution` (operator only) and GET
  `/tax-account/events/:id/classification`. Existing entity/book prefix applies.
- Statement/handler names: `resolveTaxAccountEventClassification`,
  `getTaxAccountEventClassification`. Read-only MCP: `tax_account_get_event_classification`
  with `{scope,eventId}`. No MCP resolution mutation.
- Schema names: `ResolveTaxAccountEventClassification`, `TaxAccountEventResolution`,
  `TaxAccountResolutionReference`, `TaxAccountEventClassificationView`.

Implementation is authorized within this contract. Migration6700 is reserved after a fresh
filename scan. No tests, fixtures, SQL compilation/application, application/runtime/provider
execution, UI expansion, commits or pushes are authorized. Source and static checks are not
runtime proof.

### Implemented source — not database-applied

Migration `6700-tax-account-classification-resolution.sql` adds one append-only resolution
owner with a same-book event foreign key, same-book evidence foreign key, unique book/event
identity and immutable-row trigger. The runtime role has no table access. The operator
command serializes on the book, replays the exact event/input request before fresh checks,
and refuses originally known events, second resolutions, stale statement digests, missing
review evidence, unsupported labels and the1000/book bound. A fresh command key cannot
replace an existing resolution. No statement, event, source mapping, matching reservation,
posting, period or original approval is changed.

The scoped read returns the original event, immutable statement identity/digest, nullable
full resolution and effective classification. The original statement getter and its stored
body remain unchanged. This read does not fetch source object content. Classification review
alone does not require an active account or open period; the existing match workflow still
requires both and every other original eligibility check.

#### Matching and controls

The shared private classification read supplies the same effective label to matching and
control capture. A resolved event's match basis adds only the compact
`classificationResolution` reference. Its embedded original event still says `unknown`.
Originally known events retain their previous basis shape and digest. The existing physical
capacity admission recomputes this extended basis; whole-event/whole-line uniqueness,
amount/date/account checks, reservations, usability, unmatch and correction guards are not
replaced. Resolution itself neither matches an event nor releases any capacity.

New controls use `synthetic_tax_account_gl_control_v3`. They retain original statement
bodies and separate compact `classificationResolutions` in statement/ordinal order.
`unknownClassificationEventIds` uses effective classification. Amounts, opening and closing
balances, gaps, overlaps, balance breaks, ledger population and matching residuals use the
unchanged calculations. The8MiB artifact bound and all false readiness/coverage claims
remain. Old controls and exact successful-key replay retain their original v1/v2/v3 bytes.

#### Currentness and historical reads

The complete resolution inventory refuses an over1000 book before any scoped aggregation.
Account-control dependencies include only resolutions belonging to overlapping statements
for that exact account. An empty selection contributes no fields, preserving the prior
dependency digest. Whole-book closing dependencies add `classificationResolutionCount` and
`classificationResolutionDigest` only when at least one resolution exists. Their digest
covers the ordered immutable resolution ID/digest inventory. Controls are not included in
their own account dependency hash.

A resolution therefore makes affected saved controls noncurrent without rewriting them.
The existing VAT dependency composition also changes closing and accountant-review basis
currentness through the whole-book helper. Unrelated accounts retain their dependency shape
until some other existing dependency changes. No account/profile version or writer epoch is
bumped. No new legal classification, VAT fact, settlement effect, coverage assertion or
financial-close permission follows from a resolved label. Existing historical read and
successful replay paths remain available.

#### Source review and limits

The SQL packet replaces only `tax_account_match_basis`, `create_tax_account_control`,
`tax_account_dependency_digest` and `tax_account_close_dependencies`. The original4100
bodies were compared directly: other match eligibility and control calculations are
unchanged. New runtime grants cover only the two scoped command/read functions; private
helpers and the new table remain revoked.

This worker reviewed source deltas and whitespace only. It did not add tests, compile or
apply SQL, execute the application, contact providers, change UI or use VCS. Contract,
transport and shared static integration are owned separately. SQL validity, transaction
behavior and database/runtime results remain unverified.

### Live unresolved-event worklist — failure contract before implementation

Migration6800 adds discovery for the existing operator resolution command, not another saved
artifact. Require an account from this book's tax-account source register. Read current
scope authorization and hold the book SHARE barrier; do not mutate or access original storage.

- SQL `list_unclassified_tax_account_events(token,scope,account_id,after_cursor)`.
  Statement/handler `listUnclassifiedTaxAccountEvents`; GET `/tax-account/events/unclassified`
  with required `accountId` and optional `after`; read-only MCP
  `tax_account_list_unclassified_events` input `{scope,accountId,after?}`.
- Response `{scope,accountId,items,scanned,next,consistency}`. Items reuse
  `TaxAccountEventClassificationView`, only effective `unknown` entries. `scanned` is0–50;
  `consistency` is literal `live_unclassified_events`; `next` is nullable bound cursor.
- Scan at most51 retained event identities in C-order by ID for lookahead. Materialize the
  first50 BEFORE classification filtering. Emit continuation from the last EXAMINED event,
  not the last returned unknown. Empty items can still have next; callers must continue.
- Reuse `tax_account_event_classification` for each examined event's effective state. Original
  data and resolutions remain unchanged. No fresh control or command receipt is created.
- Cursor `taue1:<64 lowercase hex context digest>:<eventId>`, maximum199 characters. Context is
  digest of canonical `{entityId,bookId,accountId}` (normalizing scope fields), without the
  `sha256:` prefix. Validate syntax/context and a real same-account retained anchor. An anchor
  may have been resolved since the prior page; do NOT require it to remain unknown.
- Only omitted/internal empty cursor starts page1. Reject malformed, foreign-context and
  nonexistent anchors. Exact50 final scanned rows have null next;51 requires continuation.
- This is a live worklist, not a frozen inventory or completeness certificate. New arrivals
  or resolutions between pages can change membership; restart for arrivals. Recheck through
  the command's normal one-shot guards. Account/statement/control/matching history stays intact.

No tests, SQL compilation/application, runtime/provider execution, UI changes or VCS actions.

#### Worklist implementation — source only

Migration `6800-tax-account-unclassified-worklist.sql` adds the scoped, read-only SQL owner.
Current authorization and a book SHARE barrier precede the registered-account and cursor
checks. The cursor hashes only normalized entity, book and account fields. Its anchor must
be a retained event of that account; a later resolution does not invalidate the anchor.
Malformed, oversized, foreign-context, null and nonexistent-anchor cursors refuse. Transport
omission maps to the internal empty string for the first page.

A materialized C-ordered identity window retains at most51 events. A second materialized
window selects the first50 before the existing classification helper runs. Filtering affects
only returned items, not `scanned` or the last-examined continuation identity. The lookahead
row is not classified. Zero through50 remaining identities return null continuation;
51 returns a cursor for the50th examined event, even if no unknown items were returned.

The response carries original event bodies and statement digests through the existing
classification view. No source, resolution, control, matching record, receipt or artifact is
written. The function does not grant resolution authority or claim a frozen inventory. A
later arrival may sort before an existing cursor; restart to discover such arrivals. Current
command guards still decide whether any discovered event can be resolved.

Only this migration and this implementation note are owned by this packet. Contracts,
transport and shared bindings are integrated separately. Source review is not SQL compilation,
database application, concurrency proof or runtime verification; none was performed here.
