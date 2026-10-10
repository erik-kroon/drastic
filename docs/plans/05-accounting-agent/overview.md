# 05 Accounting agent mode

Status: plan approved by the owner, 2026-10-10. Not started. Revised after an independent review against the code. Approval of the plan does not accept ADR 0019 or ADR 0020, choose an LLM provider, or approve live source fetching. Those remain open decisions below.

## Context

A bureau wants to say "Gör september klart för Fjällby" and get back a finished month with a short list of what needs a person. Today Drastic prepares work one owner at a time, and a person drives every step.

ADR 0021 defines the layers: facts, firm memory, decision models, orchestration agents, verification, ratified rules and people. PR #19 landed provenance, firm memory and the decision-model adapter. The orchestration layer does not exist. The largest remaining lever is completeness: knowing which facts are missing and getting them from the client in one question.

This plan builds an in-app agent mode in the style of poteto-mode. An outcome and a check come in. A playbook runs as a typed, resumable sequence of steps. The run ends only when deterministic checks pass. The first version uses code, rules, firm memory and people only. Decision models and an LLM come afterwards, as measured improvements on that result.

Rule sources and lookup are a separate plan, [06 Rule sources](../06-rule-sources/overview.md).

## Definition of done

The month-close playbook (Phase 10) runs on the Phase 3 synthetic bureau month (three firms, twelve books) and every book ends in this state:

1. Every check in the gated set is a fresh `pass`, or it has exactly one waiting item or client question naming its cause. Each book's gold end state, written in Phase 3, says which gated checks must move from fail to pass. The scorer verifies those moves against the baseline.
   - The report keeps two results apart.
     - **The month is complete** only when every gated check passes.
     - **The run is settled** when every check that does not pass has exactly one waiting item. A waiting item accounts for a blocker. It never satisfies the check.
2. Checks outside the gated set are reported as `not_established` and never count toward done.
3. No ledger posting exists without a human approval or a valid mandate.
4. Every supplier treatment on the AUT-04 supported path pins a rule release valid on its transaction date, on both sides of the synthetic rate change. Other paths report the category as unknown.
5. Killing the runner at every step boundary and resuming gives the same canonical projection digest.
6. The run report states touches per transaction against the baseline, and handled transactions measured with AUT-25. These are measured, not gated.

Phases 11 and 12 add one more condition. What the fixture provider received contains no registry identity and no personal identity number. Raw-document disclosures are reported separately.

Real books, live providers, statutory rule releases, filing and payment stay outside this predicate. Each needs its own authorization.

## Scope

Included:

- the close predicate (AUT-06) and the voucher support check;
- the synthetic month harness;
- the run model and step executor;
- the playbook registry and the supplier invoice, completeness and month-close playbooks;
- the missing-fact model and one batched client question;
- decision-model and LLM steps as measured improvements;
- design boards, UI, and MCP prompts for playbooks.

Excluded:

- filing, payment or signing beyond preparing them for a presence gesture;
- payroll and year-end playbooks;
- cross-firm learning and firm adapter training;
- rule sources (plan 06);
- metering, caps and billing. ADR 0005 keeps agent workflows in the open core and the managed control plane in a separate repository. Any cap applies only to hosted inference there. Prices stay in the private company workspace.

## Constraints

- **Authority.**
  - Agents prepare and record. People approve. Approvals bind to exact digests.
  - Mandates follow ADR 0020, which is still proposed, so every playbook must work without mandates.
  - No period-work write is an agent tool today (`capabilities/agent-policy.ts:179`).
- **Modes.** Shadow or suggest is set per decision question per book from the operator console (ADR 0021), never per run.
- **Transactions.** No model or provider call inside a financial transaction (`docs/domain.md:90`). Owner commands replay through stable command keys.
- **Snapshots.** Period-work selection and capture come from one snapshot (`application/period-work.ts:198-206`).
- **Data minimisation.** Free-text client messages and document text stay out of every model state (ADR 0021). Every provider call goes through the AUT-28 egress boundary.
- **Immutability.** Append-only tables. Mutable control rows are fenced by revision or generation. Unknown is never reported as complete.
- **Design.** Eight K-04 statuses. No percentages in work screens. UI only after board adoption, with the manifest updated in the same change.
- **Testing.** Failure cases come before implementation, then real E2E with retained artifacts. Data is synthetic only.

## Alternatives

**Run engine.**

- A. An LLM loop that chooses each next tool call. It is flexible, but hard to resume, verify, bound or authorize.
- B. A typed playbook state machine on the server. It calls owners, rules, memory and models by role.
- C. B plus a bounded investigation step, where a read-only agent returns one typed finding.

The direction is C. The exact data shape is a one-way door. Phase 4 decides it in an arena, which includes extending the existing `PreparationRun`, plus the patterns in [harness-research.md](harness-research.md).

The owner decided on 2026-10-10 that Drastic builds its own engine, inner LLM loop and code-mode executor, and borrows proven patterns. No agent harness or workflow framework becomes a runtime dependency. The [borrow ledger](harness-research.md#borrow-ledger) tracks each borrowed pattern and where it lands.

**Completeness.**

- A. Let an agent chase freely.
- B. Enumerate missing facts deterministically, and ask one batched question with typed answer slots.

The choice is B. It is verifiable and never asks twice.

## Phases

Stage 1 proves "done" can be checked. It is the scaffold and the riskiest unknown.

1. [Close predicate, implementing AUT-06](phase-01-close-predicate.md). M.
2. [Supporting document per voucher](phase-02-voucher-support.md). S.
3. [Synthetic bureau month and baseline](phase-03-synthetic-month.md). M.

Stage 2 is the engine without any model.

4. [Run model](phase-04-run-model.md). L. Arena.
5. [Step executor](phase-05-step-executor.md). M.
6. [Playbook registry and the supplier invoice playbook](phase-06-supplier-playbook.md). M.
7. [Runs in Att göra, pause and hand-over](phase-07-att-gora.md). S.

Stage 3 is completeness. It can run in parallel with stage 2.

8. [Missing-fact model](phase-08-missing-facts.md). M.
9. [One batched question to the client](phase-09-client-question.md). L. Blocked on ADR 0019 for clients.

Stage 4 is the program predicate.

10. [Month-close playbook](phase-10-month-close.md). M.

Stage 5 adds models as measured improvements.

11. [Decision-model steps](phase-11-decision-steps.md). M. Needs AUT-11, AUT-12 and AUT-28.
12. [LLM steps and investigation](phase-12-llm-steps.md). L. Eval-gated. Needs AUT-24.

Stage 6 is the surface.

13. [Product surface and MCP playbooks](phase-13-surface.md). L. Boards can start now.

The parallel tracks are:

- the engine, Phases 4 to 7;
- completeness, Phases 8 and 9;
- design boards, Phase 13;
- plan 06.

Each track needs its own worktree and owner. At the start of a phase, its implementer splits it into units of two or three files, each ending in a check.

## Open decisions for the owner

- **ADR 0019, the client role.** Phase 9 cannot reach clients without it.
- **ADR 0020, mandates.** Playbooks run without mandates until it is accepted.
- **LLM provider and hosting for in-app steps.** This is part of the AUT-00 data-use decision. Phase 12 runs on fixtures until it is made. The leading candidate is Claude on Amazon Bedrock through an EU geographic inference profile, which keeps processing inside EU regions. It needs a DPA review, a check of each model's regional table, and the AUT-28 boundary in front of it.
- **Whether agents may start runs.** The proposal is that people start and stop runs, an agent reads the plan preview only, and the runner advances steps with its machine credential.
- **Design adoption** for boards AUT-D11 and D12.

## Applicable skills

- **how** before changing period work, preparation runs, closing readiness, work questions or company-profile selection.
- **architect** with **arena** for Phase 4.
- **interrogate** for Phases 4 and 12 before shipping.
- **create-verification-skill** for the Phase 3 harness.
- **show-me-your-work** for the decision trail.
- **unslop** for every prose surface, including question templates.
- The repository's code-review skill after each PR.

## Verification

See [testing.md](testing.md). The commands are:

- `bun run check:changed` and `check:changed:full`;
- `check:owners`;
- `check:design` for UI;
- `test:e2e` with retained artifacts;
- `test:mcp` and `test:mcp:eval` for MCP;
- `test:browser` for UI journeys;
- the Phase 3 scorer.

Claim a check only from a clean worktree of the commit.

## Implementation guidance

- Follow poteto-mode.
  - Copy each phase's steps into a todolist.
  - Name the data shape first.
  - Reproduce before fixing.
  - Verify each unit before the next.
  - Run a diff cleanup before each commit.
- This plan proposes new handoff items for Linear:
  - AUT-29, the run engine and playbooks (Phases 4 to 7 and 10);
  - AUT-31, the missing-fact model and batched question (Phases 8 and 9, extending AUT-26);
  - AUT-D11 and D12, the boards.

  Phase 1 is AUT-06. Plan 06 proposes AUT-30.
