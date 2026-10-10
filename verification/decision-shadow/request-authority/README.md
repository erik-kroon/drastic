Admission and shadow diagnostic reads now require the book operator role. Requester freshness requires that role at the existing locked dispatch fence. Dedicated machine-runner authority is unchanged.

Failure-first commits `cd31e39` and `0e0e9b4` reproduced agent admission/read and operator downgrade respectively. Before the fix, agent reads and admissions returned 200 and added a request/control row. A downgraded requester dispatched once and retained a validated result. Source fix `127cf2c` changes the two operator-only admission flags and the requester role predicate.

All seven decision-job workflows passed from clean committed source `6190d6c`. They retain operator success, foreign-scope refusal, agent 403 responses without extra requests, and stale downgrade with zero disclosure and provider calls. The full synthetic runtime packet is under `test-results/decision-request-authority-verified/`. This folder retains the new observations and result/source-integrity receipts.

The first seven-workflow run at `127cf2c` passed four and failed three. One new test lacked its Schema import. Two existing queue scenarios returned fixture HTTP errors before validated calls. A narrow diagnostic then passed, so it did not identify those errors. The controlled reader reproduction at `66b53a8` retained PostgreSQL 55P03 at the immediate fixture book-lock probe with an independent granted RowShareLock. The earlier controlled run could not retain the SQL cause because diagnostic wiring targeted the wrong catch; it is not used as cause evidence.

The fixture now waits at most one second to acquire the book lock. The 100 ms independent reader clears and the actual queue result is validated once. A separate lock held until HTTP response still returns 500 and 55P03 with zero validated calls. This test-only correction keeps the proof that a response-dependent posting transaction cannot hold the book lock across the provider call. No production retry, lease, adapter or queue behavior was changed by the probe fix.

```sh
OPENERP_E2E_ARTIFACTS=test-results/decision-authority-repeat bun run test:e2e apps/api/tests/decision-jobs.e2e.test.ts
```

The required changed check against `ea033f5` passed, including API and test types. An earlier check termination with exit 143 is unverified; a later unsupported flag invocation is not a source failure. Final clean integrated full, owners and design gates remain pending. This unit changes no MCP catalog or UI. No live provider or production qualification is claimed.
