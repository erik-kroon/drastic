# Decision model adapter (AUT-10 / DRA-228)

The independent failure matrix is `docs/operations/automation-adapter-failure-cases.md`, committed before implementation. Two workflows were authored before adapter code: a real loopback HTTP fixture and an explicitly authored Workers AI binding fixture. The existing public document-reader failure journey verifies the extracted bounded JSON reader without changing its owner behavior.

`DecisionModel.decide` accepts an admitted SystemOne request and optional caller abort signal. It returns a full validated distribution/statistics as an unreviewed claim, or a typed diagnostic. It never retries, posts, persists a result or grants authority. The deadline covers waiting for HTTP headers and body, and binding inference; caller abort is distinct from timeout. A binding deadline stops waiting and does not prove remote inference cancellation.

The shared HTTP reader caps response bytes at 1 MiB, rejects invalid UTF-8 and duplicate keys before JSON.parse, and decodes JSON at the boundary. Azure retains its existing output-error mapping. Binding output is already an object: bounded serialization and the same domain validator apply, but raw upstream duplicate-key inspection cannot be claimed. Provider error bodies, prompts and credentials are omitted from diagnostics/artifacts.

Configuration is explicitly disabled by default. Credentials alone do not enable a model. Enabled modes require `OPENERP_DECISION_MODEL_RELEASE`; identities retain configured release, requested model, expected reported model and validated reported model separately. Every result currently has `releaseQualification: "unsubstantiated"`. Naming a configured release cannot attest immutable weights, including for hosted Clef selectors. Live trials and release qualification remain AUT-13 gates.

| Mode | Required configuration |
| --- | --- |
| `local-systemone-fixture` | HTTP endpoint on `127.0.0.1`; no live credential is used |
| `typesafe-jev` | HTTPS endpoint (defaults to the official SystemOne URL) and key |
| `self-hosted-clef` | Explicit HTTPS SystemOne endpoint and key |
| `workers-ai-clef` | Explicit injected AI binding; selector `clef-flash` (default) or `clef` |

Optional `OPENERP_DECISION_MODEL_SELECTOR` sets the request model; HTTP defaults to the configured release. Optional `OPENERP_DECISION_MODEL_REPORTED_MODEL` sets the exact expected response identity, defaulting to the requested model. `OPENERP_DECISION_MODEL_TIMEOUT_MS` defaults to 15000 and must be an integer from 1–60000. Endpoints cannot contain credentials, query parameters or fragments.

Bun self-host and the preparation runner inject the configured HTTP model. Their environment has no Workers AI binding, so explicitly selecting that mode refuses startup. The Cloudflare entry accepts optional typed `AI`/`DECISION_MODEL` ports and injects the configured model. Wrangler has no live AI binding declaration in this change; an authorized deployment must separately declare that binding. No deployment, remote call, model download or new business endpoint was performed.

Repeat the focused verification:

```sh
OPENERP_E2E_ARTIFACTS=test-results/dra228-focused bun run test:e2e \
  apps/api/tests/decision-model.e2e.test.ts \
  apps/api/tests/document-reader.e2e.test.ts \
  -t 'decision adapter configuration|authored Workers AI binding|ambiguous JSON and provider failures'
```

The retained run passed three selected workflows (16 unrelated journeys unselected). Artifacts include `decision-model-http.json`, `decision-model-binding.json`, `results.json`, `junit.xml` and `source-integrity.json`. They retain 11 HTTP outcomes with one call each, caller abort before dispatch with zero calls and during body read with one call, nine refused configurations with no calls, and five authored binding calls including its timeout. Source remained stable with SHA-256 `3d4765067b96742f090d523965e3d28a48c947572ddfb63be0f19107d0a4d6bd`.

Protocol source: [TypeSafe SystemOne API](https://docs.typesafe.ai/api). Binding selector/input shape: [official Clef-flash documentation](https://developers.cloudflare.com/workers-ai/models/clef-flash/), checked 2026-10-10. Fixture results are not live Cloudflare or TypeSafe qualification. Queue dispatch fencing, retry ownership, budgets, stored requests/results and transaction guards belong to AUT-11. No MCP schema/catalog or UI changes were introduced.
