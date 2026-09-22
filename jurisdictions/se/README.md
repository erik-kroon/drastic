# Swedish accounting calculations

`@open-erp/jurisdiction-se/vat` exports `calculateVatDraft`; `@open-erp/jurisdiction-se/sie` exports `renderSie`. Both take retained values and return deterministic values or the existing domain error. Neither opens a database connection, starts an Effect runtime nor accesses a provider.

The package uses type-only imports from `@open-erp/contracts` for the current captured inputs and results, and the runtime error class from `@open-erp/domain`. API workflows own capture, authorization, hashing, sealing and delivery. Wire schemas remain in the contracts package to preserve existing consumers and avoid a package cycle.

The VAT calculation remains a synthetic draft with legal profile and filing readiness disabled. The SIE encoder remains a bounded synthetic SIE 4I transaction export with CP437 bytes. This extraction adds no BAS release, general SIE importer, full-book export, payroll or statutory support. Generator identities and calculation behavior remain unchanged.
