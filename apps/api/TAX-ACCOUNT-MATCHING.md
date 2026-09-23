# Tax-account exact matching —4100 working failure contract

Working scope before implementation: exact whole-event/whole-posted-line review, same scoped
account/currency, same date and signed amount. Unknown classifications and zero events cannot
match. No timing allocation, split, many-to-many matching, posting or legal readiness.

Failure contract to preserve:

- Wrong-book event/statement/line/evidence, wrong account/currency/date/amount and stale basis
  are refused. Preview pins immutable event/statement and posted line plus current book/account metadata.
- Operator review requires retained evidence and rationale. Ordinary MCP cannot execute
  match/unmatch. Current authorization precedes original-key replay.
- One active event and one active voucher/line pair. Book locks serialize competing commands;
  a private reservation table supplies physical unique constraints. History stays append-only.
- Active bank, owner and commerce line ownership cannot be reused in either direction.
  Physical insertion guards share the book barrier with every affected domain owner.
- Reversed/reversing or subsequently corrected lines cannot gain a match. A correction of
  an actively matched voucher requires explicit evidenced unmatch first. Live reads still
  refuse to call a known corrected relation usable if historical state was changed elsewhere.
- Unmatch appends immutable history and releases only its exact reservation atomically.
  It never edits old match bytes. Rematch requires a new review, not reactivation.
- Same-key recovery returns original successful match/unmatch receipts after later changes.
  New-key duplicate capacity or repeated unmatch is refused.
- The actual v2 control consumer removes only usable effective pairs from unmatched lists;
  invalid active pairs, unknown classifications, gaps and offsetting residuals stay visible.
  Historical v1 controls keep their bytes and interpretation. Full reconciliation/source
  completeness/financialCloseReady remain false even when every represented row is paired.
  -4100 extends the called tax-account dependency owner supplied by3950, not shared closing
  helpers. Matching/unmatching must stale existing control/closing/accountant dependencies.

No tests, runtime/SQL execution, migrations or external actions are authorized. Static checks
and source review will be recorded separately from implementation.

## Implemented source

Forward `4100-tax-account-matching.sql` implements the contract above.3800 and3950 remain
unchanged. This is source implementation, not applied or runtime-verified behavior.

### Operator workflow

1. Read a retained statement/control and choose its stable event plus a posted voucher/line.
2. `previewTaxAccountMatch` accepts `eventId`, `statementDigest`, `voucherId` and `lineId`.
   It returns the exact eligible basis with a digest. It does not reserve or approve anything.
3. An operator calls `matchTaxAccountEvent` with that selection, `expectedBasisDigest`, a
   book-scoped retained `evidenceId` and a nonblank review rationale.
4. To release a relation, the operator calls `unmatchTaxAccountEvent` with its immutable
   match digest, retained evidence and rationale. The old match remains readable.
5. A fresh pairing needs a fresh preview and review; there is no reactivation endpoint.

The basis retains original statement identity/digest/source evidence hash, exact event,
selected account/version, native book currency/scale/profile version/writer epoch, affected
period/version and posted line identity, amounts, date, sequence, purpose, correction identity
and original voucher evidence references. Match execution recomputes this exact basis under
the book barrier. A stale preview cannot approve a different state.

Only same-date, same-account, same-currency, exact signed whole-event/whole-line pairs are
supported. Zero events cannot match nonzero journal lines. Unknown classifications stay
unresolved. No account number or tax role is inferred. A current replacement voucher can be
selected if it is not a reversing voucher and has no later correcting voucher. A reversed or
subsequently corrected original cannot be selected. New matching and unmatching require the
single affected period to be open. Historical reads do not require an open period.

### Physical capacity and current status

`tax_account_matches` and `tax_account_unmatches` are immutable. The private
`tax_account_match_capacity` table is a disposable reservation projection, not mutable review
history. It has unique event and voucher/line capacities and a composite foreign key to the
exact immutable relation. A deferred constraint requires every review to end its transaction
with exactly one reservation or one unmatch, never both. It prevents orphaned histories,
unrecorded releases and reactivation of an unmatched review. Reservation identities cannot
be updated. Each new reservation revalidates the exact basis through an admission trigger.

Separate insertion triggers fence bank matches, bank allocation legs, owner effects,
commerce recognition and effective payment allocations in both directions. Existing bank
and commerce released-allocation views remain the capacity owners;4100 does not replace
or weaken their functions. Even a partial active bank/commerce claim prevents a whole-line
tax-account match. After tax unmatch, those owners may acquire their own capacity normally.
No bank source row is consumed, remapped or silently marked reconciled by tax matching.

A voucher-correction insertion trigger requires all active tax matches on its target to be
explicitly unmatched first. Existing correction planning is unchanged; execution is fenced
even if a previously prepared plan did not list this new resource. Unmatch and re-review the
correction normally rather than bypassing that guard.

Read views separate `active` (reservation exists) from `usable` (still-current account/book
metadata and posted-voucher correction state, with no conflicting owner). Inactive or renamed
accounts, changed authority/profile/writer metadata and known corrections cannot look
reconciled. An invalid active reservation stays occupied until explicit unmatch; it is never
automatically transferred. Reactivating an account does not silently revive a review pinned
to its old version.

Original-key successful match/unmatch replay happens after current authorization but before
new-state checks. It returns the historical receipt without reacquiring or releasing later
capacity. A new-key duplicate active relation or already-unmatched review is refused.
At most1000 reviews and1000 unmatches are retained per book; complete lists do not truncate.

### Actual control and dependency consumption

New `synthetic_tax_account_gl_control_v2` snapshots retain the same complete source and GL
arithmetic as3800. They additionally retain all selected-account review histories through
period end, with captured active/usable status. Only usable exact pairs leave the unmatched
lists. Unknown classifications, invalid relations and all residual source/GL contributions
remain visible. Original and reversing journal contributions remain in the full ledger;
matching never subtracts or fabricates financial amounts.

`unmatchedLedgerLines` retains exact `{voucherId,lineId}` pairs. Journal line IDs are only
unique within a voucher; filtering uses both identities, never the legacy convenience ID
array alone. Historical opening lines may have reviewed source events before the requested
interval; their evidence-backed match basis stays in the control instead of silently removing
those lines from the audit trace.

Even a fully paired represented interval keeps `reconciled:false`,
`coverage:"not_established"`, `financialCloseReady:false` and `taxReturnEffect:"none"`.
Matching does not establish source completeness, legal treatment, filing or settlement.
`unmatched_events`, `unmatched_ledger_lines` and `invalid_matches` diagnose residuals;
`coverage_unestablished` always remains. Historical v1 bytes and original-key control replay
are preserved. Their old dependency-format digests conservatively become noncurrent after
the forward dependency extension; snapshots are not rewritten as v2.

The forward-replaced private `tax_account_close_dependencies(book)` preserves3950's four
statement/control fields and adds:

```text
matching:
  matchCount, unmatchCount
  matchInventoryDigest, unmatchInventoryDigest, activeStateDigest
```

The called matching dependency hashes complete immutable histories plus active/usable states
and correcting-voucher identities. The existing VAT owner continues nesting the whole object
under `taxAccounts`; VAT `sourceCount` still counts actual VAT facts, not tax-account records.
Existing closing and accountant dependencies therefore see matching changes without another
shared-owner rewrite. Root owns the optional additive shared response schema.

The retained tax-control dependency separately includes matching history/state but excludes
the control inventory itself. Creating a control does not immediately stale its own basis.
Matching changes elsewhere in the book conservatively stale its live dependency status.
Immutable control JSON/hash/byte-length storage and8MiB artifact limits remain unchanged.

### Transport and integration

Local contracts/routes/statements extend the existing `taxAccount` owner; no second workflow
runtime or pass-through application layer was added. Root has wired these read-only MCP calls:

| Capability                  | Query                    | Parameters after token |
| --------------------------- | ------------------------ | ---------------------- |
| `tax_account_preview_match` | `previewTaxAccountMatch` | scope, JSON(input)     |
| `tax_account_get_match`     | `getTaxAccountMatch`     | scope, id              |
| `tax_account_list_matches`  | `listTaxAccountMatches`  | scope                  |

REST uses the existing tax-account base path: POST `/matches/preview`, POST `/matches`,
POST `/matches/:id/unmatch`, GET `/matches/:id` and GET `/matches`. Only the two mutations
require operator authority; neither is an MCP capability. Control capture remains available
through the existing capability and now describes effective exact matching, not unavailable
matching. Shared API composition is root-owned.

### Source review and observed checks

Reviewed source against1300 active bank matching/reversal ownership,1700 effective commerce
allocation/reversal ownership,3800 source/GL arithmetic and3950 dependency integration.
Reviewed exact sign/date rejection, cross-scope evidence/line/event refusal, duplicate and
concurrent capacity admission, both cross-register insertion directions, current correction
checks, guarded correction insertion, whole reservation release, old-key replay after rematch,
unknown/zero-event refusal, account-version invalidation, voucher-scoped line identity,
retained v1 compatibility, new-control self-dependency avoidance and global bound refusal.
These are source-review findings, not executed concurrency or accounting scenarios.

Owned TypeScript Oxlint passed with zero warnings/errors. Owned Oxfmt and `git diff --check`
passed. Shared API/contracts type checks remain root-owned. No tests, fixtures, runtime/SQL
execution, migration application, browser work, external actions or VCS commands that alter
history occurred. Dynamic transaction behavior remains unverified.

Suggested plan05 update: “Forward4100 adds evidenced operator-only exact whole-event/whole-line
matching and append-only unmatch. Private physical capacity and correction guards prevent
reuse; v2 controls consume only usable pairs and retain residual/unknown rows and original
GL amounts. Matching histories/currentness participate in3950's existing VAT/closing dependency
owner. Source completeness, full reconciliation, financial close, legal tax treatment,
settlement and full VAT-03 acceptance remain unavailable; runtime proof remains open.”
