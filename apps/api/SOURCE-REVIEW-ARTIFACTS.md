# Source interpretation review artifacts (3900)

## Existing path and missing behavior

The source-intake UI already downloads `JSON.stringify(preview)` and admission JSON from current
in-memory responses. Those are useful views, but they do not persist exact bytes or a capture of
review/admission state.3900 adds that missing durable capture. It reuses the retained0510 preview
and3200 lineage; it does not parse again, admit rows, create evidence copies or add posting authority.

## Failure cases before implementation

- Authenticate and authorize the book before any occurrence, preview, review or capture lookup.
  Exact selected preview digest and retained original SHA must agree. Unknown IDs cannot leak.
- Retain the complete immutable preview: mapping/profile, original record locators, all successful
  normalized rows, unsupported/rejected diagnostics, structural-completeness flag and source hash.
  A structurally rejected preview must not imply that absent parsed records mean an empty file.
- Preserve exact occurrence identity and immutable `(bookId,sha256)` content locator. Do not merge
  equal bytes/rows, manufacture original bytes or claim that object availability was checked.
- Capture current dependency/supersession/review/admission state under one book lock; name it
  `stateAtCapture`. Later changes cannot rewrite the saved bytes or masquerade as historical state.
- Never export approval IDs, approval command keys or reusable approval payloads. Use non-authorizing
  reviewer summaries only, including expiry at capture. Admission summaries omit approval IDs and
  inner import receipts. The export itself cannot approve or admit anything.
- Bound the complete review history and lineage before materialization. Refuse capture above200
  reviews for the selected preview,50 previews/49 lineage edges,200 captures/book or4 MiB JSON.
  Never silently drop reviews, normalized rows or diagnostics to fit a download.
- Canonical UTF-8 content/hash/byte length and receipt commit together. Same-key retries recover
  the original capture after current authorization; GET/list recover after reload without reparse
  or object-store access. Historical captures remain readable after source state changes.

## Implemented flow

```text
retained occurrence + original content locator
                  └→ selected immutable preview (exact digest)
                           + complete review summaries
                           + occurrence supersession/admission state
                           └→ saved canonical JSON + SHA-256 + byte length
                                      └→ authorized get/list; no live recomputation
```

`POST /source-previews/:id/review-artifacts` takes `{digest}` and an `Idempotency-Key`.
It saves the complete selected preview and all of that preview's retained review summaries under
one book write lock. The response is `SourceReviewCapture`: identity, source/preview digests,
capture actor/time, artifact hash/length/type and command receipt. Blocked, superseded and already
admitted previews can all be captured for diagnosis. No new approval is required because capture
has no accounting effect; ordinary scoped REST/MCP callers have the same book-read authority.

`GET /source-review-artifacts/:id` returns `{capture, snapshot, content}`. `content` is the exact
saved canonical JSON string, not reconstructed JSON. Encode it as UTF-8, verify byte length and
SHA-256 against `capture`, and save those unchanged bytes. `snapshot` is the same retained body
for contract-validated display. The artifact contains the original complete `SourcePreview`,
including its `version`, `mapping.profile`, explicit mapping, encoding/BOM/structural outcome,
records/locators, normalized rows, diagnostics, dependency capture and original preview digest.
This reuses the existing parser/version contract; no new parser implementation is introduced.

The original is referenced by `(bookId,sha256)`, byte length and media type, alongside the complete
retained source occurrence. Use that occurrence's existing original-download operation to obtain
the bytes and verify its SHA. Original bytes are not copied into the artifact, substituted, or read
from external storage. `original.availability:not_checked` prevents a capture from claiming live
storage availability. A structurally failed parse has no partial record collection; its diagnostics
and exact original locator remain present rather than being described as an empty source.

`stateAtCapture` is an immutable historical observation. It includes dependency currentness
(including supersession), the replacement preview ID, all selected-preview reviewer summaries,
and the occurrence's admission summary. `selectedPreviewAdmitted` distinguishes admission of the
selected interpretation from an admitted replacement. Every retained occurrence supersession edge
is included, but other previews' rows/diagnostics are not falsely described as part of this selected
interpretation. Retrieve those previews or capture them separately if needed.

Reviewer summaries intentionally contain only actor, rationale, expiry and whether expiry had
passed at capture. There is no approval ID, approval digest/version command, or approval receipt.
Admission summaries contain preview/digest, admitted actor/time, statement/evidence identities and
checkpoint; no approval ID or inner command receipt is exported. Original retention/preview command
receipts are retained as part of their existing immutable owner objects; they are not approval
tokens. The capture's `approvalAuthority:false` and `postingAuthority:false` are unconditional.
Even a nonexpired historical review is not usable approval authority. `coverage:not_established`
remains true to scope: this artifact cannot certify source completeness or supported tax treatment.

`GET /source-review-artifacts` discovers all retained captures in the authorized book (bounded
by the200-capture insertion limit). It returns compact identity/hash/length summaries, not full
source rows. Same-key retry with unchanged actor/input returns the same saved capture before new
state/size checks. A changed payload conflicts. A new key intentionally creates a new historical
capture; it never silently replaces one. GET/list do not touch parser, import, approval, object
storage or current review state. Neither later approval expiry nor role change changes old bytes,
but current authorization is required to retrieve them.

## Root integration

Owned modules extend the existing source-intake contract, statements and HTTP group:

- `packages/contracts/src/source-intake.ts`
- `apps/api/src/db/statements/source-intake.ts`
- `apps/api/src/transport/http/routes/source-intake.ts`
- new `apps/api/migrations/3900-source-review-artifacts.sql`

No new package export, API group, statement spread, HTTP layer, adapter or UI integration is
needed. Existing shared spreads compose the local additions. Root has added these bindings to
`apps/api/src/application/capabilities.ts`:

```ts
source_capture_review: bindCapability(Capabilities.source_capture_review, "captureSourceReview", (input) => [
  scopeParameter(input.scope), input.idempotencyKey, input.previewId, JSON.stringify(input.input),
]),
source_get_review_artifact: bindCapability(Capabilities.source_get_review_artifact, "getSourceReviewArtifact", (input) => [
  scopeParameter(input.scope), input.id,
]),
source_list_review_artifacts: bindCapability(Capabilities.source_list_review_artifacts, "listSourceReviewArtifacts", (input) => [
  scopeParameter(input.scope),
]),
```

All routes use `/api/v1/entities/:entityId/books/:bookId`:

| Method/path                                  | Handler/statement           | Response                   |
| -------------------------------------------- | --------------------------- | -------------------------- |
| POST `/source-previews/:id/review-artifacts` | `captureSourceReview`       | `SourceReviewCapture`      |
| GET `/source-review-artifacts/:id`           | `getSourceReviewArtifact`   | `SourceReviewArtifact`     |
| GET `/source-review-artifacts`               | `listSourceReviewArtifacts` | `SourceReviewArtifactList` |

The private `source_review_artifacts` table stores immutable body/content/hash/length/receipt
with scoped preview/occurrence foreign keys and byte/hash integrity constraints. Runtime gets
only three authenticated command EXECUTEs; no table writes or summary-helper execution.
Historical migrations remain unchanged;3900 has not been applied. Root owns any optional typed
maintenance table mapping and the shared typecheck.

## Source review and remaining proof

Owned-file `oxfmt --write` passed on the three changed TypeScript modules and three domain documents. Owned-file `oxlint` passed on the three TypeScript modules with zero warnings/errors. Historical migration hashes remained unchanged. Integrated API (including scripts), contracts and Swedish-domain type checks passed after shared binding integration. These checks do not execute3900 or prove financial/runtime behavior.

Source review covered book-scoped authorization, exact preview/original identity, original-body
digest reproduction, safe review/admission allowlists, no history truncation, atomic canonical
bytes/receipt, and historical recovery. This is not runtime or transport proof.

Pending observations when separately authorized: blocked/structurally rejected and superseded
previews; distinct occurrences with equal original SHA; capture before/after approval/admission;
expiry after capture without changed bytes; another scoped actor receives no approval bearer or
command material; cross-book/role-loss rejection; digest mismatch; concurrent capture/reparse or
admission; response-loss same-key recovery; all bounds; and independent UTF-8 length/hash plus
original-source hash comparison. No tests, fixtures, migrations, database execution, UI/browser,
external calls, dependency changes or VCS actions were performed.

## Forward5900: mapping-aware captured currentness

New captures now AND the existing dependency/supersession currentness result with the exact
retained occurrence's live two-way source-account mapping check. A source mapped to another
ledger account can otherwise leave the originally selected account's sourceRevision unchanged.
The new flag reports false for that conflict without blocking historical capture or inventing
admission authority. Fresh source approval/admission and preview GET use the same private check.
Unrelated source/account mappings do not stale this predicate.

Only new `stateAtCapture.dependenciesCurrent` calculation changes. Exact-key replay and old
capture retrieval return their saved bytes unchanged; no old digest, preview, review/admission
allowlist, capture bound or original-byte locator is rewritten. Shared authorization/book-lock
order and actor constraints are unchanged. See [SOURCE-INTAKE.md](SOURCE-INTAKE.md#forward5900-exact-source-mapping-currentness)
for the failure contract and source-only review boundary. No public schema or wiring change.
