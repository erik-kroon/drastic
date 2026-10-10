# Testing

[Overview](overview.md)

## The harness

Phase 3 builds the harness every later phase is measured against. It has four parts:

- **Scenario catalog.** Written before the generator, in `docs/operations/`. Implementation must not edit it without a recorded reason.
- **Generator.** Builds three firms and twelve books from a fixed seed. It works through public HTTP, except for the documented operator step that seeds synthetic rule releases.
- **Scorer.** Reads the Phase 1 close predicate and database counts, then writes one verdict per gold expectation: VERIFIED, NOT VERIFIED or INCONCLUSIVE. INCONCLUSIVE is not a pass.
- **Baseline.** Captured before any run exists, as `verification/agent-mode/baseline.json`. Later reports compare against it.

## Per phase

Every phase lists its failure cases before implementation and proves them in E2E against real PostgreSQL and workerd:

```sh
OPENERP_E2E_ARTIFACTS=test-results/agent-pN bun run test:e2e apps/api/tests/<suite>.e2e.test.ts
```

| Change | Commands |
| --- | --- |
| Every change | `bun run check:changed` |
| Async or Promise code, and before handoff | `bun run check:changed:full` |
| New domain leaf | `bun run check:owners`, with its consumer declared in `docs/plans/domain-leaf-integration.json` |
| MCP catalog, prompts or resources | `bun run test:mcp` and `bun run test:mcp:eval` |
| UI | `bun run check:design` against the PR base, `bun run check:browser`, `bun run test:browser` |
| Runner or step executor | Kill-and-resume at each step boundary, comparing canonical projection digests |

Run checks from a clean worktree of the commit being claimed. Untracked files in a shared working tree have hidden failures before.

For the engine (Phases 4 and 5), substitute only transport, clock, randomness and providers. Never mock the event sink or the database. Borrowed from T3 Code's testing strategy, with one gap of theirs avoided. Include these cases:

- two runtimes against one PostgreSQL database, with one killed mid-run;
- a retried command produces one effect, executed once;
- only one runner can claim an effect;
- settlement fails after the owner committed, and the next claim reconciles from the owner's receipt.

## Program checks

- **Scorer.** Run it over all twelve books after Phases 6, 10, 11 and 12. Keep each report.
- **Egress scan.** After any phase that calls a provider, scan what the fixture provider actually received. It must contain no registry identity and no personal identity number. Report raw-document disclosures separately, because the raw-document policy sends originals on purpose.
- **Posting audit.** Count postings that lack a human approval or a valid mandate. The count must be zero.
- **Decision trail.** One TSV row per decision and per phase, kept under `verification/agent-mode/`.

## What these tests do not prove

Synthetic results do not qualify a live provider, a real book, a statutory rule release or a filing. Each of those needs its own authorization and evidence.
