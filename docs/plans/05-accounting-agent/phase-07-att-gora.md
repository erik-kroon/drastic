# Phase 7. Runs in Att göra, pause and hand-over

[Overview](overview.md)

## Goal

A person sees exactly one Att göra item per step that waits on them, with its cause. A run can be paused, resumed and handed to a colleague.

## Changes

- A new work kind for run steps in `contracts/workspace.ts` and `listAttention` (`workspace.ts:512`). Period work is not a work kind today.
- Pause, resume and hand-over commands. Hand-over changes the responsible person and keeps the run's history.
- Read model only in this phase. The screen composition waits for the design board in Phase 13.

## Data structures

- `RunWorkItem`. `{ runId, ordinal, cause, status }`, using only the eight K-04 statuses.

## Failure cases

- One waiting step yields two items, or none.
- A resolved step leaves its item open.
- Hand-over loses the decision trail.
- A paused run advances when the runner restarts.

## Verification

- Static. Changed checks, owners.
- Runtime. E2E over HTTP for item creation, resolution, pause across a runner restart, and hand-over. Artifacts under `test-results/agent-p7`.

Size S. Depends on Phase 6.
