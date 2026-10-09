# Drastic document intelligence, 9 October 2026

Local synthetic verification of the current public Drastic implementation. [Repeatable recipe and boundary](../../README.md). The reports retain revision `db5ca341977b6aab3dc6d65da8b6a987375a3bfd` plus exact working-tree input inventories. They establish stable source inputs during each run, not a clean checkout or production qualification. Unrelated existing work was present and is excluded from this delivery commit.

| Check | Result | Evidence |
| --- | --- | --- |
| Engineering checks | Full changed-code, browser type and domain ownership checks passed | [Full check](check-full.txt), [browser check](check-browser.txt), [owners](check-owners.txt) |
| Real isolated process | Passed hostile file/content/metadata, environment, network and subprocess denials; input/page/output/deadline/RSS limits; cropped/rotated page geometry | [Isolation receipt](isolation.json) |
| Bounded native queue | Eight jobs completed; ninth refused with `inspection_capacity`; later job completed | [Isolation receipt](isolation.json) |
| Public extraction, draft and question workflows | 25/25 passed | [API report](api/results.json), [inventory](api/manifest.json), [stable source receipt](api/source-integrity.json) |
| Concurrent extraction and replay | Both requests completed through serialized inspection; replay retained exact attempts and two total provider submissions | [Queue/replay receipt](api/document-reader-inspection-retry.json) |
| Invalid evidence and uncertainty | Named geometry/diagnostic caps, withheld low-confidence total, missing/unsupported fields and separate off/shadow studies | [Capacity receipt](api/document-reader-capacity.json), [diagnostics](api/document-reader-diagnostics.json), [review](api/document-reader-review.json) |
| Real self-host/preparation owners | Synthetic original to extraction and reviewed draft passed | [Process receipt](api/document-reader-self-host.json), [draft receipt](api/document-reader-self-host-draft.json) |
| Native browser workflow | 1/1 passed, exact source/page/zoom/uncertainty/persistence assertions and one screenshot-enabled Luna judgment | [Browser report](browser/report.json), [workflow](browser/document-intelligence-browser.json), [stable source receipt](browser/source-integrity.json) |
| Selected highlight SVG parity | Zero changed pixels at the 1% gate and 24-channel tolerance | [Parity receipt](browser/highlight-parity.json), [actual](browser/highlight.actual.png), [saved diff](browser/highlight.diff.png) |

[Uncertainty screenshot](browser/001-document-intelligence-selected-source.png) shows the withheld total and named missing fields. [Source screenshot](browser/004-document-intelligence-review-obligations.png) shows the retained original and selected quote at 125% zoom. Only the highlight component is compared to Paper; this is not full-screen parity or optical accuracy proof.

The first API run passed 24/25 and exposed an obsolete immediate-contention expectation after native inspection gained a bounded queue. The test now exercises current public completion and replay behavior; the real-process probe separately verifies queue overflow and release. Two browser attempts completed source selection but Luna returned a failed action verdict while describing success. The final run uses the exact source-button locator and retains Luna's independent screenshot judgment plus all deterministic checks. No failed run is counted as passing.

The supported inspector remains macOS-only. Its V8 old-space bound is hard; RSS enforcement is sampled. Live-provider policy, corpus coverage, per-attempt billable usage/cost, SiftX and other-host isolation remain unqualified. The scoped result does not close broader document-screen recovery, performance or baseline acceptance.

Reports and receipts are reviewed synthetic artifacts. Sessions, raw traces, startup logs, credentials and private planning history are excluded. Launchers cleaned their owned processes.
