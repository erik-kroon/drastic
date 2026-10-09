# Bureau portfolio

The portfolio composes the current firm membership, linked books and retained
client observations. Selecting a row opens its detail without granting book
access. Firm linking and accountant assignment retain their existing owners;
company decisions, posting and payment approvals remain book-scoped.

The current layout authority is page 00 in Paper's Enthusiastic lantern,
frame K09 (`3CFR-0`, 1440 × 900, token hash `8e14c182`). Its actual JSX, root and
95 descendant styles were inspected before implementation. The application
uses the shared StyleX component in `packages/ui/src/components/firm-portfolio.tsx`.
Desktop geometry follows the 224px sidebar, 48px header, 796px list, 420px
detail pane and 52px rows. Narrow screens stack the selected detail and retain
keyboard access to its actions.

Rows group blocked clients, pending requests, technically clear clients, locked
periods and unknown readiness. Retained open obligation instants order clients
inside each group; accountant review dates remain separate. Fifteen-row paging
applies to the combined filtered projection. A technically clear period does
not imply statutory or actual-company approval.

Pending requests retain metadata only. Creating, editing or revoking one sends
the exact expected revision to the existing firm owner. No invitation, book
grant, posting or payment is created. Revoking a request whose assigned
accountant has become unavailable clears that unavailable assignment in the
new terminal revision; earlier request history remains retained. Filter and
firm changes clear the selected detail. Escape respects a pending write and
returns focus through the shared dialog.

Bank observations remain dated and separate from whole-inventory signing.
Inventory replacement invalidates current signing while retaining its original
artifact. Closing readiness uses actual scoped checks. A technical lock keeps
its exact approval and receipt; an uninvalidated certificate normalizes an
absent invalidation record to null. Later dependency changes mark that
certificate stale without rewriting the locked receipt or posted history.

## Repeat verification

Run with disposable synthetic accounts and the pinned Luna browser launcher:

```sh
PAPER_FIRM_RECOVERY=1 bun run test:browser tests/browser/firm-portfolio-layout.e2e.ts tests/browser/bureau-portfolio.e2e.ts tests/browser/firm-portfolio-facts.e2e.ts tests/browser/firm-portfolio-bank.e2e.ts tests/browser/firm-access-requests.e2e.ts --ai-trace
```

The recovery profile provisions a second synthetic human in a separate book.
The browser assigns that human, deactivates the current firm membership and
revokes the retained request. Public signup remains disabled. The wrapper
owns the ephemeral credentials, processes and database cleanup.

On 9 October 2026, frozen source `447e8f4` with the retained recovery overlay
passed layout, bank, facts and access-request cases in run
`8e169d8f-6d62-461a-8100-d9ec5a573408`. Its fifty-client case failed before the
controls loaded. After adding a bounded control-readiness expectation, run
`f1ef3fe9-f01f-4eae-82fb-76f3a1b1c450` passed the fifty-client case, all four
pages, filter reload and target-only assignment change with one live Luna
judgment. Both runs retained stable source inventories. Earlier failed runs,
screenshots, videos, JSON owner comparisons and reports remain under
`test-results/testerarmy/<run-id>/` locally. These are exact-input synthetic
results, not clean-checkout, production or whole-screen pixel-parity claims.

The current evidence covers request keyboard/reload/scope recovery, unchanged
ledgers, dated bank observations and retained signed artifacts, failed and
successful technical readiness, exact lock replay and stale certificate
history. Whole setup acceptance remains owner-paused. Neighboring screens,
all desktop pixel manifests, 200-client qualification, every deadline time-zone
boundary, other-user book authority and external invitation/provider outcomes
retain their separate acceptance obligations.
