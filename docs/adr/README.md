# Architecture decision records

The status describes a decision's authority, not implementation progress. “Established” means the current repository settles it. “Working decision” means the product design selects it; it remains revisable. Unresolved prerequisites live in open decisions.

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
| [0013](0013-reference-derived-defects.md) | Accepted planning decision | Reference-derived defects are fixed by forward migration or forward packet; the reviewed three-file baseline is never edited. |
| [0014](0014-retro-payroll-open-period-adjustments.md) | Working decision | Linked payroll adjustments post in open periods; original payroll attribution and declaration corrections remain separate. |
| [0012](0012-next-implementation-dossier.md) | Accepted planning decision; amended 2026-09-28 for the third, fourth and fifth waves | Externally produced NEXT dossiers are vendored byte-identical under `docs/specs`, and `NEXT-nn` stays a supplemental work namespace outside the mandated index. |
| [0015](0015-owner-delegated-decision-pass.md) | Accepted decision, 2026-09-28 | Owner-delegated decision pass: owner-operated private release with an owner-acceptance engineering gate, a bounded standing test permission, local-first operating mode, external reference as a pinned non-authoritative reference, and dispositions for 23 product-scope capabilities. |
| [0016](0016-pdfcn-legal-documents.md) | Accepted owner decision, 2026-09-30 | Adapt pinned pdfcn source for legal invoices and credit notes, with exact retained amounts, actual pagination and direct replacement of synthetic legal templates. |

| [0017](0017-bureau-first-product-focus.md) | Accepted product direction, 2026-10-03 | Bureau-first accounting wedge, canonical human tasks, bounded bulk approval and qualified connected execution; native payroll and Cash sequenced later, automatic posting not adopted. |
| [0019](0019-client-and-founder-audiences.md) | Proposed, 2026-10-09 | One ledger with a `bureau`, `client` and `founder` audience profile that selects shell composition only; client audience after the document journey, founder audience after an owner decision. |
| [0020](0020-authorization-basis-presence-and-mandates.md) | Proposed, 2026-10-10 | One gesture table owns the authentication basis; per-book presence proof for payment, signature, filing and mandate grant; bounded standing supplier-acceptance mandates (PST-05) behind a per-book policy. |

The separately authored [Swedish VAT profile boundary](0002-swedish-vat-profile-boundary.md) also uses the number 0002 in its filename. Refer to it by title and full filename to distinguish it from the posting ADR. It records a bounded research profile and source limitations; it does not activate statutory support.

Create an ADR when an unresolved choice materially changes invariants, ownership, public contracts or operations. Do not create one for every class or library call. Record context, choice, alternatives, consequences, source evidence and the proof that would validate the choice.

[0018](0018-public-product-repository.md) records the accepted ownership decision. Product development belongs to public Drastic, private company material belongs to drastic-hq, and openERP is a read-only archive.

Historical planning links and captures omitted from this source distribution remain in the private working archive.
