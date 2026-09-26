# Permanent VAT fact withdrawal — VAT-01/04 prerequisite

## Current ownership

Application operations live in [application/vat/basis.ts](../src/application/vat/basis.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Status: implemented source; forward3700 is unapplied. Static checks do not prove database,
HTTP or concurrent-runtime behavior.

### Behavior and authority

An operator can permanently withdraw an erroneous VAT source identity with its exact
current revision digest, retained evidence and a reason. The command writes an immutable
withdrawal record and command receipt in one transaction. It does not rewrite the fact,
its source/review evidence, earlier drafts, amendment reviews or any ledger entry.

```text
withdrawVatFact(factId, expectedDigest, evidenceId, rationale, originalKey)
  authorize operator → book lock → exact-key replay
  pin latest revision → require no earlier withdrawal → retain evidence hash
  append withdrawal + receipt

vatReturnBasis → latest revisions + full withdrawal metadata
  calculateVatDraft(v2) → withdrawn_fact blocker → explicit exclusion
  seal draft → recheck exact current basis + mandatory withdrawal exclusion

basis digest → existing VAT dependency owner → closing/accountant currentness
```

The new REST route is
`POST /v1/entities/:entityId/books/:bookId/vat-returns/facts/:id/withdrawal`.
Its input is `WithdrawVatFact`; output is `VatFactWithdrawal`. It uses `Idempotency-Key`.
Only the admitted operator may mutate. Ordinary MCP has no withdrawal command.

The withdrawal pins fact ID, revision ID/number/digest, evidence ID/hash, rationale,
actor, command key and timestamp. One withdrawal per fact identity is permanent. Repeating
the exact original key/input returns its retained receipt; different content under that key
conflicts. A new key for an already-withdrawn identity is refused. There is no reactivation,
implicit replacement, or deletion. A separately recorded correction remains a separate,
reviewed source identity, not an automatic copy.

### Calculation and recovery consumers

- **Revision writer:** a `BEFORE INSERT` fence on `vat_fact_revisions` refuses every new
  revision for a withdrawn identity. It uses the same book barrier as recording and
  withdrawal. The existing `record_vat_fact` code replays successful old commands before
  an insert, so old fact-recording receipts still return unchanged.
- **Live basis:** `vat_return_basis_body` retains every fact, including withdrawn facts.
  Each observation now includes `withdrawal: null` or the full immutable withdrawal body.
  Nothing is filtered from the bounded inventory.
- **Calculation:** the existing jurisdiction calculator emits `vat-return-draft-v2`.
  Withdrawn facts receive the explicit `withdrawn_fact` blocker and null contribution.
  Their amounts, other blockers and observations remain retained. Withdrawn identities
  no longer reserve source-component/expense/ledger-line duplicate keys against a
  separately reviewed active correction. Active duplicate checks remain unchanged.
- **Sealing:** new drafts must use v2. SQL rechecks the complete live basis and refuses a
  withdrawn fact unless it is excluded, has a null contribution, and names `withdrawn_fact`.
  Successful old draft-command replay precedes these new checks and retains its v1 bytes.
- **Fact reads:** existing HTTP/MCP fact reads return unchanged `current`/`history`, plus
  the separate live withdrawal. Existing basis reads return withdrawal evidence too.
- **Historical draft/amendment reads:** contracts accept saved v1 bases without the new
  optional observation field, and both v1/v2 engine tags. Reads return retained bytes;
  no historical calculation runs. Live basis currentness is separate.
- **Amendment comparison:** forward3700 permits v1/v2 retained outputs through the existing
  comparison function. It still subtracts stored values without rerounding or recalculating.
  A withdrawal does not change the old fact digest; its exclusion changes the assessment,
  and the full replacement basis retains the withdrawal evidence.
- **Closing/accountant review:** the existing VAT dependency helper hashes the new live
  basis. Latest closing and accountant providers already consume it. No shared closing
  helper is replaced. Withdrawn facts still count as represented sources; withdrawal cannot
  turn missing tax controls into a passed or not-applicable close decision.

The explicit observation field changes live basis digests for existing populated books
when3700 is adopted, even before a withdrawal. Pre3700 artifacts remain historical and may
become non-current; they are not rewritten. Later withdrawal changes the basis again.
This conservative new-engine boundary does not infer that an old saved calculation was
wrong when it was captured.

### Scope and failure review

Withdrawal is source usability, not legal tax treatment, filing correction, settlement,
source completeness, zero tax, or financial-close readiness. All earlier profile and filing
limits remain. The inventory stays bounded at200 identities with20 retained revisions each;
withdrawal does not free a slot or erase history. Its table has one row per existing fact.

Source review traced the only current fact insert owner, the physical revision fence,
`prepareVatDraft`, the jurisdiction calculator, draft sealing, existing fact/basis read
capabilities, amendment comparison/review/read, `vat_return_dependencies`, and the latest
closing/accountant provider definitions. It covered wrong-book facts/evidence, stale
revision, operator admission, record-versus-withdrawal ordering, original-key recovery,
new-key attempts, v1 historical response decoding, preserved excluded rows, active duplicate
claims and withdrawal after amendment review. These paths were not executed.

The existing frontend blocker dictionary is exhaustive. Root owns its new `withdrawn_fact`
message and any later withdrawal UI. This backend slice adds no browser controls or tests.

### Integration and checks

Files:

- `migrations/3700-vat-fact-withdrawals.sql`
- `src/db/statements/vat-amendments.ts`
- `src/transport/http/routes/vat-returns.ts`
- `../../packages/contracts/src/vat-returns.ts`
- `../../jurisdictions/se/src/vat/calculation.ts`

The already-composed `VatReturnsApi` / `VatReturnsHandlers` expose the withdrawal route.
The existing `vatAmendmentStatements` spread automatically picks up `withdrawVatFact`:
`[token, scopeParameter(params), params.id, idempotencyKey, JSON.stringify(input)]`.
No new package export, API group, capability binding or ordinary MCP mutation is needed.
Shared API/contracts checks remain root-owned. Frontend must add `withdrawn_fact` to
`apps/web/src/components/vat-returns/blockers.ts`; existing basis/fact contracts carry the
new metadata for other callers.

Owned TypeScript Oxlint passed with zero warnings/errors. Owned TypeScript/document Oxfmt
and `git diff --check` passed. No tests/fixtures/test helpers, runtime scenarios, migration
application, external calls, browser actions, commits or deployments were performed.

Suggested plan05 wording: “Forward3700 adds permanent evidence-backed VAT fact withdrawal.
New revisions are refused, retained histories and successful old-key replay remain, and the
existing calculator's v2 explicitly excludes withdrawn observations without deleting their
amounts/reasons. Live basis changes stale existing VAT closing/review dependencies; saved
v1/v2 drafts and amendment reviews remain readable without recalculation. This is source
usability, not tax/legal activation, filing or completed VAT-04 acceptance. Runtime proof
remains open.”
