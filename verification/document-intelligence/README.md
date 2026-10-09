# Document intelligence verification

The purchase extraction owner retains source identity, quoted evidence and untrusted field proposals. The native self-host and preparation runtime use the isolated document inspector. Operator-scoped off/shadow studies retain diagnostics without changing attempts, reviewed drafts or accounting.

[Verified run, 9 October 2026](evidence/20261009/README.md) retains the API, isolated-process and Luna browser receipts.

## Reproduce

Run these commands sequentially from the repository root with synthetic data:

```sh
bun apps/api/scripts/document-inspection/verify.ts
OPENERP_E2E_ARTIFACTS=test-results/document-intelligence/api bun run test:e2e apps/api/tests/document-reader.e2e.test.ts apps/api/tests/supplier-extraction.e2e.test.ts apps/api/tests/work-questions.e2e.test.ts
bun run setup:browser
PAPER_DOCUMENT_INTELLIGENCE=1 bun run test:browser tests/browser/document-intelligence.e2e.ts
bun run check:browser
bun run check:changed:full
bun run check:owners
```

The API launcher owns disposable PostgreSQL and API processes. The browser launcher owns a fresh native API, filesystem originals, web app and pinned local Codex proxy. It uses Luna for agent actions and a local synthetic reader response; it never invokes a live document provider. Reports, source inventories and workflow receipts are written under `test-results`. Session files, raw browser traces and startup logs must remain private.

## Queue regression contract

Before extending the real-process probe: eight simultaneous valid inspections must complete; the ninth must fail with `inspection_capacity`; after those jobs settle, a new inspection must complete. Two public extraction requests must both finish through the serialized native binding, and replay must preserve their attempts without another provider submission. A lost queue admission bound or leaked capacity must fail these checks.

## Accepted boundary

The supported inspector host is macOS with `sandbox-exec` and Node permissions. It receives retained bytes through stdin, inherits no environment, and denies unrelated file content/metadata, network, subprocess and addon access. Unsupported hosts and Workers without an inspector fail closed. Input is bounded to 5 MiB, 20 PDF pages or one PNG/JPEG image of at most 25 million pixels. The child has a 5-second deadline, a hard 128 MiB V8 old-space limit, bounded output and a sampled 256 MiB RSS threshold checked every 50 ms. The RSS threshold is not a kernel hard cap. Trusted helper bundling has a separate 10-second deadline. The queued native binding serializes inspection with at most eight admitted inspections; overflow is an explicit capacity refusal, and extraction can retry through its existing queue.

Quotes must match one retained physical page's transcript span. Supplied polygons must agree with independently inspected visible page dimensions, including crop and rotation, and must be finite, nonempty and within the page. Regions use scaled integers to preserve canonical receipts. The viewer shows only the selected region on its selected page and scales it with the original. Missing geometry is explicitly reported; provider geometry does not establish optical accuracy.

Low confidence retains evidence but withholds a selectable value. Missing, unsupported and unknown fields remain review work. Off/shadow studies bind request, attempt, source and current draft revision/digest through idempotent operator commands. They neither submit a document nor modify draft facts. Named malformed-evidence and resource-limit failures cannot silently fall back to a different reader or unsandboxed parser.

The [retained Paper component](../paper/document-intelligence/) supplies the source-selection baseline. Its pixel comparison covers the selected highlight SVG only, with a 24-channel tolerance and 1% changed-pixel gate. It does not qualify the full screen, PDF text rasterization, optical accuracy or broader recovery/performance acceptance.

## Remaining qualification

Live-provider/data policy, corpus coverage, per-attempt billable usage and measured cost remain outside this local synthetic result. SiftX ABI and isolation backends for other deployment hosts remain unverified. Broader document-screen baseline, parity and recovery obligations remain separate. Historical private planning records are not required to reproduce this public engineering check.
