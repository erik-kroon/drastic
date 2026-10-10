The failure-first rehearsal at `7991ca4` refused checkpoint creation because the decision-policy identity sequence had no declared owner. Fix `ea033f5` adds that owner. The same synthetic checkpoint and restore rehearsal passed at that commit.

The restored sequence retains `lastValue: 41` and `isCalled: true`. A new operator-console off policy gets sequence 42 and supersedes shadow policy 23. The original restored database remains quarantined. The assertion runs on a fresh local clone. No production restore or provider is qualified.

Repeat with a new artifact directory.

```sh
OPENERP_REHEARSAL_ARTIFACTS=test-results/policy-sequence-rehearsal bun apps/api/scripts/operations/rehearsal-e2e.ts
```

The source-integrity record identifies the actual tested source. The receipt lists the complete runtime artifact packet under `test-results/`; this folder retains the policy observation and source-integrity record only. Final clean static gates remain pending for the integrated review fixes.
