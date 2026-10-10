# Resumed decision shadow jobs

This synthetic-only unit replaces the parked text-state/quota design with background requests containing an explicit financial-fact allowlist. The provider receives typed amounts and dates, plus server-authored question criteria. Source text, client/line descriptions, private IDs, target treatment/labels and whole precedents are omitted. Source and same-book v2 precedent IDs/digests/cutoff remain internal immutable request evidence. The separate structured question/state release makes the changed input semantics visible; the historical text-segment catalog release remains unchanged.

The question has little semantic evidence: amounts and dates alone do not establish document kind, so its instructions require unknown when unsupported. Authored fixture choices are protocol/fencing evidence, not accuracy, useful coverage or autonomy qualification.

Policy is append-only off/shadow, written using separate privileged operator credentials. Runtime has SELECT only. No quota, dispatch budget, reservation, pricing or billing owner exists. The pinned technical input window remains in policy/result identity evidence. Ordinary preparation runner test hosts explicitly disable the decision adapter unless an authored fixture configuration overrides it.

## Failure-first evidence

Tests and the resumed failure contract were committed as b823d62 before runtime edits. Retained runs are separate:

- `test-results/decision-shadow-resume-baseline`: direct processing failed egress_refused before reaching the old queue stage. This does not prove queued delivery.
- `test-results/decision-shadow-queue-before`: real effect-mq job completed, request failed egress_refused, zero provider calls. The obsolete two-argument port passed a signal as egress.
- `test-results/decision-shadow-local-refusal-before`: size refusal, zero calls, but a false durable dispatch marker and unknown usage.
- `test-results/decision-option-digest-before`: catalog/request option digest mismatch.
- `test-results/decision-reported-usage-before`: validated result retained usage while its terminal attempt incorrectly reported unknown/null.
- `test-results/decision-shadow-uncertainty-before`: two failures: timeout after transport incorrectly failed instead of uncertain; expired pre-dispatch guard with zero transports incorrectly reported after-disclosure uncertainty.

Each run retains results/JUnit and source-integrity metadata. Earlier after runs preceded the final uncertainty correction and are not final qualification.

## Repeatable focused verification

```sh
OPENERP_E2E_ARTIFACTS=test-results/decision-shadow-resume-qualified bun run test:e2e \
  apps/api/tests/decision-jobs.e2e.test.ts \
  apps/api/tests/decision-questions.e2e.test.ts \
  apps/api/tests/decision-model.e2e.test.ts \
  -t 'decision shadow lifecycle|decision runner auth|decision queue resumes|local decision refusal|expired guard|admitted book catalog|decision adapter configuration|authored Workers AI binding|decision state limits'
```

Final behavior run: 10 passed, 1 unrelated protocol-vector workflow unselected. Stable behavior-run source inventory: `5ea67b972bdb701d0e53d1cc541879019a8fc8fef358f72990f2a8a30ed8647c`. A later test-only spacing correction leaves the runtime/behavior unchanged; clean qualification pins the final tree separately. Lifecycle artifact retains 15 requests, 2 results, 43 append-only attempt events, 14 actual fixture transports, 2 dedicated queue jobs and zero suggestion exposures. Its 27 unknown-usage values count evidence rows, not calls/tokens/cost. Validated terminal attempts retain provider_reported usage separately. The queue probe retains validated/one actual transport. Local size refusal and expired pre-dispatch guard each retain zero transports, no intent marker and not_disclosed terminal evidence.

The lifecycle artifact includes actual received financial-state envelopes for egress inspection and per-scenario outcomes. The binding/noninterference artifact retains exact on-book ordinary read/receipt/queue equality and paired off/on financial projections, with independent exact approval/review/plan/receipt binding assertions. Generated IDs/time and content-derived IDs are not treated as financial differences; amounts, treatment, status, writer epoch, commit sequence and ordinary queue counts remain exact. The book NOWAIT probe proves the book lock is released during the call; provider-outside-transaction is also established by the processor's explicit claim/egress/guard/finalization boundaries, not by that lock probe alone.

## Dispatch evidence and limits

The optional adapter pre-dispatch guard runs after AUT-28 admission/tokenisation and both complete-byte checks. It atomically checks the live lease/requester/subject/policy and commits a durable intent before transport. The legacy `disclosed` phase/column stores this intent, with transportConfirmed:false; it does not prove remote execution. A crash after intent can have zero actual calls and remains uncertain without redispatch. Local refusal before this guard is not_disclosed. Timeout, abort or network/binding failure after intent remains uncertain; known 429/invalid responses remain failed. Validated responses and protocol-reported usage are retained evidence, not independent billing verification. AUT-28 admission events separately prove admission, never actual transport.

These are loopback HTTP and authored binding tests. No live Cloudflare deployment/binding, real provider, book data, immutable-weight qualification, suggestion UI/browser parity or model accuracy was exercised. HTTP shadow requests never grant posting authority. Clean full/owners/design qualification is coordinated separately by the parent after the source checkpoint; reachable MCP schema changes require the repository MCP gates.
