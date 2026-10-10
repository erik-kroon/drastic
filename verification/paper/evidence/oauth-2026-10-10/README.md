# Adopted OAuth targets and actual-route proof

Erik Kroon adopted O-01 and O-02 in the session on 10 October 2026. Baselines are direct exports of those accepted Paper nodes, captured after acceptance. Earlier candidate captures predate acceptance and remain historical. No application screenshot was used as a baseline. Channel tolerance 16 and maximum difference 2% are unchanged.

Real synthetic browser flow: `bun run test:browser tests/browser/oauth-consent.e2e.ts`. Passing run: `d3c6f9e4-9853-4b66-9243-1a0fadeb61cd`. The runner uses disposable PostgreSQL, the native application API, the real OAuth provider and Chromium. It uses deterministic actions and assertions, with no Luna agent step. Browser-source-integrity records unchanged exact input inventory during execution; the final run used committed source d2d2d4531dc5e4d59f90cd68dbc899eb26601bed after integration with current main. This is not an independently provisioned clean-checkout claim.

Backend: `OPENERP_E2E_ARTIFACTS=test-results/finish-current-main bun run test:e2e apps/api/tests/oauth-mcp.e2e.test.ts`. The retained API receipt's pending browser obligation was resolved separately by browser-flow.json; the API receipt is preserved unchanged.

Repeat comparison with `node verification/paper/compare.mjs O-01 verification/paper/evidence/oauth-2026-10-10/O-01/capture.json verification/paper/evidence/oauth-2026-10-10/O-01` and the equivalent O-02 command. The comparator refuses changed source, baseline bytes or viewport. Both pass: O-01 0.539%, O-02 0.704%.

Screenshots and redacted observations are public. Session cookies, OAuth tokens, codes, verifiers, signed queries, raw traces and videos stay in ignored local artifacts. These receipts qualify the adopted light states and stated synthetic behavior. They do not qualify production OAuth onboarding, live clients, dark mode, native zoom or a grant-management screen.
