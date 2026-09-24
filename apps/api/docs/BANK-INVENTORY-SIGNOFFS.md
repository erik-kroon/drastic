# Whole declared bank-inventory signoff (4300)

## Failure cases before implementation

3500 signs one selected account. No all-account signoff exists in the maintained source.
This packet must aggregate existing immutable signed3500 artifacts, never prepare reports or
account signoffs itself, reconcile again, import, match, post, waive or close anything.

- Require the latest evidenced period inventory with `bank_sources=required` and1–100 declared
  accounts. Missing/unknown/unsupported/not-applicable bank applicability and empty inventory
  cannot become completeness by absence. Other source families remain explicitly outside scope.
- Require exactly one already signed3500 plan per declared account. Reject missing/extra/duplicate
  account or plan IDs, cross-book references, unsigned plans, stale dependency, different inventory,
  dates, currency or ledger cutoff. Any known undeclared bank source/unresolved coverage gap blocks.
- Keep the full declared inventory, each account plan/signoff and exact signed artifact hash/length.
  Verify immutable artifact bytes, not a caller-provided hash. No original source content is invented.
- Pin one whole inclusive accounting period, one conservative whole-book cutoff and common existing
  coverage dependency. Changed inventory/source/allocation/ledger/configuration makes capture stale.
- Capture and sign under the book barrier. Human signing requires current exact digest/version,
  operator role, retained evidence/hash and rationale. MCP may capture/read/list but never sign.
- Persist exact canonical prepared and signed JSON with SHA-256/UTF-8 length atomically. Bound at200
  captures/book,100 members and8 MiB/artifact; reject oversize rather than truncate or omit accounts.
- Authenticate before replay/read. Same-key retry recovers historical results, not fresh authority.
  Old prepared/signed bytes remain readable with separate live currentness even if new live scope
  exceeds existing coverage bounds. No recomputation may alter historical bytes.
- Coverage is only the declared bank inventory. Actual-company completeness and financial-close
  readiness remain false/unestablished. No closing/provider/matching action or waiver authority.

## Implemented flow and scope

```text
latest0930 evidenced required bank inventory (one exact accounting period)
 + complete set of existing signed3500 account plans (same current cutoff/dependency)
          ↓ capture whole-declared-inventory plan + exact canonical prepared bytes
          ↓ operator signs exact digest with retained evidence and rationale
          ↓ immutable signed bytes; authorized get/list + separate live currentness
```

The new4300 migration and `bank-inventory-signoffs` contract/routes/statements own only this
aggregate. They do not alter3500,2000 source coverage,1300 capacity reconciliation or closing
providers. Capture calls no account/report preparation and creates no imports, matches or posts.

The input is `{inventoryId, startsOn, endsOn, signoffPlanIds}`. Every supplied plan must already
have an immutable3500 signature. Sorted account IDs must equal the complete sorted declared
inventory exactly; both repeated plan IDs and repeated account identities are rejected. Inventory
must be the latest for its period, its bank family must explicitly be required, and it must contain
1–100 accounts. All known source accounts must be declared. The complete selected3500 coverage
reports must have no peer gaps or diagnostics, not merely no gap on their individually selected
account. Other family declarations are retained but outside this bank-only review scope.

Every member must share the exact scope, inventory body digest, whole-period dates, currency,
scale, current whole-book ledger sequence and2000 dependency digest. Account activity is checked.
3500 already requires complete capacity reconciliation, exact statement/evidence agreement,
source/allocation revision and independent opening/closing controls.4300 reuses that immutable
approved owner result; it does not implement another reconciliation engine. Each member's
plan digest, signature-plan binding and exact signed canonical content/SHA/UTF-8 byte length are
checked before capture. The complete plan and signature, plus original artifact hash/length/type,
are embedded. Original individual artifact bytes remain retrievable through3500; no replacement
or synthesized original document is stored.

The aggregate retains the complete original inventory, every selected account/member, a digest
of that complete member array, the inventory digest, common dependency/cutoff and check version.
Every plan says `reviewScope:whole_declared_bank_inventory`, `coverage:declared_inventory_only`,
`companyCompleteness:not_established`, and `financialCloseReady:false`. These fixed claims apply
even after signing. Required source completeness is limited to this evidenced declaration; there
is no assertion that the declaration contains all actual company bank accounts or obligations.
No closing, statutory, provider, waiver or posting authority is introduced.

## API and recovery

All routes live under `/api/v1/entities/:entityId/books/:bookId`:

| Method/path                                   | Handler/statement             | Response                   |
| --------------------------------------------- | ----------------------------- | -------------------------- |
| POST `/bank-inventory-signoff-plans`          | `prepareBankInventorySignoff` | `BankInventorySignoffPlan` |
| POST `/bank-inventory-signoff-plans/:id/sign` | `signBankInventory`           | `BankInventorySignoff`     |
| GET `/bank-inventory-signoff-plans/:id`       | `getBankInventorySignoff`     | `BankInventorySignoffView` |
| GET `/bank-inventory-signoff-plans`           | `listBankInventorySignoffs`   | `BankInventorySignoffList` |

Both writes require `Idempotency-Key`. Signing reuses the existing digest/version/evidence/rationale
contract but is a distinct operator-only command. Its evidence hash, actor, timestamp and receipt
are retained. Signing is not an MCP capability. Capture/read/list have normal scoped REST/MCP
access. Input validation does not confer operator authority; SQL enforces it before replay.

GET returns `{plan,signoff,preparedArtifact,signedArtifact,dependenciesCurrent}`. Prepared bytes
are exactly canonical(plan); signed bytes are exactly canonical({plan,signoff}). Artifact descriptors
include SHA-256 and UTF-8 byte length. Verify these before saving returned `content` as UTF-8;
never pretty-print or reconstruct the downloaded historical artifact. Signed artifact is null until
signed. Existing3500 signoffs embedded as members are attestations, not reusable posting approvals.

The common2000 dependency includes latest inventory, period version/lock, source/allocation
revisions, account versions/activity, statement evidence, configuration and conservative whole-book
ledger cutoff. The aggregate's currentness evaluates that same bounded owner once rather than
repeating an identical100-account dependency for each member. Member captures were checked equal
at capture; their signed rows/artifacts are immutable. A new alternative report or signature alone
does not supersede older current immutable reports/signatures. Any covered basis change marks the
aggregate stale and prevents fresh signing. Existing artifact bytes are still returned unchanged;
an exceeded live coverage bound returns false currentness rather than hiding historical bytes.

Authorize→book lock→replay is retained for both writes. Exact-key recovery returns original
results after current authorization, before new size/currentness checks. A different payload
conflicts. As in3500, an identical already-saved signature by the same operator can be recovered
under a new command key without manufacturing a new signature or timestamp; it remains historical
and GET reports currentness separately. A different actor or review payload conflicts. New capture
with a new key intentionally creates another immutable plan. No history is deleted or overwritten.

Bounds:100 members,200 captures/book,8 MiB for each complete prepared/signed artifact, plus all
existing2000/3500 inventory/report bounds. Oversized complete input is rejected, never truncated.
Both private tables are immutable, scoped by book, contain FK links to the inventory/plan/evidence,
and constrain stored content to its exact UTF-8 length and SHA. Only authenticated command EXECUTEs
are granted to the runtime. No new storage adapter, download route or UI is needed for exact bytes.

## Root integration

Owned files:

- `packages/contracts/src/bank-inventory-signoffs.ts`
- `apps/api/src/db/statements/bank-inventory-signoffs.ts`
- `apps/api/src/transport/http/routes/bank-inventory-signoffs.ts`
- `apps/api/migrations/4300-bank-inventory-signoffs.sql`
- this handoff and owning plan03.

Root-owned composition:

1. Add contracts export `"./bank-inventory-signoffs": "./src/bank-inventory-signoffs.ts"`.
2. Add `BankInventorySignoffApi` to shared `Api` and spread `BankInventorySignoffCapabilities`.
3. Spread `bankInventorySignoffStatements` in the query registry.
4. Compose `BankInventorySignoffHandlers` in the HTTP layer.
5. Add these application bindings (no signing capability):

```ts
bank_prepare_inventory_signoff: bindCapability(Capabilities.bank_prepare_inventory_signoff, "prepareBankInventorySignoff", (input) => [
  scopeParameter(input.scope), input.idempotencyKey, JSON.stringify(input.input),
]),
bank_get_inventory_signoff: bindCapability(Capabilities.bank_get_inventory_signoff, "getBankInventorySignoff", (input) => [
  scopeParameter(input.scope), input.id,
]),
bank_list_inventory_signoffs: bindCapability(Capabilities.bank_list_inventory_signoffs, "listBankInventorySignoffs", (input) => [
  scopeParameter(input.scope),
]),
```

Root owns shared typechecks, maintained wave status and any optional table mappings.4300 must
follow0930/2000/3500. Historical SQL and shared registries were not edited by this packet.

## Source reasoning and remaining evidence

Owned-file `oxfmt --write` passed for the three TypeScript modules and two domain documents.
Owned-file `oxlint` passed for the three TypeScript modules with zero warnings/errors.2000 and3500
were byte-identical after this packet. Shared type checks and integration remain root-owned.
No runtime checks, SQL execution, migration application, tests/helpers/fixtures, browser/UI,
provider/external action, dependency installation, deployment or VCS action was performed.

Source review traced exact account-set comparison;3500 signed artifact integrity and scoped
identity; whole-period/common-cutoff dependency comparison; peer coverage gaps; operator evidence;
atomic byte/hash/receipt capture; authorization/lock/replay order; bounded historical currentness;
and no accounting actions in the command call graph. Runtime and concurrency behavior are not
verified by static source review.

Pending observations when separately authorized: one and multiple declared accounts; duplicate
plan IDs and distinct plans for the same account; missing/extra/unsigned/cross-book members; old
inventory; different dates/cutoffs/currency/dependencies; inactive or known undeclared accounts;
peer gaps; empty/unknown bank applicability; source/allocation/ledger/inventory changes before
signing; exact-key response-loss recovery; operator denial; unchanged prepared/signed bytes after
staleness; all size/count bounds; and independent verification of aggregate and individual artifact
SHA/length. No tests, fixtures or test helpers are added.
