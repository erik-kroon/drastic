# Posting, approval and receipts

Owner: accounting work/kernel in `apps/api`, accounting/recovery contracts, and the journal/recovery workbench. Phase: P0/P1, with durable delivery extended at P3. Preserve the existing single-action lifecycle and recovery catalogue as the first implementation path.

**Replacement authority:** [ADR 0010](../adr/0010-application-owned-accounting-replacement.md) supersedes the function-only implementation, old-schema compatibility and old-digest portions of this packet without changing its posting, approval, receipt, correction or recovery requirements. SQL and Workflow references below describe the historical implementation; the application caller cutover is complete.

## User result and scope

A person or agent retains evidence, prepares exact effects, resolves blockers, obtains the required human approval, executes once, and can recover the same result after closing the browser or losing a response. Posted values are immutable. Preparation, validation and approval do not change balances. A current source inspection or matching result does not implicitly authorize posting.

The first accepted slice remains the explicit synthetic profile. Production activation adds the selected company profile, real identity and reviewed treatment; it cannot be accomplished by changing a readiness label. No arbitrary bulk SQL, browser-supplied execution lines or agent-issued human approvals enter the public contract.

## Records and transitions

| Record               | Required behavior                                                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan revision        | Immutable identity, scope, canonicalization/digest, exact actions/groups, evidence/rule/dependency references, preparer and time. A change creates another revision.                                                 |
| Validation           | Records which checks ran and against which revisions. Informational before execution; execution repeats relevant checks under lock.                                                                                  |
| Approval             | Exact revision/group identities, allowed effects, approver/authority basis, expiry and consumption. Revocation is append-only and prevents later consumption.                                                        |
| Execution receipt    | Group/effect IDs, approval, command identity, digest, allocated numbers, committed sequence and time. It remains readable after approval expires or actor access is revoked, subject to the reader's current access. |
| Recovery observation | Receipt or timed `not_observed`, fresh blockers and authority state; not a fabricated terminal failure.                                                                                                              |

The immutable plan has no mutable “posting” status. A projection combines pending/blocked/current/approved/executed facts. Approval can be active, expired, revoked, authority-lost or consumed; consumption cannot be undone to repeat an effect. Superseding a plan prevents new execution where appropriate without hiding already committed effects.

## Operations

| Operation family                 | Input and result                                                                                                        | Authority / boundary                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Retain evidence; prepare journal | Exact source reference, event/purpose identity, dates, accounts and amount strings → sealed proposal or blockers.       | Prepare permission; scoped evidence admission and no financial effects.                     |
| Inspect / validate               | Proposal ID → exact stored plan, evidence access and current dependency findings.                                       | Read/prepare as appropriate; no implied approval.                                           |
| Approve / revoke                 | Exact digest/version/groups and selected expiry; revocation identifies approval and reason → immutable authority event. | Human permission; checked under book barrier. Ordinary MCP catalogue excludes these grants. |
| Execute                          | Plan/group references, digest/version, approval ID, stable key → original or new execution receipt.                     | Posting scope plus valid approval; one transaction.                                         |
| Recover / discover               | Original key or retained proposal ID, paged book list → committed receipt or timed observation.                         | Scoped read; discovery survives lost browser state.                                         |
| Inspect ledger / voucher         | Snapshot/cutoff and scoped cursor → exact immutable effects and complete-prefix amounts.                                | Read permission; no live-list assumption for snapshot reports.                              |

Retain current endpoint/capability names in `accounting.ts` and `posting-recovery.ts`. Add approval revocation and explicit group-aware receipts through the shared contract when their consumers are implemented. Existing one-voucher receipt readers remain valid; domain bundles link constituent receipts through an aggregate receipt instead of rewriting historical ones.

## Execution algorithm

1. Authenticate the actor and establish entity/book scope using the shared credential/membership lock prefix; validate typed input without numeric coercion.
2. Acquire the book barrier; recheck runtime authority/epoch while retaining admission locks. Follow the authority-only revocation restriction in the shared contract.
3. Look up the scoped command key. Return equal committed replay; reject conflicting identity.
4. Load the sealed plan and selected group. Reject caller content substitution, changed digest, unsupported shape or already committed semantic identity with a different operation.
5. Lock relevant periods/accounts/capacities and approval in the shared order. Check profile/rule/source dependencies, eligibility, approval expiry/revocation and current approver/executor authority.
6. Allocate voucher numbers and book commit positions transactionally. Insert all financial/register effects, consume approval and persist command/group receipt plus outbox records.
7. Let final aggregate constraints check scope/balance/conservation, then commit and return the durable result.

Any refusal before commit leaves effects, counters, consumption and outbox unchanged. Commit response loss triggers recovery by the same key. Delivery can fail after commit without changing the books. A multi-voucher group has one externally observed committed boundary; report cutoffs cannot expose half of it.

Persist the group's first/last allocated sequence and aggregate receipt in the same transaction. A requested snapshot cutoff must be zero or the final sequence of a committed group. Reject an intermediate cutoff with `InvalidSnapshotBoundary` and return adjacent permitted boundaries; do not silently change the requested snapshot. Existing single-voucher transactions each form a boundary. Preserve old snapshot interpretation and label any older limited snapshot honestly rather than rewriting it during this extension.

## Recurring preparation and durable groups

Recurring rules initially prepare work for review. A rule revision pins its scope, source/event predicates, treatment/profile version, required evidence, schedule/time zone, amount limits and counterexamples. Changed supplier/payee identity, treatment, company profile or source meaning blocks the affected preparation and opens a review case. A rule cannot activate itself or grant posting/payment authority.

Admission of a multi-group run records an immutable manifest of group IDs/hashes, approval references and deterministic order. Each group commits its effects, consumed authority and checkpoint together; stopping a run stops only uncommitted work. Restart first recovers receipts and then rechecks current authority/dependencies for the remaining groups. Applied, blocked and unattempted groups remain distinguishable. Editing a rule creates a new revision and cannot replace an admitted group's effects under its old approval.

A later standing mandate is a separate human-authorized record, never inferred from a recurring rule. It binds permitted operation/treatment, book, named counterparties/payee versions, currencies, per-event and aggregate limits, frequency, validity interval, allowed source/rule revisions and revocation policy. Consumption and remaining limits are locked with the posting group; revocation prevents subsequent consumption. Mandates do not grant payment/signature/filing powers unless that distinct action was explicitly authorized. Unsupported or out-of-bound cases return to exact-plan human review. These conditions and competing-consumption failures are required before enabling mandate-backed execution.

## Failure and UI behavior

| Trigger                                                      | Product response                                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Evidence/account/period/profile changed                      | Name the changed dependency; keep the old plan readable; prepare a new revision and approval.                           |
| Approval revoked or approver lost authority during execution | Exactly one ordered result under the barrier: prior valid consumption or rejection. No use of an old cached permission. |
| Missing receipt while an old request is in flight            | Show “result not yet established”; recover or replay unchanged identity. Do not invite a new posting with a new key.    |
| Same event proposed twice under new keys                     | Show the original effect/receipt and relationship; refuse duplicate recognition.                                        |
| Browser reload after preparation/approval                    | Rediscover retained work and evidence; derive current actions from the server.                                          |
| Receipt says posted but read projection lags                 | Display the receipt and bounded refresh state; never resubmit to fix the view.                                          |

The review screen displays currency/scale, date/period, source evidence, exact lines, rationale, rule identity, dependency changes and approval scope. Hide technical hashes behind inspectable details while keeping the actual decision clear. Recovery must be keyboard reachable and must not require copying a key from developer tools.

## Delivery packets

| ID     | Deliverable                                                                                                                   | Depends on     | Acceptance                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PST-01 | Complete sealed plan/admission and immutable evidence inspection over current journal APIs.                                   | FND-01, FND-03 | E-02/E-03: exact large values; duplicate-key/Unicode admission; no ledger mutation during review.                                                                                      |
| PST-02 | Trusted approval/revocation and permission-expiry lifecycle with review UI.                                                   | PST-01, FND-02 | E-01/E-06: agent refusal, revoked/expired approval and permission races leave no effect.                                                                                               |
| PST-03 | Atomic posting, durable receipt, uncertainty recovery and reload discovery.                                                   | PST-02, FND-04 | E-04/E-08/E-10: competing first calls, lost response, injected rollback and complete-prefix reads.                                                                                     |
| PST-04 | Shared REST/MCP/browser behavior and precise errors/capability metadata.                                                      | PST-03         | E-11: equivalent effects and receipt identity; browser recovery and accessibility evidence.                                                                                            |
| PST-05 | Transactional outbox and bounded durable runs; recurring preparation and explicitly scoped mandate consumption where enabled. | PST-03         | E-08/E-17: committed posting survives delivery failure; applied/remaining groups distinct; changed facts/revocation block future consumption and concurrent limits cannot be exceeded. |

Exit: a fixed-revision artifact covers E-01–E-11 and E-20 relevant cases, including negative/cancellation/commit uncertainty paths. Existing happy-path and post-commit replay observations are reused as historical evidence, not counted as competing-first-execution proof.

## Exact durable preparation-job stop

Forward5100 adds an idempotent exact-job stop through REST/MCP using existing scoped preparation
authority. It fences one admitted job under the book/job barrier without altering its run,
checkpoint, audit, prepared proposals or ledger. Existing terminal jobs are returned unchanged
with an explicit `already_terminal` outcome; a new requested reason is not applied to them.
Successful replay preserves the saved result. A later delivery cannot advance that stopped job,
but a deliberate new admission remains separate. See [AUTOMATION.md](../../apps/api/docs/AUTOMATION.md#forward5100-stop-one-admitted-preparation-job).
This is PST-05 containment, not remote Workflow termination or posting authority. At the
application-owned cutover, the current Workflow/Cron runner is removed and the same
containment runs through the selected effect-mq/application operation path; a queue retry
still cannot post. Runtime and concurrency acceptance remain pending.

### Native background-job stop binding

Forward6000 fixes an invalid function-qualified reference to an unlabeled PL/pgSQL local
in the automatic stop branch. The distinct `stop_reason` local now supplies the retained
job reason. Revocation/expiry, disabled identity, executor-role loss, changed audit and
non-ready run conditions keep their original reasons and precedence. Authorization, lock
order, terminal/old-step recovery, checkpoint/result/audit handling and advancement keys
are unchanged. Independent source review found no extra behavioral change.
See [automation](../../apps/api/docs/AUTOMATION.md). No SQL/runtime execution was performed.
