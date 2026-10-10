# Phase 5. Step executor

[Overview](overview.md)

## Goal

The preparation runner advances runs one step at a time. A kill at any step boundary followed by a restart reaches the same end state.

## Changes

- A new effect-mq queue in `runtime/preparation-queue.ts` and a loop in `apps/api/scripts/preparation-runner.ts`, using the existing delivery decisions in `runtime/delivery-dispatch.ts`.
- Admission in a short transaction. Execution outside any transaction. Finalisation under the fenced lease. No model or provider call ever runs inside a financial transaction (`docs/domain.md:90`).
- Each node commits its intent, calls the owner, then commits its outcome. The owner call uses a stable command key.
  - A node declared `replay: safe` repeats with the same key after a crash.
  - Any other interrupted node is marked uncertain and reconciled by reading the owner's receipt for that key. It is never retried blindly.
- The decider is pure. One transaction writes the node events, the projection, the command receipt and an outbox row. The runner claims outbox rows.
  - Reuse the application outbox that ADR 0009 already uses to cross the financial transaction boundary.
  - Claim with `FOR UPDATE SKIP LOCKED`, one lane per run, and a lease generation as the fencing token.
  - Notify only after commit.
- Expired leases are reclaimed while the API keeps running. Runners can die on their own. T3 Code reclaims only at startup.
- Each effect type is classified up front.
  - `safe` effects requeue.
  - `reconcile` effects read the owner's receipt by idempotency key. They are never cancelled blindly and never retried blindly.
  - If settlement fails after the owner committed, the next claim reconciles.
- Executors re-check the run and node state with compare-and-set before calling an owner. A late or duplicate claim then does nothing.
- The fence is checked in the transaction that changes state, not only when the job is claimed.
- The kill matrix stops the runner at each of these points:
  1. before intent;
  2. after intent;
  3. after dispatch;
  4. after the owner succeeded but before the local acknowledgement;
  5. after the database commit but before acknowledgement.
- Further cases:
  - a zombie worker resuming after it lost its lease;
  - an approval revoked concurrently;
  - a request key reused with a new digest;
  - a deployment that changes a step schema.
- Every case asserts one committed accounting effect, preserved audit evidence, and either a reconciled result or an explicit unresolved item.
- Inbox entries are consumed only at node boundaries.

## Data structures

- `StepLease`. `{ runId, ordinal, generation, leaseExpiresAt }`.
- `StepOutcome`. `advanced | waiting_on_person | failed_permanent | failed_retryable`.

## Failure cases

- A crash after the owner commits and before the step finalises produces a second owner effect. Replay must return the first.
- A lease expires mid-step and a second runner finalises a stale result.
- A permanent failure is retried.
- Budget exhaustion is reported as success.

## Verification

- Static. Changed checks, `check:changed:full` because this is async code.
- Runtime. E2E using `startRunner` and `stopRunner` from `tests/support/preparation-runner.ts`. Kill the runner at each step boundary of a three-step fixture playbook and compare end-state digests. Artifacts under `test-results/agent-p5`.

Size M. Depends on Phase 4.
