# Bend monetary host qualification

The user requested closing the safe-kernel, current-owner and real-host gates on
2026-09-27. This authorizes the narrow VAT dependency seam and these qualification
tests. No production release is implicitly approved.

Failure obligations specified before implementation:

| Failure | Required observation |
| --- | --- |
| Candidate never reaches the VAT owner | Real `prepareActualReturn` calls candidate rounding and projection; retained rows match independent expected amounts. |
| Capture or output is mutable | PostgreSQL refuses mutation of the saved return; source basis and backend identity remain sealed. |
| Basis changes between capture and seal | A deterministic family-epoch change during calculation causes `StaleDependency` and no return/command receipt. |
| Candidate failure silently uses TypeScript | An injected candidate error returns `Unavailable` and commits no return. |
| Replay recalculates saved output | Repeating a committed command with a throwing calculator returns the identical saved result; reads retain that result after source changes. |
| Approved output is recalculated | A real synthetic journal prepared from a saved report amount is approved and executed through the existing HTTP/Worker posting path; the executed amount equals the sealed proposal. |
| Approval or runtime identity is fabricated | Artifact bytes/source identity are checked; host evidence names the Bun workflow runtime separately from the Node compiler/test runtime. Deployment trust remains separate. |

The host lane uses the existing disposable PostgreSQL/workerd E2E setup and a Bun
runtime entrypoint invoking the actual Effect VAT workflow with the restricted
runtime role. Maintenance SQL only seeds reviewed synthetic source records and
injects the declared failure. It never mocks the application, transactions or
calculator. HTTP approval/execution exercises the shared posting boundary; it
does not claim an actual-company VAT filing or control-reclassification product.

Run the separate qualification config through the authority `verify:host` hook;
the normal E2E suite does not require a downloaded Bend compiler or built artifact.
