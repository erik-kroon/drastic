# Zero-counter presence evidence

The production presence implementation was unchanged. This corrects the ADR description of counter handling; it is not a runtime defect repair.

The synthetic HTTP journey enrolls an ES256 software authenticator with initial counter `0`, then signs two fresh challenges with counter `0` for distinct signature-intent keys and public document manifests. Both assertions are accepted, both stored counters remain `0`, and each exact request consumes its own proof once. Wrong-key requests remain `PresenceRequired`; duplicate assertions remain `Forbidden`; exact command replay returns the same intent without consuming another proof.

The existing presence journey also passed, including its nonadvancing positive-counter clone refusal. Two tests passed; one unrelated presence-off test was unselected. No hardware authenticator or browser behavior was exercised.

Repeat from the repository root:

```sh
OPENERP_E2E_ARTIFACTS=test-results/presence-zero-counter bun run test:e2e apps/api/tests/presence.e2e.test.ts -t 'zero-counter authenticator|presence proof binds one person'
```

Retained evidence:

- `observed.json`: synthetic challenges, exact binding digests, accepted proofs, stored counters, one-consumption counts and replay identities.
- `results.json`: selected test outcomes.
- `source-integrity.json`: stable behavior-run source inventory `8e22fea9a047c31f4fb23e4d290243326fb1a70a94d54981838c36396b94ed10`.

The repeatable harness additionally writes disposable-runtime manifests, Worker logs, migration logs and complete test reports to `test-results/presence-zero-counter/`. Verification documentation was retained after the behavior run; its addition does not imply a second run against a later documentation inventory.
