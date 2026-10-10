# DRA-106 retained accessibility closeout

The clean continuation preserves the original keyboard recovery and responsive
original-document work without importing the old conflicted worktree. The PDF
viewport now fits its container while retaining its 595 px maximum. Bank-review
acknowledgment controls stay reachable at native browser zoom.

The repeatable browser qualification runs four bank-evidence journeys and one
posting-recovery journey against real synthetic PostgreSQL/API/web runtimes.
Both default mode and native 200% zoom with reduced motion passed all five tests.
The native run observes device pixel ratio 2 and a 720 CSS pixel viewport from a
1440 pixel window, verifies reduced-motion media and keyboard focus, and retains
original evidence, unknown-outcome recovery and posted-voucher checks.

Run from a fresh checkout:

```sh
bun run test:browser tests/browser/bank-evidence-review.e2e.ts tests/browser/posting-recovery.e2e.ts
OPENERP_NATIVE_ZOOM=1 OPENERP_REDUCED_MOTION=1 bun run test:browser tests/browser/bank-evidence-review.e2e.ts tests/browser/posting-recovery.e2e.ts
```

[Qualification receipt](../../verification/accessibility/2026-10-10/receipt.json)
links the stable input inventories, results and selected screenshots. The proof
records exact dirty-source hashes rather than claiming clean-checkout execution.
It predates the subsequently integrated API import-only PR #33; final checks run
against that merged base. No visual parity or production qualification is claimed.

The native browser provider uses a disposable profile and reapplies real reduced
motion when CDP attachment/navigation resets emulation. Provider failures fail
the run. The default posting test expects the canonical amount's current wrapping
policy while retaining containment checks; it does not change amount presentation.
