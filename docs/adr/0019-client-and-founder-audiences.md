# ADR 0019: Client and founder audiences on the shared ledger

Status: proposed, 2026-10-09. Awaiting owner acceptance. It narrows ADR 0006 and sequences work after ADR 0017; it claims no implementation, provider acceptance or commercial readiness.

## Context

ADR 0017 makes the accounting bureau the first commercial customer and Att göra the single queue for work needing a person. Business owners answer questions and approve payments. ADR 0006 chose one application with shared records and audience-specific starting views, but left the founder overview and the client entry point as plans.

The business decision register (drastic-hq D-02, 2026-10-07) keeps a founder/SMB product as a possible later product. Design exploration on 2026-10-09 (Paper pages 17 and 18, "Drastic för företag") showed that most owner-facing work is already a subset of the bureau loop: answering questions, sending receipts, approving payroll and supplier payments, and reading the company position. The remaining owner surfaces (time, dividends, integrations, assistant) are additive.

## Decision

Keep one application and one ledger. Add an explicit audience profile with three values:

- `bureau`: the current accountant navigation. Default for books reached through a firm portfolio.
- `client`: a bureau client's owner or staff. Sees Hem, Att göra, Inkorg, approvals and reports for books they are invited to. Distributed through the bureau.
- `founder`: an owner-operated company without a bureau. Same records and operations as `client`, with the remaining areas available. Activated only after a later owner decision.

The profile selects shell composition only: navigation groups, home destination, density, copy register and theme default. It grants no authority. Book roles, firm membership and approval binding (ADR 0002) remain the only sources of permission, and every write keeps its existing authority check.

Sequence the audiences behind ADR 0017:

1. Shared foundations that also serve the bureau product: the kanon parts, a dark theme, chart components and the audience profile.
2. The `client` audience after the document journey is accepted: a client user role, client navigation, a known-obligations read model for Hem, client answers to work questions, and client approvals of payroll, supplier payments and invoice dispatch.
3. The `founder` audience only after bureau design partners show weekly client use and the owner accepts a standalone plan.

## Alternatives considered

| Alternative | Benefit | Reason not selected |
| --- | --- | --- |
| A separate founder application | Freedom to diverge visually and commercially | Duplicates record presentation, recovery and authority behaviour; contradicts ADR 0006 |
| Founder product in parallel with the bureau wedge | Larger addressable market sooner | Competes with ADR 0017 for one team; self-serve acquisition and unattended statutory work carry more liability |
| Client access only through e-mail questions | No new role or shell | Owners cannot see position, approve exact actions or send evidence in context |

## Consequences

`BookContext` carries the audience profile and `book-navigation.tsx` filters by it. A client user role and invitations need backend contracts and persisted state before the `client` audience can be enabled for real users. Hem needs an authoritative known-obligations projection with declared coverage; it must not infer completeness or compute runway without an explicit method.

Owner-facing figures that depend on unqualified rules (3:12 dividend allowance, preliminary tax adjustments, corporate tax estimates) stay labelled as estimates until their rule sources are qualified under D-08. Connected execution remains gated under D-10.

## Sources and proof

Paper file "Enthusiastic lantern", pages 17 and 18; ADR 0002, 0006, 0017; drastic-hq D-02. Acceptance requires synthetic browser journeys per audience with retained artifacts: a `client` user answers a question, approves an exact payroll run and cannot reach accountant-only actions; switching profile never changes what a user may do.
