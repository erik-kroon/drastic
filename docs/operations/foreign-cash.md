# Foreign cash owner

Work tracked by DRA-145. The application owner is banking foreign cash. Stored native units and book carrying are separate capacities. Reviewed opening native units are admitted with evidence; opening carrying comes from the posted control balance. Commands never accept cash carrying.

## Failure vectors recorded before implementation

- Book currency relabelled as foreign currency, inactive control, missing bank registration or evidence, and negative or residual-only opening refuse.
- Different operator approval, current membership, digest, expiry, fiscal period, active account versions, rate revision and current holding/obligation capacity are required at execution.
- Replay returns the original result. Reusing a key for different input or executing a review twice under another key refuses.
- A concurrent withdrawal, receipt, transfer or valuation makes a prepared capacity stale. Native overdraw and book carrying over-release refuse.
- Transfer preserves the exact native/carrying pair. Final withdrawal releases all carrying. No zero-sided lines are published.
- Payable and receivable settlement read the canonical FX item. Both independent capacities and journal commit in one transaction.
- Source identity is once-only across cash changes. Bank observation ownership also requires cross-owner admission.
- Exchange derives release from the holding. Foreign-to-foreign exchange refuses. Fees use explicit retained evidence and do not alter the gain formula.
- Rate withdrawal/revision, fractional minor target, late valuation after a later withdrawal and expired approval refuse.
- Native statement difference and book GL difference are reported separately. Zero book difference cannot hide missing native units.
- A failure after posting but before effects rolls the whole transaction back; retry uses the original review and key.
- Generic posting, matching/allocation and canonical FX settlement cannot consume registered foreign cash through a book-currency alternate path.

## Literal public journey

EUR native 10000 with posted SEK carrying 110000. Payable consumption 4000 releases payable carrying 45000 and cash carrying 44000. The journal debits AP 45000, credits cash 44000 and gain 1000. Holding then reads native 6000 and carrying 66000. Reporting rate 23/2 with scales 2/2 values the holding to 69000, posting cash debit 3000 and gain credit 3000. Native remains 6000.

## Throughput checkpoint

Blocking first steps are the ownership design, failure contract and public API assertions. Independent workstreams are new owner files and root-owned shared admission and transport. Shared writes are the book transaction and canonical FX capacity; root owns those integration edits. Smallest safe decomposition keeps the paired native/carrying effects, compiler and lifecycle with one implementation owner.

Verification is pending. This document records the selected contract, not completed runtime proof or real-company qualification.

## Native observation admission vectors

Recorded before adding native observation linkage. Payable withdrawals, receipts and exchanges require the retained statement row. Its native currency, source account, date and signed quantity must agree with the cash operation. Wrong currency, another source account, changed date, wrong quantity, a preexisting match/allocation and repeated observation consumption each refuse before posting. The authoritative capacity key is statement plus row ordinal. A caller's economic label cannot create another right to consume that native row. Generic bank matching or allocation on registered foreign cash is refused because its book-minor capacity cannot substitute for native quantity.

Opening admission retains every posted control line in its opening basis. A generic correction of any such voucher must refuse after adoption. Later posting on the control before adoption also makes the opening review stale. The reviewed native opening never grants permission to rewrite the retained book carrying.

Exchange consideration comes from the retained receiving book-currency bank row. Fee amount comes from exact immutable synthetic fee evidence. Wrong receiving currency, account, date, nonpositive received amount, fee evidence currency, repeated receiving source row or an existing receiving allocation each refuse. Both source capacities, the fee witness, the holding release and the journal commit together. Client-supplied consideration or fee fields are rejected.

## Implementation ownership

[The application owner](../../apps/api/src/application/banking/foreign-cash.ts) compiles and retains `open`, `transfer`, `payable`, `receipt`, `exchange`, and `valuation` reviews. Approval and execution check the current stored basis. Execution writes journals, holding effects, obligation consumption, and source consumption in one supplied transaction.

[The database owner](../../apps/api/src/db/banking/foreign-cash.ts) reads and writes retained records. [Migration 0078](../../apps/api/migrations/0078-foreign-cash.sql) grants append-only runtime access. Opening line membership protects the posted control basis after adoption. Native source consumption uses a statement and row ordinal as its capacity key.

[The public contract](../../packages/contracts/src/foreign-cash.ts) excludes client cash carrying, exchange consideration, and exchange fee amounts. Opening carrying comes from posted control lines. A retained qualified rate values receipts and reporting balances. Exchange net receipt comes from its retained SEK bank row, and its fee comes from `ExchangeFee` evidence. Exchange also uses the canonical bank match owner for the receiving SEK line.

The canonical commerce FX owner includes foreign cash obligation consumption in its existing remaining-unit and carrying calculation. Foreign cash does not create a second obligation balance.

## Correction limits

This profile supports nonnegative foreign holdings and exact minor-unit conversions. An overdraft, a fractional minor-unit valuation, foreign-to-foreign exchange, or a valuation behind later cash consumption refuses. Generic correction and bank match reversal cannot change an adopted opening or a paired foreign cash effect. An economic correction needs a qualified owning operation that this profile does not yet provide.

## Verification record

[The public API E2E file](../../apps/api/tests/foreign-cash.e2e.test.ts) specifies literal journal amounts, native and book reconciliation, transfer conservation, capacity refusals, authorization, replay, and rollback followed by retry. It uses synthetic accounts and retained statement evidence. Each completed scenario saves database and request evidence through the existing `saveEvidence` function.

The parent coordinates the required changed-file checks and the fresh-database E2E run. Runtime verification remains pending until that run produces its artifact. No live bank, provider, production, or statutory claim follows from this implementation note.

## Paired transfer and receipt vectors

Recorded before the paired source edit. Transfer requires exact retained sender and receiver rows with the same native currency, date, and opposing quantity. A missing receiver row, wrong receiver currency or account, reused row, changed revision, and independent generic consumption refuse. Both source claims and holding effects commit together. Reconciliation requires all rows of the selected complete statement to have exact native consumption; an unexplained cancelling pair cannot qualify solely because its closing balance agrees.

The incoming receipt proof recognizes EUR 4000 with AR carrying SEK 45000, then receives EUR 4000 at 23/2 for cash carrying SEK 46000. It debits cash 46000, credits AR 45000 and gain 1000. Starting cash 10000/110000 becomes 14000/156000. The canonical AR authority ends at zero units and zero carrying.

## MCP parity vectors

Recorded before the public MCP probe. A valuation request containing a client carrying amount must fail with JSON-RPC invalid arguments before producing a review. The equivalent lawful request must prepare through MCP, retain a separate operator approval through HTTP, and execute through MCP with the same native and carrying results as HTTP reads. Approval is withheld from the tool catalog. The probe changes no shared capability decoder because its existing strict schema parsing already owns this boundary.

## Approved agent handoff

The public MCP probe exposed an authority mismatch before the repair. The catalog admitted agent preparation and approved execution, while the owner admitted only operators for those two steps. Preparation grants no posting authority. Approval remains a separate operator action. Execution revalidates the exact stored human approval, its operator membership, expiry and review digest. The existing commerce FX posting owner records the kernel approval with that retained human actor, approval identity and expiry, consumes it once, and admits the exact retained foreign cash action. The agent performs the approved operation and never becomes its approving actor. Public proof must inspect that stored approval and consumption alongside the native and carrying result.
