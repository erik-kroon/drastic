# Bank matching candidate discovery (1600)

## Failure cases recorded before implementation

This slice reads existing synthetic bank observations and posted bank lines. It does not match,
approve, post, pay an invoice, establish source coverage or activate a company profile.

- Authorize the entity/book before source lookup or any count. Foreign sources refuse without
  disclosing their candidates. Helpers remain private; runtime receives only scoped EXECUTE.
- Missing/malformed statement or row input refuses. Native synthetic profile only. No feed,
  parser, foreign currency conversion or provider-reference inference is introduced.
- Hold the book barrier through source, effective capacity, configuration and posted cutoff reads.
  Capture committed sequence, source revision, account/profile/writer versions and period digest.
  A deterministic content digest compares repeated reads; it is not an approval or a future lock.
- Effective exact matches and allocation legs from1300 determine signed used/remaining capacity.
  Unmatch releases capacity; immutable historical relationships remain ranking evidence only.
  Exhausted/zero source, inactive account, currency mismatch, wrong sign, exhausted line,
  reversing/reversed voucher and missing/ambiguous/locked source/posting period block selection.
- Search the entire retained statement interval for the mapped account. Show every in-scope
  posted line, including blocked rows. No hidden amount/date threshold. Other accounts and
  out-of-interval lines are explicitly outside this supported allocation scope.
- Refuse above1000 scoped lines or1000 book periods before building a result; no top-N truncation.
  Same amount/date candidates remain separate. Ranking never establishes identity or chooses a leg.
- Distinguish exact retained relationship history and statement-document citation from heuristic
  remaining-amount/date proximity. Statement evidence is not a row reference. Prior unmatch may
  mean the old relationship was wrong. No comparable posted provider-reference field exists.
- UI validates both input and response, keeps failed input, partitions by entity/book/source,
  shows cutoff and refresh comparison, and disables selection while refreshing or after error.
  Selected identifiers are advisory only; the existing reviewed allocation workflow owns amount,
  ambiguity acknowledgement, approval and fresh execution checks. Reload loses local selection.
- No tests, checks, toolchain/build, database, migration application, browser, server or external
  actions are authorized. Source review is not observed acceptance.

## Implementation and integration

Implemented source, not executed:

- `migrations/1600-bank-match-candidates.sql` (new forward migration; no historical SQL changed).
- `packages/contracts/src/bank-match-candidates.ts`.
- `src/db/statements/bank-match-candidates.ts`.
- `src/transport/http/routes/bank-match-candidates.ts`.
- `apps/web/src/components/bank-match-candidates/{panel,results,copy}.tsx` / `.ts`.

Root composition:

1. Export `"./bank-match-candidates": "./src/bank-match-candidates.ts"` from contracts.
2. Add `BankMatchCandidatesApi` to shared `Api` and spread
   `BankMatchCandidateCapabilities` into the shared capability catalog.
3. Spread `bankMatchCandidateStatements` into the database statements object.
4. Bind the single read-only capability and add `BankMatchCandidateHandlers` to HTTP composition.
5. Mount `BankMatchCandidatesPanel` with `{book, locale}` under Accounts/Matching. Key the
   mounted panel by book and reset it under the existing authenticated identity boundary.
   Existing request-scoped QueryClient and scoped TanStack Query keys remain the state owners.

```ts
bank_discover_match_candidates: bindCapability(
  Capabilities.bank_discover_match_candidates,
  "discoverBankMatchCandidates",
  (input) => [scopeParameter(input.scope), JSON.stringify(input.input)],
),
```

| Boundary | Contract |
| --- | --- |
| SQL | `openerp.discover_bank_match_candidates(token text, scope jsonb, input jsonb)` |
| Database operation | `discoverBankMatchCandidates`; ordered parameters are token, scope JSON, input JSON |
| REST | `POST /api/v1/entities/:entityId/books/:bookId/bank-match-candidates` |
| Input | `DiscoverBankMatchCandidates`: `statementId`, `rowOrdinal`, optional `previousDigest` |
| Output | `BankMatchCandidates` |
| MCP | `bank_discover_match_candidates`, `{scope, input}`, `readOnly:true` |

POST carries a structured read request. It requires no idempotency key and writes no receipt,
plan, relationship, audit event or ledger record. The helper `bank_candidate_period_state`
and direct table access are private. No new application service, Drizzle table mapping or
runtime connection is needed.

### Scope, eligibility and ranking

The retained source determines the bank account and the entire permitted statement interval.
Clients cannot hide ambiguity with a small search window or choose another account. Discovery
returns every line in that scope at the current book committed sequence, including blocked
rows. It refuses more than1000 such lines or1000 book periods. These are disclosed product
bounds, not legal thresholds or measured runtime capacity. No arbitrary historical cutoff,
foreign-currency conversion, external feed or larger-scope workflow is supported.

Signed capacity is original amount minus effective allocated amount. `bank_allocated_source`
and `bank_allocated_line` already use1300's `bank_active_matches` and
`bank_active_allocation_legs`. Immutable raw relationships are used only to explain prior
source/line links. Source or line overconsumption/sign inconsistency refuses rather than
manufacturing an available balance.

All source blockers also block each candidate. Selection requires an active mapped account,
same retained/book/posted currency, same sign, nonzero remaining source and line capacities,
an original unreversed voucher, and exactly one open period for each source/posting date.
Wrong account and out-of-interval lines are not allocation candidates and are outside the
explicit response window. Missing, overlapping and locked periods are separately labelled.
Blocked lines remain visible rather than being treated as absent or matched.

The deterministic order is:

1. Eligible before blocked.
2. Exact retained source/line relationship history, including relationships later undone.
3. Exact statement-evidence citation by the voucher (document-level, not row identity).
4. Equal signed remaining amount.
5. Absolute distance between remaining magnitudes, then absolute calendar-day distance.
6. Voucher ID and line ID break otherwise equal ranks; they are not financial evidence.

There is no inferred provider-reference match: observations retain `providerId`, but posted
bank lines have no corresponding structured provider-reference field. Comparing arbitrary
event keys or description text would invent a reference contract. The response explicitly
reports `providerReferenceComparison:"unavailable"`. The UI shows the retained source
reference without pretending it is comparable. Name/text similarity is not implemented.

History and evidence citation outrank heuristics, but neither proves a current correct match.
An old link can have been undone because it was wrong; a document can contain many source
rows. Equal amounts are always explained as ambiguous evidence, not unique identity.
`identityEstablished:false` and `coverage:"not_established"` never change, even with exactly
one eligible line. Multiple lines and equal-amount eligible counts remain visible.

### Cutoff and currentness

Admission locks precede a shared book barrier, then period/account read locks. The result binds
current committed ledger sequence, source revision, account/profile/writer versions, a digest
of all bounded book period IDs/versions/dates/locks, source facts, effective capacities, blockers
and all ordered candidate content. This uses one current committed cutoff; it does not construct
a partial posting-group boundary. A subsequent reversal outside the statement interval still
blocks its original line because correction eligibility is current, not a historical interval view.

The result's deterministic `digest` excludes request-specific `previousDigestMatches` and has
no wall-clock timestamp. Repeat with `previousDigest` to receive `true` or `false`; without a
prior digest the value is `null`. The UI compares with its last scoped QueryClient result on
refresh. This cache is not durable saved discovery. It clears local selection on refresh and disables selection during
fetching or after an error. Old rows can remain visible during a failed refresh but are not
selectable. Unrelated committed postings or period changes may conservatively change the
digest. New ordinary discovery reads do not change it.

A returned match of digests means equal observed state at that read, not continuing freshness,
reservation, approval or durable saved discovery. The existing reviewed allocation workflow
must prepare/seal current capacity versions and recheck them when the approved plan executes.
Discovery does not accept its own digest as authority to change a relationship.

### Manual-review handoff

Selecting a line shows read-only account, statement, row, voucher and line identifiers. The
operator can copy them into the existing manual bank allocation review. An optional `onSelect`
prop receives `BankCandidateSelection`:

```text
{ accountId, statementId, rowOrdinal, voucherId, lineId, discoveryDigest }
```

Root may use this to fill a manual allocation draft. Do not submit a plan, infer an amount,
auto-acknowledge ambiguity, approve, execute or invoke invoice allocation from this callback.
The UI intentionally emits no proposed amount. Many-to-many and partial allocation remain
owned by the existing reviewed bank allocation path. The selected source/line is advisory and
can become stale immediately. Book/identity changes must clear any receiving draft as well.
No unsent form or local selection durability is claimed after reload.

## Source review and remaining proof

Source review traced scoped authorization, lock order, bounded complete enumeration, effective
capacity reuse after unmatch, correction/period blockers, exact numeric strings, ranking tie
stability, digest coverage and SQL/contract/UI field correspondence. Source inputs and responses
are decoded by the existing contract/HTTP path. No other module's SQL functions or guarded
posting semantics were replaced.

No tests, test edits, checks, toolchain/build, dependency changes, database commands, migration
application, browser/mobile runs, servers, external actions or commits were performed.
Runtime SQL/type/response/concurrency/accessibility behavior remains unverified. Root still owns
shared composition and any later authorized validation. D-06 actual-provider facts, legal
profile activation, source completeness and reconciliation acceptance remain independent gates.

## Root source integration

Shared contracts exports, API/capability catalogs, bindings, SQL dispatch and HTTP handlers are connected. Accounts → Matching and the tools workspace mount candidate discovery beside reviewed allocations. Selection remains an explicit copyable identifier handoff; no automatic plan or amount is supplied. No validation or runtime acceptance is claimed.


## Candidate → manual allocation handoff: failure cases before edits

- Candidate arrival must not change an existing allocation form, its unsent amounts/reason,
  acknowledged state, failed input or exact retry-key map. No key/remount follows candidate props.
- Starting a candidate-seeded allocation is an explicit discard/new-draft action. It is disabled
  while preparation is pending. An uncertain request must remain retryable with unchanged input;
  discarding its key is explicit and explained, never part of a refresh or candidate selection.
- Only account, statement, row, voucher and line identifiers may be filled. Amount, reason and
  ambiguity acknowledgement start empty; there is no submit/approve/apply or capacity arithmetic.
- A selected seed remains immutable until the user explicitly starts another draft. Candidate
  refresh/selection may replace only the queued candidate, never the active seed or request target.
- Show the discovery digest as a historical reference, not an approval. Explain that source/line
  capacity can have changed and the backend prepares a fresh reviewed capacity snapshot.
- Preserve manual many-leg preparation, remove/add controls, saved-plan lookup/review and unmatch.
  Book/identity reset remains the existing boundary. No financial contract or new SQL is added.
- Keep bank-statement.tsx and shared root composition untouched, including concurrent amount
  formatting. The root chooses where to mount the composed workspace.
- No tests, checks, browser, toolchain, database or external actions are authorized.


### Implemented UI integration and root mount

`BankMatchingWorkspace` in `apps/web/src/components/bank-match-candidates/workspace.tsx`
composes candidate discovery, existing reviewed allocation/capacity reports and unmatch. Props:
`{book, setup, locale}`. Root can replace the three direct Accounts/Matching mounts with this
component. It provides an entity/book-keyed local boundary; keep the existing identity reset.
No shared root mount or `bank-statement.tsx` was edited. The per-statement candidate inspector
and direct `BankAllocations` calls remain usable without the new optional prop.

`BankAllocations` now accepts optional `candidate: BankCandidateSelection | null`, using the
existing local identifier-handoff type, not a financial API DTO. A candidate arrival changes
only the displayed pending handoff. The allocation form owns one immutable active seed. The
explicit **Discard draft and use candidate** action adopts it and starts fresh DOM inputs with
account/statement/row/voucher/line defaults. Amount, reason and acknowledgement are empty.
There is no automatic submission or amount inference. Added legs are blank; removing the
original first leg does not transfer the seed to another leg. An unavailable seeded account
remains visibly identified rather than silently falling back to another account.

The form's reset counter changes only inside the explicit start/discard action, never when a
candidate prop or query result changes. Pending preparation disables that action and the blank
reset action. The same mounted failed/unsent draft retains all user input and its request-key
map after a new candidate arrives. The UI warns that discarding after uncertainty loses the
retry key and tells the user to retry unchanged input or recover the saved plan first. After a
confirmed save, the existing **Start a new plan** action now deliberately clears the old fields
and starts blank. Saved-plan lookup/review, many-leg editing and existing approval/execution are
unchanged. Starting a new draft does not delete the already saved plan currently under review.

The seed digest is shown only as an old discovery reference. It is not sent to the existing
allocation contract, nor accepted as authority. Preparation still reads current capacities and
requires an explicit reason, signed leg amounts and ambiguity acknowledgement. Approval and
execution remain separate. No SQL, financial contract, capability, state framework or service
was added. Source review traced queued-versus-active state, key lifetimes, field defaults and
scope resets; no test/check/browser/runtime verification was performed.
