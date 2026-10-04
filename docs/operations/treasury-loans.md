# Retained loan lifecycle

The selected local profile extends a posted shareholder loan in the owner register. Adoption retains an agreement and the original principal effect. It creates no journal. Principal repayments continue to consume the owner effect through retained allocation children.

The agreement fixes book currency, a stable coverage origin, simple interest, ACT/365F or 30/360, cumulative half-up rounding, explicit payment allocation, and principal changes at the end of their effective day. Interest expense, accrued interest liability and fee expense have treasury roles. Principal liability remains an owner role and bank cash remains a bank role.

Rates are evidenced immutable observations with unique effective dates. A rate cannot replace another observation or alter coverage already accrued. Unsupported corrections retain their history and require a separate qualified correction workflow. No real loan validity, tax deduction, market rate or lender-statement agreement is inferred.

## Failure cases defined before implementation

- An unknown, foreign-book, debit, contribution or non-synthetic principal effect cannot be adopted as a loan.
- The original principal effect can be adopted only once. Repeating the same command returns the same adoption.
- An inactive, conflicting or repeated account cannot supply a treasury interest or fee role.
- A future first rate cannot cover an earlier interval. Duplicate effective dates fail. Backdated rates after accrued coverage fail.
- A principal timeline must include the existing owner allocations as well as treasury repayments. It cannot become negative.
- Interest uses exact rational segments and rounds the cumulative target once. A second calculation of the same coverage creates no journal and no second interest charge.
- A shorter or backdated coverage request fails. A repayment dated before retained repayments fails.
- A repayment must use a stored negative bank observation. Principal, interest and fees must equal its exact amount. Principal and recognized interest capacities cannot be exceeded.
- The retained review binds the exact plan, event and complete current loan basis. A changed rate, principal allocation, interest effect, account, period or cash capacity makes approval or execution stale.
- Generic approval, execution and alternate plans for the same retained event must not bypass the loan owner.
- Missing, mismatched or expired approval fails. Agent credentials cannot grant human approval.
- Human approval must retain the exact kernel approval. An admitted agent can execute that approval, but cannot manufacture a replacement approval. The retained approver must still have operator membership and enabled identity when execution commits.
- Racing consumers commit at most one repayment against the same bank row or principal capacity. The losing command leaves no journal, allocation or receipt.
- A late database constraint failure rolls back the journal, bank match, owner repayment effect, treasury allocation and command receipt. Retrying the original command then commits exactly once.
- Replay of an acknowledged execution returns its retained event before fresh expiry and stale-basis checks. Current access still applies.

## Public E2E expectations defined before implementation

Synthetic source-backed funding posts principal 10,000,000 on 2026-09-01. Loan adoption adds zero vouchers and keeps the original effect identity. The rate is 6/100 under ACT/365F. Coverage [2026-09-01, 2026-10-01) contains 30 days. Exact interest is 18,000,000/365 minor units and cumulative half-up gives 49,315.

Approved accrual debits interest expense 49,315 and credits accrued interest liability 49,315. Repeating that coverage with a new economic review gives delta zero, no voucher and accrued interest 49,315. Replaying the original execute returns its identical event.

A retained bank debit of 1,049,315 on 2026-10-01 repays principal 1,000,000 and interest 49,315. The journal debits principal liability 1,000,000, debits accrued interest liability 49,315 and credits bank 1,049,315. The owner control and loan view both show principal 9,000,000. Interest outstanding is zero. The source row has one match and the principal allocation has one retained child.

The public REST test exercises adoption, rates, preparation, approval, execution and coherent reads. It saves an artifact with independently expected amounts, retained reviews, receipts, owner controls and database invariants. Negative cases cover permission, missing rate coverage, duplicate rates, excess amounts, stale approval, generic-plan bypass, capacity races and late-failure retry. Browser tests are outside this API owner increment.

The split-rate case applies 6/100 for 15 days and 12/100 for 15 days. Exact cumulative interest is 27,000,000/365 and rounds to 73,973. An existing owner repayment of 1,000,000 on September 10 changes principal from September 11. The target uses 10 days at 10,000,000 and 20 days at 9,000,000, giving 16,800,000/365 and rounded interest 46,027. Two concurrent principal-only repayments of 6,000,000 commit one effect and leave principal 4,000,000.

The fee case repays principal 1,000,000 and a separately evidenced fee of 25. Cash is exactly 1,000,025. The principal liability closes at 9,000,000 and fee expense increases by 25. A missing fee original fails before a review is retained.

The approval handoff case uses an operator to approve 49,315 of interest and an admitted agent to execute it. The loan approval retains the kernel approval identity and its expiry. That exact kernel approval becomes consumed, the event records the agent executor, and replay returns the same event with no additional voucher. The agent approval request still fails.

Economic principal dates come from the owner effect's retained `occurredOn`. Accounting posting dates remain separate control inputs. This bounded profile accepts at most 1,000 retained rate observations, effective events, and approvals per review. It refuses the next write before those bounds can make the current read incomplete.

## Throughput checkpoint

- Blocking first steps. Read the owner census and accepted packet, then record failures and independent expectations before edits.
- Independent workstreams. This worker owns loan contracts, database queries, migration 0076, application logic and public E2E. The coordinator owns shared admission, router, capability and package integration.
- Shared mutable state. The admitted book lock serializes financial capacity. File ownership keeps source edits separate. Checks run only after the coordinator freezes all writers.
- Smallest safe decomposition. One worker carries the code-coupled lifecycle. The coordinator reviews and integrates shared boundaries independently. Nested delegation is excluded by the packet's worker rule.

## Verification state

Design and independent expectations are recorded. Implementation and runtime verification remain open.
