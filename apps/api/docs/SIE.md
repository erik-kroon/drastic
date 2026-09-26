# Synthetic SIE 4I transaction artifacts

## Current ownership

Application operations live in [application/sie/import.ts](../src/application/sie/import.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

### Scope and acceptance recorded before implementation

This slice transfers every complete `movement` voucher from one immutable accountant-review
pack into an explicitly synthetic SIE 4I `.SI` artifact. It is not SIE 4E, a complete-book
export, an opening balance, SIE 5, an import, statutory acceptance or certified compatibility.
No upload, signature, external import or delivery is performed. Existing pack JSON/CSV
contracts and bytes remain unchanged.

Source: `docs/sources/sie-4c-review.md` and the locally retained official SIE 4C edition
2025-08-06 PDF (SHA256 `96fcd3f7931b2aa22d18fbd518a33f863b57edd5562a78af195251e2bf38bac1`).
The source requires real CP437 bytes, mandatory identification records, balanced complete
vouchers and numeric voucher order within each series. Account declarations are recommended.
Literal backslashes are refused in this bounded encoder; embedded quotes are escaped.

Proposed path:

```text
explicit pack digest + all-movement selection + legal name + retained identity evidence
  -> immutable scoped capture and receipt (short database transaction)
  -> exact deterministic CP437 rendering in the owning Effect workflow
  -> scoped seal checks capture digest, byte hash/length and size (separate transaction)
  -> immutable retained artifact, list/read/download; explicit retry resumes captured work
```

Required failure/acceptance cases:

- Wrong-book pack/evidence/capture cannot be exported, resumed or read. Source-backed legal
  name is supplied explicitly, never inferred from a book label; evidence does not establish
  real-company applicability. Only native synthetic SEK packs with currency scale 2 are supported;
  this narrow release does not infer ISO currency validity from three arbitrary letters.
- Same actor/scope/key/input returns the same capture and sealed bytes. Changed input conflicts.
  A render failure leaves the capture available for diagnosis, not a false ready artifact.
  A lost seal response is recovered by immutable capture identity; another seal cannot replace
  bytes. A different actor cannot seal the original actor's capture.
- Empty movement sets, incomplete/gapped voucher ordinals, mixed voucher metadata, duplicate
  fiscal-year/series/number collisions, duplicate account codes and unbalanced amounts refuse.
  Line identity is `(voucherId, lineId)` within the scoped book: reuse across different vouchers
  is accepted; duplicates within one voucher refuse.
  Opening and excluded-after-end rows are never exported. No live voucher read during render.
- Capture binds pack digest, retained source rows/accounts digest, legal-name evidence hash,
  explicit selection, generated-on date and generator/specification versions. Later posting,
  account edits or reopen cannot change captured rows or artifacts. Historical pack selection
  is allowed and is visibly not a current-book completeness assertion.
- Input text must be exactly representable in CP437. Refuse control characters, unsupported
  Unicode and literal backslashes rather than replacement/transliteration. Preserve Swedish
  letters, quoted text, negative/zero values and exact amounts beyond JS safe integers.
- Render records in group order, voucher numbers numerically within series, lines by retained
  ordinal, with CRLF and no BOM. Include mandatory4I headers, explicit currency and #KONTO;
  emit no balance records. Reject nonnumeric account codes and unsupported series.
- Capture is bounded by existing pack limits (1000 vouchers/5000 lines/1000 accounts) and an
  8 MiB source limit; binary artifacts are limited to8 MiB. Sealing validates canonical base64,
  exact SHA256/byte length and immutable capture digest. It does not claim independent format
  validation or destination acceptance. Runtime cannot write ledger tables.
- Saved list pagination pins a high-water ordinal. Each full read provides exact manifest and
  base64; browser verifies scope, bytes/hash/size before offering a binary Blob download. The
  warning explains that importing can create duplicate transactions in another system.

No test/fixture additions, database/server execution or external validation are authorized
for this owner. Static checks cannot prove any runtime or accounting acceptance case above.
Root owns integration and allowed native/API/browser evidence; independent consumer acceptance,
actual company profile and legal review remain separate gates.

### Source implementation and integration

Implemented source: `1100-sie-transaction-artifacts.sql`, `packages/contracts/src/sie.ts`,
`jurisdictions/se/src/sie/encoder.ts`, `src/application/sie.ts`, `src/db/statements/sie.ts`, and accountant-review
`sie-panel.tsx`/`sie-copy.ts`. The existing pack inspector mounts the new local panel;
raw pack tables, rows, contracts and JSON/CSV generators are unchanged.

`PrepareSie` requires `packId`, `packDigest`, `selection: all_pack_movement_vouchers`,
`legalName` and `legalNameEvidenceId`. Dates and source scope come from that exact immutable
pack. The capture author and UTC capture date are server-owned. `#GEN` uses this pinned date;
an unsealed capture cannot first seal on a later UTC date. Create a separate capture/key in
that case. An already sealed artifact remains readable and replayable on later dates.

The encoder emits mandatory4I identification, `#VALUTA SEK`, a synthetic-only `#PROSA` warning, selected `#KONTO` declarations,
`#VER` and `#TRANS` only. Voucher text is omitted because the pack retains transaction text,
not an authoritative voucher-header text. Transaction dates and descriptions are retained.
Optional trailing fields are omitted, not shifted. Account codes are bounded to eight
positive decimal digits without leading zeros; other code shapes refuse rather than change.
Literal source backslashes refuse. The generated escape before an embedded quote is deliberate.
CP437 mapping is an explicit byte table; output is not a UTF-8 string mislabeled as PC8.

The captured data is immutable. Rendering occurs after capture transaction release and before
seal transaction acquisition. Seal checks pack/evidence/source/capture digests, generator,
canonical base64, SHA256, length, bounds and framing. It does not independently prove semantic
format validity; only the owning backend renderer supplies seal input through public routes.
The raw seal function is not a REST or MCP capability. A scoped runtime database client can
call the granted function, which remains a preparation-only, non-ledger trust boundary.
Captured-but-unrenderable work remains discoverable; no ready artifact is fabricated.

#### Root-owned shared map

1. Export `"./sie": "./src/sie.ts"` from `packages/contracts/package.json`.
2. Add `SieApi` to shared `Api`; spread `SieCapabilities` into shared contracts capabilities.
3. Spread `sieStatements` from `src/db/statements/sie.ts` into database `statements`.
4. Register `SieHandlers` in API composition.
5. In backend `capabilities`, bind `sie_prepare`, `sie_get`, `sie_list`, `sie_resume` to the
   exported `prepareSie`, `getSie`, `listSie`, `resumeSie` Effect functions, respectively.
   Use `{...Capabilities.sie_prepare, execute: prepareSie}` (and equivalents), NOT a generic
   one-query binding for prepare/resume: capture/render/seal is an owning Effect workflow.
6. Apply1100 after0810 and current forward migrations. No direct table grants are added.

| Internal database key   | SQL function              | Parameters including token                                    |
| ----------------------- | ------------------------- | ------------------------------------------------------------- |
| `captureSieTransaction` | `capture_sie_transaction` | token, scope JSON, command key, input JSON                    |
| `getSieTransaction`     | `get_sie_transaction`     | token, scope JSON, capture ID                                 |
| `sealSieTransaction`    | `seal_sie_transaction`    | token, scope JSON, capture ID, private byte/hash payload JSON |
| `listSieTransactions`   | `list_sie_transactions`   | token, scope JSON, cursor or empty string                     |

Public paths: scoped `/api/v1/entities/:entityId/books/:bookId/sie-transfers`: POST prepares
with the stable Idempotency-Key; GET lists; GET `/:id` reads capture plus nullable artifact;
POST `/:id/render` resumes the author-owned immutable capture. GET includes canonical base64
binary bytes, manifest, capture and source digests; the UI verifies and creates a binary
`application/octet-stream` Blob with `.SI` filename. There is no text re-encoding on download.
List cursors use the opaque `si1_` envelope over version, normalized entity/book scope,
cutoff and after ordinal. SQL rejects wrong-scope, malformed, out-of-range, missing-ordinal
and incomplete-page cursors. Responses include scope, cutoff, total, first and next. Membership
summaries contain only immutable capture identities and creation metadata; they do not return
mutable sealed state. Read a capture separately for its current nullable artifact. This list
never asserts that all company transactions were transferred.

The UI retains the first cutoff across First, retries, cached-page reuse and query invalidation.
Only explicit Refresh resets inventory membership. Creation can open its new capture directly
without silently widening an already reviewed list. The refresh label also explains how to
rediscover a newly saved capture after a render failure.

#### Verification status

Source reviewed only. The official cached PDF hash was checked before implementation; its
format passages were read. No tests, fixtures, dependency installs, database/server runs,
formatter/lint/type/build or other validation runs were performed for this slice. The user's
later instruction explicitly stopped validation. Root must not infer executable or independent
format acceptance from source delivery. D-04/D-08 and any external upload authority remain open.
