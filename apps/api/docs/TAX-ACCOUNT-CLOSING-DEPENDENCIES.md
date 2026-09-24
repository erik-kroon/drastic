# Tax-account closing dependencies (3950)

## Gap and failure cases identified before implementation

The3800 register adds immutable tax-account statements and control snapshots. The1000
`vat_return_dependencies` provider sees VAT facts and saved drafts only.1510 consumes that
provider for technical close and accountant packs, so a not-applicable tax declaration could
ignore represented tax-account records.

Required behavior:

- Keep `sourceCount` as VAT fact-component count and `draftCount` as saved VAT-draft count.
  Do not merge tax-account rows into either number or infer tax facts from tax-account events.
- Add independent complete, bounded statement/control counts and deterministic inventory
  digests to the existing VAT dependency provider. Never hash a truncated register.
- Any represented statement or saved control contradicts not-applicable tax inventory and
  fails `VatReturnControlCoverage`. A zero balance difference is not row matching, tax source
  completeness, legal treatment or closing authority. Required tax coverage stays unavailable.
- Any new immutable statement/control must stale prior live closing/accountant dependencies,
  even if it changes no posted voucher, net balance, VAT fact or draft count.
- Preserve every1510 schedule/basis/snapshot control, bank and other provider check, dependency,
  stored artifact and receipt. The full extended VAT dependency must remain in every newly
  prepared accountant pack and export manifest through the existing owner path.
- Historical reads remain possible when the added live bounds are exceeded; they report stale
  rather than compare a partial inventory. Current prepare/approve/execute fail closed.
- Old-key replay keeps returning saved historical results after current authorization. It is
  not permission to execute an old proposal after its basis changed.
- New contract fields must be optional so historical snapshots and receipts still decode.
  Historical SQL files1000/1510/3800 are immutable.

## Implemented owner path

```text
tax_account_statements (immutable IDs/body digests)
+ tax_account_controls (immutable IDs/body digests/artifact hashes/lengths)
        ↓ private tax_account_close_dependencies(book)
        ↓ vat_return_dependencies(book).taxAccounts
        ├→ closing_basis VAT check, tax represented count, full dependency hash
        └→ accountant_review_basis → saved pack + every export manifest
```

The connected private `tax_account_close_dependencies(book)` returns:

```json
{
  "statementCount": 0,
  "controlCount": 0,
  "statementInventoryDigest": "sha256:…",
  "controlInventoryDigest": "sha256:…"
}
```

Both complete inventories are book-wide, sorted by ID with `COLLATE "C"`. Statement identity
uses `{id,digest}` from the3800 immutable body, which includes original/review evidence and all
retained events. Control identity uses `{id,digest,sha256,byteLength}` from the immutable snapshot
and its exact artifact. No balance difference, `reconciled` flag or assumed source absence grants
passing coverage.3800 creates source accounts/events only with the corresponding immutable
statement in one transaction; there is no independent register-write path to count here.

Each inventory is bounded at200 (the3800 write bounds). A201-row probe detects overflow before
materialization. The helper returns SQL NULL for an unavailable complete inventory; it never
returns a truncated JSON object. `vat_return_dependencies` treats NULL as `UnsupportedProfile`.
Historical closing/accountant read guards check that same helper and report stale without
rebuilding an unavailable live basis. This keeps the bound in the used domain owner rather than
copying tax-register limits into each consumer.

`vat_return_dependencies` preserves `sourceCount` as VAT facts, `draftCount` as saved drafts and
`basisDigest` as the existing VAT fact basis. It adds the whole helper output under `taxAccounts`.
The four existing readiness flags remain false. All callers must compare the complete dependency
object for closing/review currentness, not treat its original `basisDigest` as a tax-register hash.
Existing VAT-return draft calculations and their fact-basis currentness are unchanged.

## Consumer changes and preserved behavior

The new migration replaces the latest1510 bodies, not the older0800/1001 versions:

- `closing_basis`: `VatReturnControlCoverage` now requires zero VAT facts, drafts, tax-account
  statements and saved tax-account controls. The tax family adds the two independent counts;
  `expense_tax_and_vat_return_dependencies_v2` names the extended provider. Required-family
  full coverage stays unavailable. A not-applicable declaration cannot waive represented records.
- `closing_basis.dependencies.vatReturnDependencyDigest` already hashes the full VAT object;
  `ownerTaxStatus.vatReturns` already returns that same object. These paths retain the new grouped
  dependency without adding another parallel closing dependency.
- `accountant_review_providers_bounded`: checks the connected tax-account helper in addition to
  all prior bounds. `accountant_review_basis` still retains the full VAT dependency in its basis;
  only its existing bound-error text changes.
- `prepare_accountant_review`: the existing `vat_return_controls` coverage row remains
  `unavailable`; its detail now names separate statement/control counts, retained dependency
  digests, book-wide scope and the limits of aggregate comparisons. Original register rows and
  saved tax-account artifact contents are not falsely claimed to be embedded in this pack.
- The existing pack `basis.vatReturns` and every CSV manifest's `providerBasis.vatReturns`
  retain the complete grouped object. The pack's existing `basisDigest` hashes it. JSON export,
  exact bytes/hash storage, journal/evidence provenance, generator label and every other section
  are unchanged. There is no new artifact format or report framework.
- `get_closing_proposal` and `get_closing_certificate`: retain1510 subledger-bound handling and
  add the tax-account helper availability guard. Old rows remain readable with false currentness
  when this new live bound cannot be evaluated. Existing0810 accountant GET already uses the
  replaced bounded-provider function; no additional accountant read replacement is needed.

Every1510 schedule/basis/control snapshot check and dependency, active-bank consumer, commerce,
owner/expense provider, report prerequisite and family decision branch is unchanged. The only
substantive differences against1510 are the new helper/provider, the tax closing check/count/text,
the accountant bound/text and the historical-read availability guards.

Tax-account writers and existing preparation/approval/execution callers acquire the same book
barrier. A new statement/control changes the helper's count and inventory digest, so the full
closing dependency/basis and accountant basis change without requiring a voucher or VAT fact.
Existing closing approve/execute compare live basis before any fresh transition. Any prior saved
proposal/approval becomes stale. Preparing a current accountant pack captures the new complete
provider object. Read-only currentness compares live basis to the saved digest.

The first3950 live evaluation also differs from a pre3950 saved basis even for an empty register;
those old records are historical, not silently upgraded. New preparation is required. Old-key
replay still precedes live-basis checks after authorization/book locking. It returns unchanged
saved results and bytes; it does not grant fresh transition authority. No historical tables,
approvals, command receipts, artifacts,1000,1510 or3800 SQL are modified.

## Contract and root integration

`packages/contracts/src/closing-providers.ts` adds optional `VatReturnDependencies.taxAccounts`
with the four fields above. It is optional only for historical snapshots/receipts. New live SQL
always emits all four fields or fails closed. Existing closing and accountant contracts compose
this schema; no new REST/MCP routes, groups, application bindings, exports, adapter or DB mappings
are needed. Root owns shared type checks, wave/plan05 updates and migration scheduling.

The next4100 worker can replace only `tax_account_close_dependencies(book)` to add its complete
live matching dependency to the returned object. Preserve existing fields and return SQL NULL
when the entire current dependency cannot be evaluated within bounds. Existing full-object hashes
and manifests then carry it without replacing shared closing/accountant consumers. That worker
must extend the nested contract additively for new retained fields.3950 implements no matching
or matching coverage claim.

## Validation boundary

Owned-file `oxfmt --write` passed for the additive contract and this handoff. Owned-file
`oxlint` passed for the contract with zero warnings/errors. Shared type checks remain root-owned.
No SQL execution, migration application, runtime checks, tests/helpers/fixtures, UI/browser,
provider/external action, dependency install, deployment or VCS action was performed.

Source review traced3800 book locks and immutable bodies,1000 fact/draft semantics,1510 control
and manifest consumers,0800 stale-basis approval/execution guards, and0810 accountant recovery.
The generated3950 function diff was compared directly with1510 to keep unrelated branches
byte-identical. This is source reasoning, not observed database/transport behavior.

Pending observations, only if separately authorized: new statement with no ledger change; new
control with zero aggregate difference; contradiction of a retained not-applicable tax decision;
required-family unavailable coverage; new record after prepare/approve; before/after migration
old-key replay and unchanged exact artifacts; both200/201 inventory boundaries; bounded historical
GET behavior; cross-book isolation; unchanged schedule/native controls; and exact optional-field
decoding of old/new closing and accountant artifacts. No tests or test helpers are added.
