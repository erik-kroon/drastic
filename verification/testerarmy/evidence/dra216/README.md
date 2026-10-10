# DRA-216 cash forecast and navigation

The shell Bank link now has a stored-book accessible name, while the source-recovery link remains exactly Bank. The global locator resolves once with the existing coverage destination at desktop and narrow widths. Audience hiding/restoration and supplier expiry, renewal and lost-response recovery pass; the supplier journey retains exactly one posting receipt.

The synthetic known opening is 100000 minor units, independently backed by a posted funding voucher, retained bank statement, reconciliation and explicit account eligibility. Both forecast charts render. Keyboard toggles expose all 30 independently expected rows and the waterfall values 100000/0/0/100000. Downloads and reload preserve the original bytes. The unknown opening retains null balances and withholds both charts after reload.

[Charts](charts.png), [tables](tables.png), [expected and observed native records](known-opening.json), and [verification provenance](verification.json) form the retained packet. Raw browser traces and session data remain ignored.

Repeat sequentially from this branch:

```sh
OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/cash-forecast.e2e.ts
OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/audience-profile.e2e.ts
PAPER_SUPPLIER_EXPIRY=1 OPENERP_E2E_WEB_MODE=built bun run test:browser tests/browser/posting-supplier-expiry.e2e.ts
```

Coverage is deliberately incomplete. This fixture has no scheduled inflows or outflows; it does not qualify nonzero scheduling or company completeness. The inconsistent immutable snapshot guard was inspected rather than exercised with fabricated records. Forecast result UI has no adopted board and remains unchanged. K-06 is explanatory: these are behavior receipts, not measured page 00 parity or production qualification.
