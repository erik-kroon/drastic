# Handoff for the current integration agent

The parent kit is already integrated under `verification/bend/` with uncommitted changes. Preserve all of that work. In particular, keep its temporary-path fix, current shared-rounding owner mapping, corrected VAT scaling, original-byte archives and fresh local evidence.

## Integrate this archive

1. Install only the new `verification/bend/authority/` child using the no-overwrite installer or copy that directory to a nonexistent destination. Do not overlay the child root onto `verification/bend/`.
2. Read the child's README and `docs/PROOF-COVERAGE.md`. Run the parent and child local commands separately. The child's evidence is not a replacement for the parent's 11,244-assertion report.
3. Compare shared Bend model files with `compare:parent`. Carry forward relevant integrated fixes into the child candidate instead of overwriting the parent with old source. Keep archival bytes unchanged.
4. Bind a narrow current-owner adapter using the parent's existing real-owner knowledge. Its output must satisfy `docs/CURRENT-OWNER.md`; use `reportingUnitMinor` and a reviewed mapping, never the old field-name assumption. Do not use the archived excerpt as the new owner.
5. Obtain and hash-check the pinned upstream source. Run official source checking, safe checking and compiled-artifact tests through the release gate. A missing tool, changed pin, excluded definition or ABI mismatch is a failure, not a waiver.
6. Wire the actual application monetary seam and isolated real-host verification. Preserve TypeScript qualification/coverage/readiness, existing canonical sealing, database authority and transaction-passing persistence. Do not replace all of `calculateActualVat` with a box calculator.
7. Only after the relevant gates pass, stage a candidate for the exact operation set. Keep deployment trust empty until an explicit review approves that exact candidate and runtime. Do not quietly use TypeScript when a promoted Bend calculation fails.
8. Delete a duplicated TS production algorithm only after the actual caller cutover is qualified. Keep independent result checks and existing database constraints.

Run the repository's normal changed-file checks on actual integration changes. Never weaken type, lint or test rules to make a new language path appear ready. These artifacts alone do not justify a repo-wide refactor, a new persistent service, a queue, a financial migration or a change to existing idempotency/canonicalization semantics.

## Mandatory reporting

Distinguish local development checks, official source checks, safe-kernel checks, generated-artifact execution, current-owner comparison, actual host integration and explicit deployment approval. Report which ran, the artifact/source/runtime identities involved and every blocker. Do not report 'officially verified' from the development checker.

No background work, production action or repository write has been performed by the archive author. The parent remains the integration agent's current worktree.
