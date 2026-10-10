# Phase 6. Playbook registry and the supplier invoice playbook

[Overview](overview.md)

## Goal

Playbooks are data, not code branches. The first playbook prepares a period's supplier invoices using only existing owners, firm memory and rules. No model runs. This proves the orchestration value on its own.

## Changes

- A typed playbook registry. Each entry lists ordered steps, step kinds, required authority, and the gated checks it must leave passing.
- A manifest builder. It computes period-work children and rules from **one** consistent capture and hands them to `preparePeriodWorkManifest` as reviewed input. Selection and capture must never be two snapshots (`application/period-work.ts:198-206`). Today callers must supply the children by hand.
- Routing uses the existing `routeWork` (`packages/domain/src/period-work.ts:337`) and its `missingFacts`. No second router.
- A plan preview read. It returns the steps that will run, the steps skipped with a reason, and the checks that will be evaluated.
- The supplier invoice playbook covers recognition, a firm-memory suggestion, review preparation, and a person step for approval.
  - Mandated execution is included only where a book's authority policy enables it.
  - ADR 0020 is still proposed, so the playbook must work fully without mandates.

## Data structures

- `Playbook`. `{ id, version, steps: StepSpec[], exitChecks: CheckId[] }`.
- `StepSpec`. `{ kind, owner, command, authority, skipWhen }`.
- `PlanPreview`. `{ steps: { spec, willRun, skipReason }[], exitChecks }`.

## Failure cases

- A skipped step is missing from the preview. Every skip must carry a reason.
- The playbook posts anything without approval or a valid mandate.
- The builder reads sources twice and the selection differs from the capture.
- Rerunning the playbook on a finished period creates duplicate reviews.

## Verification

- Static. Changed checks, owners.
- Runtime. Run the playbook on the Phase 3 month.
  - The scorer must show the supplier expectations VERIFIED, and record touches against the baseline.
  - Postings without approval or mandate must number zero.
  - Artifacts under `test-results/agent-p6`.

Size M. Depends on Phases 3 and 5.
