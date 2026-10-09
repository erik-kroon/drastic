# Kanon parity ledger

Generated from [kanon-manifest.json](../../verification/paper/kanon-manifest.json). Candidate routes and owners need exact state review before implementation. Reference images are design captures; application proof is recorded separately.

| Board | Route / candidate | Candidate owner | Status | Reference |
|---|---|---|---|---|
| K-10 Att göra, kö | /entities/$entityId/books/$bookId/ | apps/web/src/components/company-work-sections.tsx, apps/web/src/components/work-home.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-10.png) |
| K-40 Fakturor | /entities/$entityId/books/$bookId/sales | apps/web/src/components/commerce/invoices.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-40.png) |
| K-09 Byråportfölj | /firms | apps/web/src/components/firms/portfolio.tsx, apps/web/src/components/firms/index.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-09.png) |
| K-11 Granska och godkänn | /entities/$entityId/books/$bookId/reviews/$planId/$revision | apps/web/src/components/review-owner.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-11.png) |
| K-70 Verifikationer | /entities/$entityId/books/$bookId/books | apps/web/src/components/voucher-workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-70.png) |
| K-80 Moms | /entities/$entityId/books/$bookId/tax | apps/web/src/components/vat-returns/panel.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-80.png) |
| K-99 Logga in | Mapping pending | Mapping pending | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-99.png) |
| K-41 Fakturautkast | /entities/$entityId/books/$bookId/sales | apps/web/src/components/commerce/invoice-drafts.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-41.png) |
| K-60 Uppladdning | /entities/$entityId/books/$bookId/purchases | apps/web/src/components/source-intake/workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-60.png) |
| K-08 Översikt | /entities/$entityId/books/$bookId/overview | apps/web/src/components/company-overview.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-08.png) |
| K-50 Betalfil | /entities/$entityId/books/$bookId/purchases | apps/web/src/components/settlements/review.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-50.png) |
| K-90 Bokslut | /entities/$entityId/books/$bookId/closing | apps/web/src/components/closing/workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-90.png) |
| K-95 Assistentpolicy | /entities/$entityId/books/$bookId/settings | Mapping pending | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-95.png) |
| K-12 Fråga klienten | Mapping pending | apps/web/src/components/work-questions.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-12.png) |
| K-13 Klienten svarar | Mapping pending | apps/web/src/components/work-questions.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-13.png) |
| K-14 Svar hos bokföraren | Mapping pending | apps/web/src/components/work-questions.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-14.png) |
| K-15 Okänt utfall | /entities/$entityId/books/$bookId/work | apps/web/src/components/posting-recovery/work-recovery.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-15.png) |
| K-16 Bokförd | /entities/$entityId/books/$bookId/books | apps/web/src/components/voucher-workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-16.png) |
| K-20 Bank, händelser | /entities/$entityId/books/$bookId/accounts | apps/web/src/components/banking-workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-20.png) |
| K-21 Bankmatchning | /entities/$entityId/books/$bookId/accounts | apps/web/src/components/bank-transaction-match.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-21.png) |
| K-30 Påminnelse, godkänn exakt innehåll | /entities/$entityId/books/$bookId/sales | apps/web/src/components/commerce/reminder-review.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-30.png) |
| K-31 Påminnelse, beloppet ändrades | /entities/$entityId/books/$bookId/sales | apps/web/src/components/commerce/reminder-retained-review.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-31.png) |
| K-32 Påminnelse, okänt utfall | /entities/$entityId/books/$bookId/sales | apps/web/src/components/commerce/reminder-message-workspace.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-32.png) |
| K-00 Så bygger du en skärm | Mapping pending | docs/design-system.md | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-00.png) |
| K-01 Tokens | /kanon/list | packages/ui/src/theme/kanon.stylex.ts, packages/ui/src/styles/globals.css | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-01.png) |
| K-02 Knappar och fält | /kanon/focus | packages/ui/src/kanon/action.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-02.png) |
| K-03 Listor och tabeller | /kanon/list | packages/ui/src/kanon/work-list.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-03.png) |
| K-04 Status och återkoppling | /kanon/review | packages/ui/src/kanon/status.tsx, packages/ui/src/kanon/feedback.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-04.png) |
| K-05 Dialoger och överlägg | /kanon/review | packages/ui/src/kanon/overlays.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-05.png) |
| K-06 Skal och detaljpanel | /kanon/list | packages/ui/src/kanon/layouts.tsx, packages/ui/src/kanon/detail-panel.tsx, packages/ui/src/kanon/workspace.tsx, packages/ui/src/components/workspace.tsx, apps/web/src/components/book-workspace.tsx, apps/web/src/components/book-navigation.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-06.png) |
| K-07 Diagram | /kanon/charts | packages/ui/src/kanon/charts.tsx | unverified | [PNG](../../verification/paper/baseline/kanon-2026-10-09/K-07.png) |
