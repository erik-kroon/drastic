# Paper product implementation proof

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
