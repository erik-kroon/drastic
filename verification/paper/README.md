# Paper product implementation proof

Current onboarding desktop gate (2026-10-04): **U35–U46 pass 12/12 at the owner's interim 2.5% threshold**. [Report and diff images](onboarding-evidence/report.json), [delivery record](../../docs/plans/onboarding-paper-delivery.md), [native activation PDF](onboarding-evidence/onboarding-u45-activation.pdf). Older figures below are historical runs.

The manifest assigns separate disposable phases for received/pre-import sources, staged opening, posted verification, candidate delta, pre-final cutover and pending confirmations. The activated fixture owns U45/U46. Run `node verification/paper/parity.mjs <private-session-file>` with `PARITY_MANIFEST` naming a manifest containing the U35–U46 entries; linked private phase sessions must exist beneath that session directory. Do not use an empty or sparse book as evidence of full onboarding. The committed source seeding/handoff scripts retain actual source bytes and call native owners; credentials and private backups remain outside Git.


## 2026-10-04 measurement scope

The retained latest per-entry report is `test-results/paper/parity-2026-10-04-progress.json`: 27/27 below 5%, 13/27 below 2.5%, and 2/27 below 1%. These are separate disposable synthetic fixtures, not one combined runtime. The manifest has 27 checks over 26 distinct baseline frames; its sidebar check is a crop of M12. The 1% final gate and 24-channel tolerance are unchanged.

`parity-2026-10-04-final-onboarding/` retains all 15 onboarding captures and diffs. U34 measures 1.85%; U42 measures 1.23%. Compatibility now uses the eight product capability rows, with actual profile qualification and reviewed applicability kept visible. Its explicitly illustrative unsupported row appears only on the demo path. Missing native VAT/statement qualification remains missing; this is not proof of a qualified external handoff. Cutover distinguishes accepted limitations from a clean verification result, highlights the final-delta step, and leaves backup/final-delta failures visible. Its confirmation button remains disabled until every displayed gate passes.

The isolated acceptance fixture exercises real fact recording, independent review, synthetic posting-profile activation, retained zero controls, bank statement import, opening acceptance, a tax-statement limitation, and book-zero acceptance. It does not activate onboarding or accept a final delta without historical source effects. Repeat with a fresh launcher:

```sh
PAPER_ONBOARDING=1 node verification/paper/start.mjs
PAPER_READINESS=1 node verification/paper/seed-onboarding-controls.mjs <private-session.json>
PARITY_OUT=test-results/paper/parity-repeat node verification/paper/parity.mjs <private-session.json> U
```

Browser-session acceptance previously failed because the onboarding authority schema applied the accounting identifier grammar to Better Auth session IDs. The schema now retains a bounded opaque session ID; authorization still checks the real stored session. The retained seed receipt contains only redacted comparison and control identities.

Full changed-file checks ran; type checks passed, while type-aware lint remains blocked by concurrent banking, FX and payroll edits. The log is retained beside the onboarding report. T3 returned an explicit unavailable-host error during the final interaction pass, so no new T3 interaction proof is claimed.

The live Paper inventory is `paper-inventory-2026-10-04.json` in `test-results/paper/`: 337 artboards, including 328 product frames and nine system boards. `screen-coverage-audit-2026-10-04.json` retains the source route inventory and confirmed implementation gaps. Dialog/state frames do not each require a route. These inventories are distinct from measured parity and from a complete implementation audit.

Empty-book onboarding verification fixture obligations, before implementation: admit additional synthetic receivable, payable and VAT accounts only through the launcher's bootstrap; reject an invalid fixture flag before starting processes; use private loopback sessions and real source-retention/control/snapshot owners; independently specify all comparison amounts as zero in a fresh empty book; refuse existing onboarding cases or posted vouchers; reject every failed request and any nonzero comparison; retain redacted identities and snapshot blockers. Missing tax evidence remains missing. Capturing a blocked snapshot must not approve opening balances, bypass verification, activate the company, or assert an external outcome.

Onboarding profile fixture obligations, before implementation: use only the launcher's private local scratch database; refuse existing company facts rather than replace them; provision a separate synthetic preparer and use real local human sessions for fact recording and review; refuse any failed API read or write; preserve the rule that a person cannot review their own recorded fact; retain only redacted fact/source/review identities. Six supported company facts can be retained; a BAS chart release is not a supported company fact and must not be invented. This fixture does not activate a company, approve a posting, or assert any external outcome.

Profile decision display obligations, before implementation: show only the review attached to the currently applicable fact revision; resolve the reviewer's name from the lifecycle's scoped people read and keep an unknown person explicit; opening a decision must not create a new review or change the fact; Escape must close it and return focus to the invoking button. Accounting method and reporting framework use Paper's named-review and Visa beslut states when a confirmed review exists.

Parity reporting obligations, before this reporting change: a route/readiness failure remains a failed entry and must not stop later entries from being reported; missing images and wrong image sizes remain failures; the existing 24-channel pixel tolerance and 1% final gate remain unchanged; the 5%, 2.5% and 1% milestones use the measured ratio before display rounding. Captures keep their rendering conditions and actual/diff images.

Customer register projection obligations, recorded before implementation: use exact retained counterparty identities, never match names; exclude supplier invoices and drafts; retain separate currency and scale groups; never turn an unknown outstanding amount into zero; use the invoice owner's live amount after credit and cancellation; sum current-year issued invoices only; reject truncated invoice coverage rather than publish a partial total. The projection is read-only and must run inside the directory owner's scoped transaction. Verify independent synthetic amounts, selection, search and edit recovery through the real API and browser.

Customer invoice-entry obligations: pass the retained scoped customer to the existing draft editor; initialize only a new editor; isolate retained unsaved edits by customer; do not overwrite a restored editor's choices; preserve close, discard and save recovery; creating a draft must not issue or post an invoice. Keep the existing operator requirement.

Voucher-register obligations, before this implementation: use the book/entity-scoped retained voucher owner and validate each voucher's period against that book's setup (the voucher contract does not carry a separate scope); keep unknown currency scale unknown; show both debit and credit sides without netting them; preserve the loaded-page search boundary and cursor; retain search/period context when opening and returning from the full voucher; corrections must name the selected retained voucher and reach the existing correction-preparation owner, without changing the posted original. Verify selection and correction close/focus behavior without submitting a correction during layout verification.

To do supplier-preview fixture obligations, recorded before implementation: reject a non-local launcher session; read the named synthetic journal and reject another scope or missing retained evidence; use actual evidence, counterparty, supplier-draft and acceptance-preparation owners; fail on any HTTP error; retain created identities without credentials. Preparing a review must not approve, execute, register payment or assert a legal invoice. The UI must show the retained debit and credit lines, keep a stale review distinct, and open the existing review owner.

Compact original-preview obligations: retain a small synthetic text original through the source owner, reject failed retention, keep its exact filename and bytes, verify a 150px preview in Att göra and the full original through its existing owner. Retention is not an accounting review, approval or posting. No live extraction provider is used in this disposable runtime.

The screenshot's read-error boundary repair and To do proposal/geometry observations are recorded in [todo-error-observations.json](todo-error-observations.json). The disposable review runtime uses port 3001 to avoid interfering with the other agent's sales work. The receipt includes repeatable read-failure and retry steps. It establishes the listed browser behavior and dimensions, not whole-screen pixel parity; screenshot capture failed and the full changed-file gate still reports lint failures elsewhere in the shared checkout.

The active gap ledger is [adoption-gaps.md](adoption-gaps.md). The 2026-10-04 register/dialog observations are retained in [careful-pass-observations.json](careful-pass-observations.json), with source and screenshot hashes. These receipts establish their listed observations, not pixel parity or completion of the other states.

To repeat the added workflows on a fresh seeded runtime:

1. Open sales. Check 48px header, 224px sidebar, 340px preview and the selected draft's retained line/VAT amounts.
2. Open Articles → New article. Create code `paper_article`, unit `tim`, description `Konferensrådgivning · syntetisk`, price `1080`, tax description `Ej verifierad`, unresolved reviewed policy and active status. Close and assert `1 080,00 SEK` in the register. Reopen the row, Escape, and assert focus returns to that article button. Repeat the dialog at 390px and verify it stays within x10–380.
3. Open Quotes and orders → New quote. Choose Nordhamn's saved draft by customer/title, load the source and create. Assert `12 480,00` and draft status. Repeat for Sjöstrand and assert `32 500,00`. Open Sjöstrand, accept through Save decision, and assert accepted status and retained revision 2. Acceptance must not create an invoice or post accounting.
4. Open Recurring and wait for the real list read. With the default seed, assert the empty agreement state rather than indefinite loading.
5. Save screenshots and source hashes after these observations. Run `bun run check:changed:full`; consult the gap ledger before describing visual coverage.

## Current Paper adoption obligations

The 2026-10-03 continuation uses the live Enthusiastic lantern file, including its v2 component specification, rather than assuming the retained exports are current. Before changing shared controls and route composition: navigation must preserve its existing search and return context; selection must remain visible without relying on color alone; disabled controls must retain readable labels; dialogs must keep their close and focus-return behavior; remote reads, authorization and financial commands must remain with their existing owners; compact desktop controls must reflow at 390px and use larger touch targets. Browser receipts must distinguish observed layout and interaction from full pixel parity.

The reference is Enthusiastic lantern, pages 01–13. Exact exports and the frame inventory live in `docs/design/implementation/`. Product UI uses real application reads and commands; Paper examples are used only in the disposable synthetic fixture; product data always comes from retained application records.

## Failure cases

Before the isolated launcher was written, its failure obligations were:

- A missing PostgreSQL executable, migration failure or unavailable web port must fail startup and release owned processes.
- A configured local web port must be an integer from 1024 through 65535 before creating a scratch cluster; it must not replace an existing listener.
- The API must use a restricted runtime role, with independent local authentication credentials.
- No existing database, credentials, book or provider may be reused.
- An API or web startup error must remain visible; readiness must be checked through HTTP.
- Cancellation must stop the owned web process, Worker and disposable PostgreSQL cluster and remove its credentials.
- Browser verification must identify the viewport, locale, theme, fixture and source revision and retain screenshots and observations.
- Unknown or unsupported financial facts must remain unknown. Controls must reach their real owner and preserve authorization, refusal and recovery.
- A screen or operation without proof remains incomplete. A passing build does not establish pixel parity.

## Run

### 2026-10-04 parity checkpoint

Second 5% follow-up: latest per-frame evidence reaches 25/27 below 5%. U40 is 3.55% in `parity-2026-10-04-verification/`; U44 is 3.08% in `parity-2026-10-04-onboarding-controls/`. U34 remains 18.07% (`parity-2026-10-04-compatibility/`), U42 remains 15.81% with this fixture. Repeat with `PAPER_ONBOARDING=1 node verification/paper/start.mjs`, then `node verification/paper/seed-onboarding-controls.mjs <private-session-file>` on the fresh book. The fixture retains independent zero-balance CSV sources, six independently prepared/reviewed profile facts, a real two-person responsibility policy, and a blocked Book Zero snapshot. Its nine comparisons are checked against independently specified zero amounts. It does not accept opening balances, accept limitations, confirm activation, or run a live provider.

T3 observed seven 100px evidence-action lanes at x868 and the disabled verification button. The preview host disconnected during the subsequent click, so that navigation and the new confirmation close check were not observed in this follow-up. Existing parity harness captures remain valid pixel measurements.

5% priority follow-up: `test-results/paper/parity-2026-10-04-progress.json` combines the latest retained result per frame and names each contributing report. It is explicitly not a single combined-fixture run. The confirmed count is now 23/27 below 5%, with U34, U40, U42 and U44 still failing that stage. New receipts: `parity-2026-10-04-fixtures/` P1 2.40%; `parity-2026-10-04-vouchers/` Q1 2.48%; `parity-2026-10-04-customers/` M3 3.10%; `parity-2026-10-04-first-period/` U46 3.99%. U46 previously measured 5.33%; the horizontal banner, section spacing and primary Att göra link now match Paper geometry while unknown readiness stays unknown. T3 observed its 936×34 banner at x32/y156 and navigation to the real work route.

Repeat Q1 by running `node verification/paper/seed-voucher-reference.mjs <private-session-file>` in a fresh launcher before the harness. This uses the retained alternate voucher book and the synthetic operator's human session for approval and execution, preserving the approval policy. Repeat P1 with `node verification/paper/seed-documents.mjs <private-session-file>`. Use a fresh sales fixture for M3, rather than rerunning a partially failed seed that leaves duplicate counterpart identities.

The existing Playwright parity harness measures unscaled 1440×900 PNGs at device scale 1. T3 remains the interaction-check surface; its saved 1280×800 preview images are not pixel-measurement inputs. Pixel tolerance stays 24 per RGB channel. Reports record strict `<5%`, `<2.5%`, and `<1%` milestones, and keep failed routes as failed entries. `PARITY_OUT` retains independent measurement rounds.

Retained evidence:

- `test-results/paper/parity-2026-10-04-audit/`: all 27 manifest checks, 19 below 5%, 8 below 2.5%, 3 below 1%. Missing document/voucher fixtures and duplicate customer identities fail visibly.
- `test-results/paper/parity-2026-10-04-articles/`: M5 0.59%, down from 1.18%. Missing revenue-account ownership and sales tabs still prevent whole-screen completion.
- `test-results/paper/parity-2026-10-04-sales/`: fresh sales fixture, M1 1.86%, M3 3.10%, M12 initially 2.30%, M5 0.96% with this fixture's article values.
- `test-results/paper/parity-2026-10-04-orders/`: M12 1.64% after register-column changes. Titles remain titles; unsupported expiry is unknown. Document numbering, expiry and transition history are owner blockers.
- U33 in the audit is 2.67% with six independently prepared and reviewed facts. BAS release, source descriptions and designed review history remain incomplete.

Repeat sales measurements in a fresh launcher: `node verification/paper/seed-sales.mjs <private-session-file>`, then `PARITY_OUT=test-results/paper/parity-sales-repeat node verification/paper/parity.mjs <private-session-file> M`. The seed signs in as the launcher's synthetic human operator before review and execution; it preserves posting approval rather than executing with an agent token. It never uses a live provider.

For the profile fixture, first create the existing-company onboarding case through the product, then run `node verification/paper/seed-onboarding-profile.mjs <private-session-file>`. It refuses existing facts. Measure with `PARITY_OUT=test-results/paper/parity-profile-repeat node verification/paper/parity.mjs <private-session-file> U33`.

T3 observed order detail opening, Escape closing, focus returning to the invoking title and no page overflow at 1440px. Profile decision and article editor close/focus checks also passed. `bun run check:changed:full` passed at this checkpoint. These are partial implementation results; the final gate has not passed for all screens. Work is tracked in DRA-141, DRA-143 and DRA-144.

`node verification/paper/start.mjs` starts disposable PostgreSQL, the real API Worker and the web app on port 3000. It prints the preview URL and the private local session-file path. Use the T3 collaborative browser to sign in, drive the product, capture screenshots and inspect layout. The launcher installs cancellation cleanup, but terminal cancellation left PostgreSQL running in one observed run; verify the exact owned processes and stop the scratch cluster with its `pg_ctl -D <scratch>/pgdata -m fast -w stop` before removing that scratch directory if cleanup fails.

This launcher uses only synthetic data. It does not activate providers or deploy anything.

## Retained fixture seed failure cases

Before writing the seed, the required failures are: reject a non-local URL or a session outside the launcher scratch directory; stop on any HTTP error; use the real evidence, counterparty and draft owners; retain exact generated record identities for repeatable browser assertions; and never describe these draft examples as issued, sent or paid invoices. An incomplete seed must fail visibly and the launcher still owns cleanup.

Run `node verification/paper/seed.mjs <session-file>` against the private file printed by the launcher. It adds synthetic source-based drafts and a reviewable journal through the API. The receipt is saved under `test-results/paper/seed.json` without credentials.

## Currency-scale regression obligations

The real seeded register exposed numeric JSON scale `2` becoming scale `0`. Before changing that projection, the failure cases are: numeric zero remains valid; numeric two formats minor units as hundredths; retained string scales remain compatible; negative, fractional, greater-than-six and nonnumeric scales must not silently become zero. Verify the seeded API scale and independently expected browser amounts (`3250000` → `32 500,00`, `1248000` → `12 480,00`).

## Repeat the observed product path

`observed-receipt.json` records source hashes and observed outcomes, including limits. To repeat: launch a fresh disposable runtime, seed it, sign in, open the sales register, select each retained draft and check the expected amounts, open and close a draft with Escape, then use Ctrl K to find Nordhamn. Open the synthetic journal from Att göra, confirm approval is disabled, review and approve, confirm execution requires review again, then review and post. Check voucher 1's receipt and absence of posting controls. Repeat the register, search and focused review at 390×844. These observations establish operation behavior, not whole-screen Paper parity.

## Supplier fixture obligations

Before extending the fixture: require the initial synthetic journal's retained execution receipt; derive its voucher, credit line, account, amount and evidence through retained API reads; reject a missing receipt or source; use only the real supplier counterparty, invoice registration and supplier draft owners; preserve source values and separate the saved draft from the registered invoice; retain generated identifiers in a redacted receipt. This fixture must not approve or post additional financial work, call a bank or assert payment.

After posting the initial journal, run `node verification/paper/seed-purchases.mjs <session-file>`. Its receipt is `test-results/paper/purchases-seed.json`. Open Inköp and verify 185000 minor units render as 1 850,00, the selected preview opens the retained invoice, and the register stays within 390px. Switch to retained drafts to inspect the separate source draft through its owner. The initial observed invoice editor revision proof used the retained Nordhamn draft: edit title and reason, verify the live preview, save, and verify revision 2 and grossMinor 1248000 through the API.

Bank layout verification obligations (written before this slice): selecting an account must retain its exact date scope; unmatched, matched, all and ledger filters must retain server counts and paging; a statement row must open the existing matching owner and a ledger row its retained voucher; no missing statement balance may become zero; a nonzero allocation must not be called paid; narrow layouts must retain date controls without horizontal page overflow. The Paper missing-evidence groups cannot be inferred from unmatched allocation, so the UI must name the retained matching state instead.

Document archive verification obligations (before this slice): the archive must retain exact filename/source/date filtering, page cursors and export intent; opening and returning from a document must preserve the applied filters and restore keyboard focus; uploaded originals must use the existing source retention owner and remain inspectable; PDF/image/CSV MIME types must not be called accounting classifications; the archive list must not invent a linked voucher; export applies to the retained page scope rather than claiming a complete archive. Row and toolbar changes must remain readable at narrow widths.


## Current live design pass

`current-design-observations.json` records this pass against live Paper's v2 foundation and current register, report, settings, closing and overview frames. Source hashes and screenshot hashes bind the observations to this checkout; screenshots are retained in `screenshots/`. These are browser E2E observations, not whole-screen pixel parity.

Repeat with a fresh launcher and seed, using the native T3 browser at 1440×900 and 390×844 in Swedish light mode:

1. Open sales → customers, select Sjöstrand, open New customer and press Escape. Assert the same record stays selected and focus returns to New customer.
2. Search for Sjöstrand and submit. Assert one directory row. Clear and submit to restore the directory.
3. Open purchases → suppliers. Create Tallvik Material AB, supplier role, reference `paper_supplier_e2e`. Assert the modal closes, the new row is selected and the preview shows the saved supplier role/reference. Invoke directory export; inspect its downloaded manifest separately if asserting content.
4. Open closing. Assert the synthetic period dates, 10 / 14 passed checks and four pending rows. Open period scope review, inspect the existing form, close it, open Prepare period lock and assert the incomplete-readiness block remains. Do not submit financial commands for this layout proof.
5. Open reports. Assert nine report destinations remain reachable; inspect the plain catalog and compact inline navigation.
6. Open settings → accounting. Assert dimension forms, period dates and the chart-of-accounts link remain available.
7. Open overview. Assert existing financial facts and draft actions, with deadline/rule forms inside collapsed sections. No Paper chart examples may appear as live financial facts.
8. At 390px, compare `document.documentElement.scrollWidth` with `innerWidth` on these pages and sales, purchases, documents, bookkeeping, bank and tax. Wait for each owner's read before claiming data-state proof; loading-state checks establish layout only.
9. Run `bun run check:changed:full`. Compare the retained source hashes before reusing any previous screenshot result.

PDF thumbnail obligations (before implementation): render only checksum-validated retained bytes; a broken or unsupported PDF must show an explicit error and keep the original owner reachable; switching records must cancel the previous render and never show its page under another filename; render the first page as a preview and retain full original/download access; rendering must not extract financial facts or claim a review; the gate must wait for thumbnail completion rather than measuring its loading canvas. Reuse the repository's existing PDF.js release if the browser's native PDF embed cannot render in the verification surface.

Mixed-register fixture obligations (before implementation): use only the launcher scratch database for chart-account setup; create each synthetic posting through prepare, approval and execution owners; derive supplier control lines and amounts from the returned voucher before registering invoices; reject a missing or mismatched source; retain identifiers and independent expected amounts in a receipt; never create payment allocations or call a provider. This is synthetic fixture creation, separate from the browser layout pass, which must not submit financial commands.

Bookkeeping reference-fixture obligations (before implementation): provision a separate synthetic book through the existing explicit provisioning script in the same private scratch runtime; grant the current synthetic browser operator access only in that fixture; post six balanced examples through the real accounting owners; retain actual voucher numbers rather than forcing Paper's historic counters; the transfer example must not assert invoice settlement without a retained invoice; the gate must identify the fixture book in its report; it must not truncate production rows or change the pixel threshold to compensate for mixed fixture content.

### Parity manifest admission

A missing, nonnumeric, nonfinite, negative, or above-255 pixel tolerance must refuse comparison. Without that admission, JavaScript compares channel deltas against `undefined` and falsely counts zero changed pixels. A manifest without a positive integer viewport or a finite diff bound between zero and one must also fail before browser launch. Custom manifests retain the same pixel tolerance as the baseline manifest; omission cannot establish parity.
