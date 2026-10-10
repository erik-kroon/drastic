# CI domain-owner coverage

CI runs `test:domain-owners` in two Vitest shards. Each runner owns a fresh synthetic PostgreSQL cluster. Test files remain serial within each runner because some workflows alter shared database constraints.

MCP protocol and checkpoint/restore proof run once, on shard 1. A failed domain-owner test does not skip these independent checks. Both shards finish when one fails. Nightly qualification also retains independent verification after a test failure.

The coverage job reads actual results and source-integrity receipts from both runners. It rejects failed or skipped tests, empty shards, duplicate files, missing workflows and source changes during a run or different source inputs between shards. The expected files come from `package.json`. Vitest's `list` command does not apply sharding, so it cannot prove coverage.

To repeat the partition and coverage check locally, build the applications first. Run these commands without editing application inputs between or during the runs.

```sh
bun install --frozen-lockfile
bun run build
OPENERP_E2E_ARTIFACTS=test-results/domain-owners-1 bun run test:domain-owners --shard=1/2
OPENERP_E2E_ARTIFACTS=test-results/domain-owners-2 bun run test:domain-owners --shard=2/2
node verification/ci/shards.e2e.mjs
```

Each shard retains `results.json`, `junit.xml`, `manifest.json` and `source-integrity.json` with its workflow evidence. The coverage check writes `test-results/ci/shards.json`. CI uploads both E2E archives and the coverage receipt.

Recovery proof runs through the existing CLI journey. It checks both AI identity sequences with nonzero positions, retains unknown-sequence refusal and exports a credential-free restore certificate.

```sh
OPENERP_REHEARSAL_ARTIFACTS=test-results/domain-rehearsal bun apps/api/scripts/operations/rehearsal-e2e.ts
```

The public rehearsal directory must be new. Production recovery and provider outcomes remain outside this local synthetic proof.
