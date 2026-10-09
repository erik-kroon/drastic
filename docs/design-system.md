# Design system

Page `00 Kanon: designsystem och kärnskärmar` in the Paper file is the visual source. Boards K-00 to K-06 hold the rules and components; K-08 to K-99 show them composed into real screens. `@open-erp/ui/kanon/*` implements that page, and `/kanon/list`, `/kanon/review` and `/kanon/focus` render reference compositions built only from it.

Build new screens from `kanon` parts. Do not add colours, sizes or layouts in route files; when a screen needs something the parts cannot express, change page 00 and `theme/kanon.stylex.ts` first, then the part.

## Pick a layout

| Screen | Layout | Example |
|---|---|---|
| Queue or register with a selected record | `ListDetailPage` | K-10 Att göra, K-40 Fakturor, K-70 Verifikationer |
| Decision against an original document | `ReviewPage` with `ReviewQueue`, `OriginalViewer` | K-11 Granska, K-21 Bankmatchning |
| Form, draft, overview or settings | `FocusPage` | K-41 Fakturautkast, K-08 Översikt |

Top bar: `AreaBar` (title, `BarTab`s with counts, one action) inside an area, `DetailBar` (breadcrumbs, optional pager) inside a record. The app sidebar stays `Workspace`.

## Pick a part

| Need | Part | Decided for you |
|---|---|---|
| Status of anything | `StatusIcon`, `StatusLabel` | Eight statuses only; colour and glyph follow the status |
| Rows of work | `WorkList`, `WorkGroup`, `WorkRow` | 40 or 52 px rows, fixed status, state and amount columns, count pill, edge to edge beside a panel, `carded` without one |
| The selected record | `DetailPanel`, `PanelSection` | 420 px; kicker, figure, subtitle, sections, then actions pinned to the bottom |
| Original file | `EvidenceFile` | File row with an `InlineAction` to open |
| Posting lines | `LedgerCard` | Separate debit and credit columns, empty cells stay empty, total row for posted vouchers |
| Key facts | `FactCard` | 110 px label column; `status` colours a value |
| Proof that two sources agree | `CompareCard` | Per-field verdict; a missing value never counts as a match |
| A confirmed or doubtful fact | `CheckRow` | Icon plus one sentence, under the card it checks |
| Something blocks the decision | `Banner` | `unknown` or `blocked`; title names the state, body says what to do |
| Who did what | `ActivityList` | Newest first; the agent is its own actor |
| Buttons | `Action`, `InlineAction` | Size follows kind; disabled only through `blockedBy`, which shows the reason |
| Irreversible or external step | `ConfirmDialog` | Repeats the facts; the confirm label names the effect and amount |
| Settings for what is on screen | `Drawer` | 400 px from the right, fixed footer |
| Feedback after an action | `Toaster` once at the root, `useNotify` | Bottom left, six seconds, at most one action |

Amounts arrive preformatted with `formatMinorAmount`; parts only align and use tabular figures. Wrap the app in `KanonCopyProvider` with the page locale; every other word is a prop.

## Rules

1. One primary action per view, named after its effect: "Godkänn och bokför 12 500,00".
2. The amount is the figure in the panel header.
3. Panel order: header, evidence, what will happen, checks, activity, actions at the bottom.
4. Every list row has a status icon.
5. Beside a detail panel, lists run edge to edge. Without one, they sit in a card no wider than 1000 px.
6. Colour means status: green done, amber needs you, red wrong or overdue, blue action. Never decoration.
7. A blocked action says why.
8. An unknown outcome is its own state. Offer "Kontrollera", never "Försök igen".
9. Preparing and approving are separate steps; say so in the `note` above the buttons.
10. Show the comparison, not a claim that it matches.
11. No explanatory paragraphs in the interface. Help belongs in a link or tooltip.
12. Tokens only. `no-hardcoded-design-values`, `no-raw-html-layout` and `no-design-system-escape-hatches` enforce this in `apps/web`.

## Verify

Run `bun run --cwd apps/web build`, then compare the screen at 1440 × 900 with its page 00 frame. Parity baselines for migrated screens belong in `verification/paper/parity-manifest.json`.
