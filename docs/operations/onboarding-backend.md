# Onboarding backend

## Failure contracts before implementation

The coordinator persists customer onboarding intent and composes retained owners;
it does not accept financial amounts, verified facts or completed gates from a
client. Its HTTP commands must satisfy these contracts:

- Current scoped admission refuses anonymous, cross-book and agent mutations.
- One case per book; exact command replay returns the original revision, while a
  reused key with changed input refuses. Concurrent configuration saves use an
  expected revision so one winner cannot overwrite another.
- Configuration and receipt inserts share one transaction; rejected commands do
  not change case history, ledger, writer authority or counters.
- Dates distinguish retained history, detailed history, opening boundary,
  acceptance period, candidate live date and proving-period end. Unknown dates
  stay null. Impossible ordering refuses; no company-specific dates default.
- A source link names an already-retained book-scoped occurrence. Filenames,
  hashes and lengths come from that owner, never the request. Cross-book links
  refuse; retries cannot duplicate a link. Presence does not prove coverage.
- Qualification reuses reviewed facts and rule/activation witnesses. Saved setup
  fields and synthetic witnesses cannot qualify actual-company onboarding.
- Reporting framework, base currency and payroll/asset/foreign-currency
  applicability are independently evidenced facts. Recording K3 or EUR cannot
  substitute K2 or SEK; recording employer registration cannot settle payroll
  applicability. New fact kinds do not advertise a new supported treatment.
- Workstream reads derive source/import progress from retained rows. Parsed or
  staged imports do not establish reconciled books. Payroll is commercially
  deferred and cannot become native-supported through onboarding configuration.
- Missing opening, independent controls, operational proof and single-writer
  evidence keep cutover blocked. A recorded candidate date is not go-live.
- Immutable case revisions and source-link records survive return/retry; live
  workspace status is recomputed rather than cached as an obsolete percentage.

Public E2E fixtures remain synthetic and retain a sanitized repeatable journey.
No actual company or external provider is exercised.

## Frontend integration

All routes are authenticated and book-scoped below
`/api/v1/entities/:entityId/books/:bookId`. Use the shared schemas in
`packages/contracts/src/onboarding.ts`; mutations require an idempotency key and
human operator admission.

| Route | Result |
| --- | --- |
| `POST /onboarding` | Start one immutable-path case: new company, existing company, bureau or demo |
| `GET /onboarding` | Current revision, dated qualification, source inventory, import progress and blockers |
| `POST /onboarding/revisions` | Save configuration with `expectedRevision`; stale saves conflict |
| `GET /onboarding/revisions` | Retained configuration history, paged by `before` revision |
| `POST /onboarding/sources` | Link a retained occurrence ID and category; metadata comes from intake |
| `GET /company-facts` | Immutable facts with their retained reviews, paged by `after` ID |
| `POST /onboarding/controls` | Qualify independent controls from retained source bytes |
| `POST /onboarding/responsibilities` | Retain capability responsibility policies |
| `POST /onboarding/snapshots` | Capture a review bound to current dependencies |
| `POST /onboarding/decisions` | Record acceptance or refusal for an exact snapshot |
| `POST /onboarding/activation-intents` | Request activation against an accepted snapshot |
| `POST /onboarding/first-period-completions` | Retain completion against a current closing certificate |
| `GET /onboarding/lifecycle` | Current controls, responsibilities, decisions and activation state |
| `GET /onboarding/activation-artifact` | Retained activation and first-period receipts |

Workspace source/import pages use `sourceAfter` and `importAfter`. A page is not
complete coverage: use the returned cursors and distinguish the inventory count
from the rows displayed. Import progress exposes synthetic versus reviewed SIE
sources; synthetic staging cannot establish actual-company acceptance.

Existing company-fact recording/review, rule release activation, source intake
and SIE preview/plan/run endpoints remain their owning workflows. The coordinator
does not create a second importer or ledger. Recording a fact is distinct from
reviewing it, and confirming an unknown value does not make that value known.
Qualification describes only the existing dated profile witness, not end-to-end
commercial readiness. Actual-company support also requires explicit rule-release
currency coverage, and statement support requires explicit reporting framework
coverage. Native payroll remains deferred.

## Lifecycle implementation contract

Onboarding remains a coordinator around the existing accounting owners. The
lifecycle adds retained control qualification, review snapshots, responsibility
policies, acceptance decisions, activation intents, operational proof and durable
receipts. The HTTP/database E2E workflows exercise these retained owners with
synthetic data. Actual-company acceptance and production qualification remain
separate from this implementation.

Independent comparisons read retained source bytes and retained accounting
records inside the owning transaction. A request names sources and reviewers;
it never supplies a booked amount or a completed gate. Each review is tied to
its exact dependencies and date boundary. A later affected import, changed
profile or revoked reviewer invalidates the effective acceptance without erasing
its historical decision.

The operational executor is a separate maintenance boundary. Ordinary browser
credentials cannot insert operational proof or promote writer authority. Local
synthetic restore and writer-fence evidence does not establish a production
provider outcome or authorize Drastic's cutover.

Setup is the persistent workspace. Inventory, parsing, import, reconciliation
and acceptance remain distinct, and first-live-period completion requires a
current closing certificate rather than a setup checkbox.

## Qualification limits

The implementation retains independent controls, responsibility policies, exact
review snapshots, acceptance decisions and final-delta reviews. Activation
requires a current snapshot, named confirmations and retained operational proof.
The maintenance executor supports isolated synthetic local systems only.
Activation and first-period receipts retain `statutoryReady: false`.
First-period completion requires a current closing certificate.

The workspace currently reports `cutover.ready: false`; authority becomes
`native` after a retained activation receipt. A candidate date remains intent.
These mechanisms do not establish actual-company acceptance or production
qualification, and a client flag cannot complete a retained gate.

A complete historical scope requires history bounds as well as opening,
acceptance and candidate dates, plus detailed-history start unless opening-only.
The company's reviewed fiscal-year facts and private source material must supply
these values. None is derived from the example dates or defaults.

## Focused verification

Run the HTTP/database E2E journey with disposable synthetic data:

```sh
OPENERP_E2E_ARTIFACTS=test-results/onboarding-backend bun run test:e2e apps/api/tests/onboarding.e2e.test.ts apps/api/tests/onboarding-lifecycle.e2e.test.ts apps/api/tests/onboarding-mappings.e2e.test.ts apps/api/tests/onboarding-deltas.e2e.test.ts apps/api/tests/company-profile-admission.e2e.test.ts
```

The run retains its environment/source manifest and sanitized journeys. It is
engineering evidence, not Drastic acceptance or production migration evidence.
