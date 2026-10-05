# Asset disposals with proceeds

Owner is [DRA-150](https://linear.app/drastic-dev/issue/DRA-150/integrate-owned-asset-disposals-with-retained-cash-and-invoice). Requirements are [NEXT-19](../specs/next-01-25/packets/NEXT-19.md) and the [retained valuation owner](../plans/asset-valuation-owner.md). This is a local synthetic owner. Actual-company asset-sale tax qualification remains a D-04/D-08 gate.

## Failure vectors specified before implementation

Missing or cross-book asset, evidence, bank row or legally issued invoice line refuses. Client monetary amounts cannot establish proceeds. A bank receipt must be positive, in book currency, currently unused and observed within the posting interval. An issued invoice must retain its original accounting, output VAT and exact unsplit source line. Ordinary invoice issue does not establish a legal invoice. A credit, cancellation, correction or unsupported revenue role blocks disposal. One invoice line cannot supply proceeds to several assets.

The captured basis must retain gross cost, ordinary accumulation and effective impairment separately. Negative carrying, multiple gross or impairment roles, stale schedule, retired occurrences, later asset actions and account-role collisions refuse. Repeated source identity or another disposal cannot post twice. Current session, membership and book authority precede command replay. Approval binds the complete stored basis, source witness, domain journal and plan digest. A changed period, source revision or account witness refuses execution.

The journal, VAT fact, schedule retirement, source consumption and command result commit together. Failure after any write rolls back the whole transaction. Concurrent source claims serialize under the book writer lock and one wins. A generic journal execute, reversal, bank unmatch, invoice credit or VAT fact edit cannot bypass the named owner.

Error correction is a separate exact approval. It reverses every original journal leg, restores the existing valid asset schedule, withdraws the owned cash-sale VAT fact and releases the canonical bank allocation or invoice proceeds right in one transaction. Later asset history, changed source history, a legal credit, refund, VAT return consumer or closed period blocks correction. Original rows remain immutable. A released bank row can fund a fresh owned disposal through a new canonical allocation.

## Independent expected amounts

Gross 1000000, ordinary accumulation 200000 and impairment 300000 leave carrying 500000. A stored receipt of 812500 under the explicitly reviewed synthetic 25 percent profile gives net 650000 and VAT 162500. Disposal debits cash 812500, ordinary accumulation 200000 and impairment 300000; it credits gross 1000000, output VAT 162500 and gain 150000. Correction swaps every debit and credit. The asset returns to carrying 500000 and unused future recognition, and the bank row returns to full unused capacity.

An already recognized legal invoice line with net 450000 and VAT 112500 gives loss 50000. Disposal debits original revenue 450000, ordinary accumulation 200000, impairment 300000 and loss 50000, and credits gross 1000000. It creates no new cash, receivable or VAT. Correction swaps those legs and leaves the genuine invoice and VAT intact.

## Throughput checkpoint

Blocking first steps are the retained asset basis, exact proceeds data shape and source capacity/correction contract. The disposal owner owns contract, compiler use, tx-passing persistence, migration 0079, public API proof and this operation contract. Root owns shared posting admission, transport/capabilities, cross-owner guards and final verification. Shared source writes stop during each frozen public E2E run. The smallest safe decomposition keeps the disposal and its correction in one owner because their conservation law and source rights share one transaction.

## Design choice

The existing immutable asset register remains authoritative. Proceeds effects and corrections append their own history and feed the register's active disposal projection. Canonical bank allocations and allocation reversals own cash-row capacity. The two initial modes consume an observed unposted cash receipt or an existing legal invoice line. Simultaneous legal invoice issue and disposal remains a distinct aggregate beyond these modes.

Model the Domain selected the typed source variants and disposal/correction lifecycle. Make Operations Idempotent selected scoped exact command replay after current authority. Boundary Discipline selected stored source amounts and owned financial transactions. Test Behavior, Not Implementation selected public requests and the literal amounts above.

## Proof

Public tests exercise workerd and disposable PostgreSQL with synthetic identities. The repeatable command is `bun run test:e2e -- apps/api/tests/asset-disposals.e2e.test.ts`. Source implementation and observed proof are recorded separately. The implementation has passed focused owned-file lint. The integrated TypeScript check and public runtime proof remain pending. No passing runtime result is claimed.

## Owned bank allocation failure contract

The internal allocation consequence accepts no asserted approval authority. It loads the actual outer review and browser approval, checks their exact digest, actor, expiry, current admission and operator membership, and binds the actual posted voucher and planned cash line to that review. The stored source witness must equal the requested source and its current observation, source revision and eligibility history. An approval for another review, changed amount, another cash line, another voucher, reused approval, stale source, expired authority or occupied source refuses before successful replay. The canonical inner approval records the outer human actor, expiry and foreign-key provenance. Ordinary public allocation commands cannot approve or execute that delegated record.

## Retained records and reporting

`asset_proceeds_reviews`, `asset_proceeds_approvals` and `asset_proceeds_effects` retain immutable scoped history. Active effects own proceeds identity consumption; a linked correction releases that right. Positive effects contain the asset register retirement. Correction effects contain no replacement retirement and expose restored carrying and future-recognition state. The current register projects positive effects without a linked correction. Reports apply the same rule at their cutoff date, so an October 5 correction leaves October 4 retirement visible and restores carrying from October 5.

The browser approval stores the real posting approval and any canonical bank reversal approval. Execution consumes those approvals. The cash allocation consequence validates the actual posted line and retained outer approval, then records canonical plan, approval provenance, execution and allocation legs. The delegated approval retains the approving human actor and expiry. Ordinary allocation approval and execution reject these delegated records before command replay.

The public test file saves cash conservation, rollback, race, legal invoice reclassification, correction source reuse, historical controls and authority artifacts under the disposable run artifact directory. Each amount assertion uses a literal expected value.

## Minimal invoice conservation failure contract

An existing legal invoice line with net 450000 and VAT 112500 can retire an asset with gross 450000, ordinary accumulation zero and impairment zero. Net proceeds equal carrying, so the only disposal legs are original revenue debit 450000 and gross asset credit 450000. Zero contra amounts must produce no zero-value journal lines and no gain or loss line. The compiler must accept this balanced two-line journal without weakening balance or source-identity checks. The disposal must retain exact issued-line principal, create no receivable, bank allocation or new VAT fact, and block future asset recognition. A client-supplied principal, omitted gross leg, nonzero result or repeated original VAT is a failure. Public proof must compare both the reviewed journal and actual stored voucher lines to these literal amounts and retain an artifact.

## Legal invoice fixture date boundary

A legal issue retains its issued date from the current synthetic database UTC date. Invoice disposal fixtures must use that retained `issue.issuedOn`, because a fixed earlier disposal date becomes invalid across midnight. A public prepare request dated before the retained issue must return `StaleDependency` and leave financial and preparation records unchanged. Correcting the fixture date does not relax the owner's refusal.
