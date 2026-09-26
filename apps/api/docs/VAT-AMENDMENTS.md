# VAT draft amendments — VAT-04 bounded source slice

## Current ownership

Application operations live in [application/vat/returns.ts](../src/application/vat/returns.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

Status: implemented source; migration3300 is unapplied. No database, HTTP or concurrent-runtime proof is claimed.

### Behavior

```text
existing facts → existing prepareVatDraft / calculateVatDraft → immutable replacement draft
original draft + replacement draft → compareVatDrafts → exact impact digest
operator + impact digest + retained evidence → reviewVatAmendment → immutable relationship
getVatAmendment → same review bytes + both original draft bodies + separate live currentness
```

The comparison accepts only later, distinct, same-period saved synthetic demonstrations in
SEK at scale2, using `synthetic-core-v1` and the retained draft engine version.
Forward3700 permits retained `vat-return-draft-v1` and withdrawal-aware `vat-return-draft-v2` results. It does not prepare a
second tax calculation. `jurisdictions/se/src/vat/calculation.ts` remains the sole tax
arithmetic owner. The new SQL subtracts its retained outputs using exact PostgreSQL
`numeric`, not floating point. Unknown engine releases and actual-company draft mode are
refused rather than reinterpreted.

The impact retains:

- Both draft IDs/digests, basis digests, draft selections, engine version, book profile and
  profile version, ledger sequence and currency metadata.
- The full union of fact IDs, including unchanged and excluded rows. Each side retains its
  revision ID/number and complete assessment, with source digest and exclusion reasons.
- Signed contribution deltas for boxes05,10 and48. Absent/excluded contributions are zero
  _in the saved calculation_, not assertions that the source has no tax obligation.
- Before/after boxes05,10,48 and49, with exact minor-unit, reported-krona and residual
  differences. A missing box or unavailable reported figure yields a null difference;
  it never becomes zero. The code does not reround either draft.
- Each draft's unresolved return blockers. No change, including a zero-net change,
  suppresses fact-level differences.

The historical read returns both entire immutable drafts, including source observations,
evidence hashes, original fact inputs, ledger-line IDs and expense-review lineage. Mapping
lineage is the existing engine version plus captured book profile/version; this slice does
not invent a separate legal mapping release.

### Review, recovery and authority

`reviewVatAmendment` is operator-only. The operator must supply exact original/replacement
digests, the comparison's `expectedImpactDigest`, retained review evidence and a rationale.
Under the existing membership/book lock order, SQL recomputes the comparison from retained
bytes and checks that the replacement basis is still current. Original draft staleness is
allowed: preserving the old version is the purpose of the operation.

The review, receipt and evidence hash commit together. Exact actor/book/key/input replay
returns the original review before current-basis checks, so a lost response remains
recoverable after later source changes. Reusing a key for different content conflicts.
A different key for an already-reviewed draft pair also conflicts; list/get recover it
without creating a second relationship. Lists are complete and bounded at500 reviews per
book. Pair uniqueness, scoped foreign keys and immutable triggers back the command checks.

Reads require current scoped membership. Only approved entry functions are executable by
`openerp_runtime`; the table and private comparison helper have no runtime/public grant.

### Limits

This is an internal reviewed relationship, not return approval or an artifact handoff to a
tax authority. Both the impact and review explicitly retain `filingReady: false` and
`externalState: "not_submitted"`. Neither original nor replacement is called filed. The
workflow writes no vouchers, settlements, submissions, legal profiles or company facts.

Existing append-only fact revisions permit comparison of changed classifications, amounts
and exclusions. [Forward3700](VAT-FACT-WITHDRAWALS.md) adds permanent, evidence-backed fact
withdrawal and the consuming v2 exclusion behavior. It does not infer withdrawal from an
ordinary exclusion. There is no arbitrary future-engine comparison or automatic search
across all historical filings. Operators select exact saved drafts from the existing complete draft inventory.

The existing VAT closing dependency already blocks represented facts/drafts from technical
close. This slice does not change that helper, closing approvals or accountant-review pack
format. Amendment relationships are available through their dedicated list/get surface,
not silently added to an older pack's declared coverage. Full VAT-03/04 and legal gates
remain open.

### Files and shared integration

Owned files:

- `migrations/3300-vat-draft-amendments.sql`
- `src/db/statements/vat-amendments.ts`
- `src/transport/http/routes/vat-returns.ts`
- `../../packages/contracts/src/vat-returns.ts`

The3300 amendment slice leaves the draft application workflow and jurisdiction calculator
unchanged; forward3700 separately adds withdrawal consumption to that calculator. The
amendment transitions use the established Effect `query` boundary directly, as existing
fact recording does. The already-composed `VatReturnsApi` / `VatReturnsHandlers` gain these routes:

| Method | Relative path under `/v1/entities/:entityId/books/:bookId/vat-returns` | Meaning                                            |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| POST   | `/amendments/compare`                                                  | Read-only comparison of exact saved draft versions |
| POST   | `/amendments`                                                          | Idempotent evidenced operator review               |
| GET    | `/amendments/:id`                                                      | Historical review, drafts and live currentness     |
| GET    | `/amendments`                                                          | Complete bounded review inventory                  |

Shared integration is complete in source. Root added these bindings:

1. `src/db/query.ts` imports `vatAmendmentStatements` from `./statements/vat-amendments`
   and spreads it into `statements`.
2. The existing `VatReturnCapabilities` spread registers the three new read-only
   capabilities. `src/application/capabilities.ts` binds them as follows:

```ts
vat_return_compare_drafts: bindCapability(
  Capabilities.vat_return_compare_drafts,
  "compareVatDrafts",
  (input) => [scopeParameter(input.scope), JSON.stringify(input.input)],
),
vat_return_get_amendment: bindCapability(
  Capabilities.vat_return_get_amendment,
  "getVatAmendment",
  (input) => [scopeParameter(input.scope), input.amendmentId],
),
vat_return_list_amendments: bindCapability(
  Capabilities.vat_return_list_amendments,
  "listVatAmendments",
  (input) => [scopeParameter(input.scope)],
),
```

Root added these query/dispatcher integrations during implementation; they are visible in
source. Do not add the operator review command to ordinary MCP. No package exports or new
API group registration are needed.

### Source review and checks

Source review covered cross-book IDs/evidence, unknown engine/mode, same/reversed draft order,
interval mismatch, exact digest mismatch, incomplete/duplicate fact lineage, contribution/box
conservation, included-to-excluded transitions, new facts, offsetting changes, unavailable
box49/reported values, stale replacement, receipt replay after staleness, new-key duplicates,
review bounds and immutable history. These are reviewed code paths, not executed scenarios.

Owned TypeScript Oxlint passed with zero warnings/errors. Owned TypeScript Oxfmt passed.
`git diff --check` passed at the local checkpoint. Shared API/contracts type checks are
root-owned. No tests, fixtures, test helpers, browser actions, migrations, deployments,
external calls or commits were run.

Suggested plan05 wording: “Forward3300 adds an internal synthetic VAT-04 review subset:
exact same-period draft/version comparison with full fact inclusion/exclusion lineage,
box/contribution deltas, evidence-backed operator review, immutable history and exact-key
recovery. It retains the1000 calculator's engine/profile references and does not reinterpret
saved figures. It is not filing, settlement, legal activation or completed VAT-04 acceptance.
Migration/runtime/concurrency proof remains open.”
