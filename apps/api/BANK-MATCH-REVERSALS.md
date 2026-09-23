# Reviewed bank unmatch — 1300

Status: domain source and shared API/MCP/database/workspace registration integrated; runtime and static validation unverified.

## Scope and failure contract (before implementation)

A reviewer prepares a whole applied allocation or one retained legacy exact match for
unmatch. The saved plan shows original relationships, evidence, exact released amounts,
periods and dependency revisions. Human approval binds that digest. Execution appends
one reversal receipt and releases matching capacity only. It never posts a voucher,
changes an invoice settlement, deletes history or reopens a period.

- Invalid/foreign/unexecuted/already-reversed targets refuse; no capacity changes.
- Whole allocation reversal includes every immutable leg (maximum 100). Partial leg
  compensation is outside this slice. Legacy match identities remain unique forever;
  rematching after reversal requires the existing reviewed allocation workflow.
- Repeated execution and lost replies recover one immutable receipt. A new key does not
  undo the target twice; changed digest/approval cannot replay another result.
- Capture and execution hold the existing admission/book barrier. Every affected source
  and posting date must have one open period. Changed source/account/profile/ledger or
  period revisions stale the plan. A relevant reversal or revoked/expired approving
  authority prevents execution without partial changes.
- Effective source and ledger capacity excludes reversed targets together, once. New
  allocations may consume the restored remainder; legacy exact APIs cannot silently
  return a reversed historical match as an active result or bypass capacity guards.
- Source revision advances transactionally, making old reconciliation/close bases stale.
  Old reports/receipts retain their original bytes. Live discovery distinguishes history
  from currently effective relationships.
- Recurring preparation, posting-capacity guards, reconciliation and correction/owner
  guards must use the same effective relationships. No second matching authority.
- Reversed vouchers and locked periods cannot acquire a new match via either old or new
  matching APIs. Unsupported source/period state fails closed.
- Helpers, views and tables stay private; only scoped authenticated operations are granted.
  Agent tools exclude human approve/revoke operations.
- UI actions are deliberate. Refetch, mount and discovery never execute a reversal.
  Retained plan discovery recovers after reload; unsaved drafts are not claimed durable.

These are source-review obligations and future acceptance cases, not new tests or proof.

## Delivered source (runtime unverified)

- `apps/api/migrations/1300-bank-match-reversals.sql`: append-only plans, approvals,
  revocations and reversal receipts; private effective-relationship views; scoped workflow;
  forward consumer replacements. No earlier migration was edited or applied.
- `packages/contracts/src/bank-match-reversals.ts`: six REST operations and four ordinary
  capabilities. Approve/revoke stay outside ordinary MCP.
- `packages/contracts/src/settlements.ts`: optional `unmatch` summary on allocation reads.
  Old stored execution/receipt contracts and bytes are unchanged.
- `apps/api/src/transport/http/routes/bank-match-reversals.ts`: Effect handlers using the
  existing authentication/capability/query boundary.
- `apps/api/src/db/statements/bank-match-reversals.ts`: fixed parameterized SQL statements.
- `apps/web/src/components/bank-match-reversals/{panel,review,notice}.tsx` and `copy.ts`:
  separate English/Swedish preparation, exact evidence review, human approve/revoke,
  execution, receipt, saved-plan paging and reload discovery surfaces.

```text
select applied allocation OR retained exact match + reason
  -> save complete original/leg/evidence/period/dependency snapshot
  -> inspect exact released amounts -> human approval of digest
  -> append unique reversal + advance bank source revision + command receipt
  -> active source/line capacities exclude that original relationship
  -> old reconciliation/close basis is stale; history stays unchanged
```

An allocation reversal always releases its whole original plan. No partial-leg reversal,
replacement matching, journal correction, invoice settlement or period reopen is performed.
Prepare a new reviewed allocation afterward if a replacement match is wanted. Any source
or posted line with unmatch history is refused by the legacy exact-match command, including
released allocation legs. The existing reviewed allocation workflow can use restored capacity.

### Effective consumers and old callers

The sole live projections are private `openerp.bank_active_matches` and
`openerp.bank_active_allocation_legs`. Their originals and new reversal tables are immutable.
The forward migration replaces these consumers without changing non-bank domain behavior:

- `bank_allocated_source`, `bank_allocated_line`, `bank_legacy_allocation_guard`;
- `get_bank_statement`, newly requested `import_bank_statement` results,
  `reconcile_bank` (latest bounded0101 definition), `reconcile_bank_capacity`;
- bank branches of `owner_guard_capacity` and `correction_impact_resources` (latest0890);
- `bank_add_match` retains physical historical uniqueness and refuses unmatch-history reuse;
- `get_bank_allocation` preserves original plan/approval/execution and adds an optional
  `unmatch:{planId,executedAt,reason}` summary;
- `bank_allocation_snapshot` / `bank_allocation_checked` lock and require open source/posting
  periods before account locks; reversed/reversing vouchers cannot acquire allocations;
- insert guards cover both legacy exact and reviewed allocation entry paths.

Current recurring selection/preparation and the recurring posting guard already use
`bank_allocated_source`; they therefore consume the same effective state without another
copy. Source revision advances once with the reversal receipt. Existing bank report,
allocation, recurring and technical-close dependency comparisons then become stale.
Old exact command replays still return the original historical receipt, never reactivate
capacity. New import commands returning an existing retained import show effective matches.
Old report bodies and old reconciliation reads are not regenerated.

**Integration conflict rule:** later migrations replacing `correction_impact_resources` or
`owner_guard_capacity` must retain these active bank view references. Root acknowledged this
shared-function boundary. No unrelated invoice/owner correction semantics are added here.

## Shared integration map

The root added the following bindings, mounted the unmatch panel and connected the historical
allocation notice. New tables need no runtime Drizzle writes or public table grants.
These source connections have not been run or type-checked.

1. Export `./bank-match-reversals` -> `./src/bank-match-reversals.ts` from the contracts package.
2. Add `BankMatchReversalsApi` to shared `Api` and spread `BankMatchReversalCapabilities` into
   the shared capability catalog.
3. Spread `bankMatchReversalStatements` into the `db/query.ts` statement map. It supplies
   all six operation IDs below.
4. Add `BankMatchReversalHandlers` to `apps/api/src/index.ts` handler composition.
5. Add these `bindCapability` mappings. `scopeParameter(input.scope)` comes first after the
   credential, which the existing dispatcher supplies. Do not add approve/revoke to MCP.

| Capability | Database operation | Parameters after token |
| --- | --- | --- |
| `bank_prepare_match_reversal` | `prepareBankMatchReversal` | scope JSON, `input.idempotencyKey`, `JSON.stringify(input.input)` |
| `bank_get_match_reversal` | `getBankMatchReversal` | scope JSON, `input.planId` |
| `bank_list_match_reversals` | `listBankMatchReversals` | scope JSON, `input.after ?? ""` |
| `bank_execute_match_reversal` | `executeBankMatchReversal` | scope JSON, `input.idempotencyKey`, `input.planId`, `JSON.stringify(input.input)` |

All statements return `as result` and call the corresponding snake-case SQL function:

| REST operation | SQL signature |
| --- | --- |
| `prepareBankMatchReversal` | `prepare_bank_match_reversal(text,jsonb,text,jsonb)` |
| `getBankMatchReversal` | `get_bank_match_reversal(text,jsonb,text)` |
| `listBankMatchReversals` | `list_bank_match_reversals(text,jsonb,text)`; empty continuation becomes SQL NULL |
| `approveBankMatchReversal` | `approve_bank_match_reversal(text,jsonb,text,text,jsonb)` |
| `executeBankMatchReversal` | `execute_bank_match_reversal(text,jsonb,text,text,jsonb)` |
| `revokeBankMatchReversalApproval` | `revoke_bank_match_reversal_approval(text,jsonb,text,text,jsonb)` |

Route prefix: `/api/v1/entities/:entityId/books/:bookId`.

- POST `/bank-match-reversal-plans`: `{target,reason}`; target is
  `{kind:"allocation",allocationPlanId}` or `{kind:"legacy_exact",statementId,rowOrdinal}`.
- GET `/bank-match-reversal-plans?after=...`: live 25-plan identifier page, not a frozen total.
- GET `/bank-match-reversal-plans/:id`: exact saved plan, usable approval, receipt/currentness.
- POST `/bank-match-reversal-plans/:id/approve`: `{digest,version:1}`; operator only.
- POST `/bank-match-reversal-plans/:id/execute`: `{digest,version:1,approvalId}`.
- POST `/bank-match-reversal-approvals/:id/revoke`: `{reason}`; operator only.

All POSTs require the existing `Idempotency-Key` header. Mutations authenticate and acquire
the book barrier before replay, so current read/write authority still controls recovered
results. Same plan/digest/approval can recover a committed execution with a new command key;
changed digest/approval and a competing plan cannot repeat the effect.

Mount the new local component in the bank/settlements workspace, keyed by book and cleared
on session identity changes through the existing root boundary:

```tsx
import { BankMatchReversals } from "@/components/bank-match-reversals/panel";
<BankMatchReversals key={book.id} book={book} locale={locale} />
```

Also integrate the historical-allocation notice into existing `settlements/review.tsx` next
to its executed receipt, and prefer it over the ordinary matched-success label when present:

```tsx
import { BankAllocationUnmatchNotice } from "@/components/bank-match-reversals/notice";
{view.unmatch ? <BankAllocationUnmatchNotice unmatch={view.unmatch} locale={locale} /> : null}
```

This notice matters: the original execution remains historical truth after unmatch and
must not be presented as currently effective matching. Existing consumers can still decode
the original response because `unmatch` is optional. No shared workspace/router or dirty UI
file was edited by this owner.

## Source review and remaining limits

Source review traced original/reversal uniqueness, both effective-capacity sums, current
credential/member admission, operator-only approve/revoke, expiry/current approver checks,
period-before-account locking, exact snapshot recheck, and transactional source revision/
receipt append. Each removed leg subtracts the same signed amount from source and line
capacity. The unique target plus immutable reversal records prevents a second subtraction.
No monetary values pass through JavaScript number; only bounded row ordinals do.

The review followed all latest SQL functions reading the raw bank match/leg tables.
Only original-target capture and legacy identity/reuse refusal intentionally retain raw
reads. Live reporting/capacity/correction/owner checks use effective views. Previously
applied migration files were not edited. Shared-function forward definitions preserve other
domains and existing command replay paths.

No tests, fixtures, browser actions, validation/format commands, builds, servers, database
execution, applied migrations, dependencies, Git operations, deployments or external actions
were performed. SQL/type/runtime/concurrency/rollback/browser behavior is **unverified**.
Source review is not financial acceptance.

Remaining deliberate limits:

- Synthetic native bank profile only. Whole allocation, or one exact legacy match only.
- Inactive bank accounts, ambiguous/missing periods, locked source/posting periods, and
  reversed/reversing vouchers refuse. Repair needs its separately owned workflow.
- Unsent drafts and retry keys live in the component, not durable storage. Saved plans and
  execution receipts can be rediscovered after reload; unknown writes are not called failed.
- Paging is a bounded live list; restart its first page for concurrently added plans.
- No company completeness, statutory readiness, bank-feed/provider action, journal posting
  or invoice-payment effect is introduced.
- Future validation must cover positive/negative amounts, shared source/line legs, partial
  remaining allocations, legacy imported/explicit matches, old endpoint bypass attempts,
  races with match/close/correction/revocation, lost replies, rollback and scope denial.
