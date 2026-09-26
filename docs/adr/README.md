# Architecture decision records

The status describes a decision's authority, not implementation progress. “Established” means the current repository settles it. “Working decision” means the product design selects it; it remains revisable. Unresolved prerequisites live in [open decisions](../open-decisions.md).

| ADR                                                      | Status                          | Decision                                                                                                     |
| -------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [0001](0001-checkout-runtime-and-accounting-boundary.md) | Established repository baseline | Preserve the existing stack, ownership and transport foundation.                                             |
| [0002](0002-exact-posting-and-approval.md)               | Working decision                | Exact PostgreSQL posting, immutable approval and group receipts.                                             |
| [0003](0003-native-accounting-and-migration.md)          | Working decision                | Native accounting with explicit company migration and one writer.                                            |
| [0004](0004-complete-accounting-delivery-contract.md)    | Working decision                | Seven-area delivery contract, compatible exact values, domain/SQL ownership and fenced cutover.              |
| [0005](0005-open-accounting-and-managed-services.md)     | Accepted product direction      | Open accounting and agent/jurisdiction layers, AGPL-3.0-only, optional managed operations and deferred Rust. |
| [0006](0006-customer-workspaces.md)                      | Working decision                | One customer application with shared records, task-based navigation and audience-specific starting views.    |
| [0007](0007-domain-and-jurisdiction-layout.md)           | Accepted repository structure   | Separate accounting models, Swedish calculations, application workflows and runtime/transport adapters.      |
| [0008](0008-financial-fx-vat-impairment.md) | Adopted working design | Commerce-owned paired FX balances, distinct VAT operations and atomic impairment/schedule effects. |
| [0009](0009-effect-mq-background-jobs.md) | Accepted design; implementation pending | effect-mq PostgreSQL jobs on a persistent Bun worker, dispatched through the application outbox. |
| [0010](0010-application-owned-accounting-replacement.md) | Accepted replacement decision; implementation pending | Application-owned accounting, clean three-file baseline, no compatibility path, narrow SQL integrity and full caller cutover. |
| [0011](0011-reference-parity-backlog.md) | Accepted planning decision | Reference-parity findings stay supplemental to the mandated index, and every adopted rule is classified adopt/structure-only/re-derive before implementation. |
| [0012](0012-next-implementation-dossier.md) | Accepted planning decision | Externally produced NEXT-01…50 dossiers are vendored byte-identical under `docs/specs`, and `NEXT-nn` stays a supplemental work namespace outside the mandated index. |

The separately authored [Swedish VAT profile boundary](0002-swedish-vat-profile-boundary.md) also uses the number 0002 in its filename. Refer to it by title and full filename to distinguish it from the posting ADR. It records a bounded research profile and source limitations; it does not activate statutory support.

Create an ADR when an unresolved choice materially changes invariants, ownership, public contracts or operations. Do not create one for every class or library call. Record context, choice, alternatives, consequences, source evidence and the proof that would validate the choice.
