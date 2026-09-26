# PAY-01 payroll fact foundation

## Current ownership

Application operations live in [application/payroll-foundation.ts](../src/application/payroll-foundation.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

The feature-local contract, HTTP handlers and payroll-only interface retain employee employment, work-input and opening-obligation facts. SQL migration `9050-employee-foundation.sql` establishes the append-only revisions and separate payroll grant; forward migration `9107-payroll-foundation-hardening.sql` adds the bounded employee directory, same-book evidence links and one current revision for each employee, kind and effective date. General book membership alone cannot list or capture payroll facts. A book administrator can grant or revoke payroll access for an existing member; access changes do not expose private facts through general book views. The SQL functions enforce scope and grant at the database boundary, including retries and history reads.

Each revision keeps its employee, kind, effective date, evidence reference, creator and optional predecessor. Evidence belongs to the same book. A correction must identify the current revision of the same employee, kind and date; stale corrections are rejected while earlier revisions remain unchanged. Client retries use the same command key; a changed request under that key is rejected. Opening balances remain exact minor-unit strings, not inferred from payroll history. Facts do not imply calculated pay, tax treatment, posted liability, payment or AGI/KU declaration.

The UI accepts typed JSON fact fields because supported employee details vary; the wire contract checks required fields for each kind, while SQL checks bounded payload size, predecessor identity and stable command semantics. No company-specific payroll rules, tax tables or provider connections are activated. This source implementation still needs a migrated isolated PostgreSQL database and a browser session with a book administrator plus separately granted payroll member for runtime proof. D-01, D-04, D-08 and D-10 remain deployment/legal gates; see `docs/open-decisions.md`.
