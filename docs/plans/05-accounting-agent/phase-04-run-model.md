# Phase 4. Run model

[Overview](overview.md)

## Goal

Choose and land the data shape of a playbook run. This is a one-way door. Every later phase reads and writes it. Run the `architect` skill with an arena and a judge from a different model family before writing the migration. Use the harness research in [harness-research.md](harness-research.md) as input.

## Arena candidates

Every candidate must carry the research's "Borrow" list:

- decide, commit and act through an outbox;
- run, attempt and node;
- intent, effect and outcome;
- a durable inbox;
- approvals as durable waiting nodes bound to digests;
- context epochs.

The candidates differ only in where these live.

- **A.** A new event-sourced run owner beside period work.
- **B.** Period work generalised. The manifest becomes one node kind.
- **D.** An extension of the existing `PreparationRun` and `PreparationJob` (`contracts/automation.ts:139-167`, `application/preparation-jobs.ts`). They are already checkpointed, stoppable, runner-driven, and stoppable over MCP (`runs_stop_background`).
Not candidates (by the owner decision to build our own engine):

- **Effect's durable workflows** (`effect/unstable/workflow`). These are unstable and were alpha in May 2026. Read them for activity semantics: stable names, schemas and idempotency keys.
- **Yielded Agent's durable runtime.** It is beta, and its store format may change. Read its recovery table before the arena.

- **Cloudflare Workflows and the Agents SDK.** They run only on Cloudflare, and ADR 0009 moved preparation off Cloudflare Workflows to effect-mq for self-host.
- **Separate workflow servers such as Temporal or Restate.** They add a runtime that duplicates PostgreSQL plus effect-mq.

Judge on these criteria:

- resumability after a kill at every boundary;
- durable approvals;
- authority clarity;
- reuse of existing fencing;
- migration size;
- how a bounded investigation node fits.

## Fixed from the T3 Code source read

At commit `8c777fb`, see [harness-research.md](harness-research.md#borrow-ledger).

- **Command receipts.** Each receipt stores a digest of the command payload. A reused command id with a different payload is refused. T3 Code checks only the thread.
- **Events and projections.** Events are append-only with a unique run and stream version. Projections are rebuilt through the same reducer, with a verify step. There is no event compaction, because posted history is immutable.
- **Approvals are message-style.** An approval is a waiting node plus an inbox entry, consumed at a node boundary.
  - The request stores the record digests.
  - The response carries the digests the person saw, and the decider refuses a mismatch.
  - The owner command re-checks the digests inside its own transaction.
  - Recovery never expires an approval node.
- **Completion is a finalisation effect.** It runs through the outbox after the gated checks, under a deterministic command id.
- **Fencing lives in PostgreSQL.** Compare-and-set on revision and active attempt. A lock held only in process memory is never the fence.

## Decisions fixed before the arena

- **No run-level mode.** ADR 0021 sets shadow or suggest per decision question per book, from the operator console only. Each decision step reads its mode from `book_decision_policies`.
- **Agents start nothing yet.** No period-work write is an agent tool today (`capabilities/agent-policy.ts:179`). Until the owner decides otherwise, an agent may read a plan preview only.
- **People start and stop runs.** Starting and stopping need a human session. The runner advances steps with its machine credential.

## Changes

- The chosen run tables or extensions, with contracts for start, read, pause, resume and stop.
- Gestures for the new commands in `application/authority.ts`.

## Data structures

- `Run`. `{ id, book, period, playbook: { id, version, digest }, outcome, startedBy }`.
- `RunControl`. A state machine. `planned → running → waiting_on_person → verifying → done | stopped`, plus `paused`. Fenced by `revision` and `cancelVersion`.
- `Attempt`. `{ runId, number, reason }`. A retry adds an attempt and never overwrites one.
- `Node`. `{ attempt, parent, kind: owner_call | rule | memory | decision | llm | investigate | approval | check, inputDigest, idempotencyKey, replay: safe | reconcile, status, resultRef, provenanceRef, contextEpochRef, cost }`. Only the root completes the run.
- `InboxEntry`. `{ runId, callerId, kind: outcome | answer | approval | steer, acceptedAt, consumedAtNode }`.
- `ApprovalNode`. `{ node, approves: recordDigests, gesture: session | presence, state: pending | resolved | expired | cancelled }`. It survives restarts.

## Failure cases

- Two runners advance the same step. The fence must refuse the second.
- A stopped run advances.
- A step result from an older playbook version finalises a newer run.
- An agent credential starts or stops a run.
- A pending approval is lost or expires because the runner restarted.
- An approval resolves for records whose digest changed after it was requested.
- One inbox entry is consumed twice.

## Verification

- Static. Changed checks, owners.
- Runtime. E2E for every state transition and every failure case, including concurrent advance. Artifacts under `test-results/agent-p4`.

Size L. Depends on Phase 1. Coordinate the migration number with in-flight branches (AUT-11 parked, AUT-28 in progress).
