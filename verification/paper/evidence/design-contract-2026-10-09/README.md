# Design contract verification

Run `python3 verification/paper/verify-guard.py` from the repository root.
The recipe exercises the actual Oxlint plugin, repository guard and comparator,
restores temporary inputs and writes `test-results/design-guard/results.json`.
The retained results name source hashes and each expected refusal.

Synthetic identical/mismatched images are comparator controls, not application
screenshots. This record establishes tooling behavior only. No route is claimed
to match page 00. The manifest retains unverified statuses.

`bun run check:changed:full`, explicit plugin TypeScript checking and
`bun install --frozen-lockfile` passed during this delivery. Current page 00
baselines are distinct from the preserved historical parity manifest.
