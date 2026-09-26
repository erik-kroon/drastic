# CRM-MASTER bounded directory

## Current ownership

Application operations live in [application/commerce/crm-master.ts](../src/application/commerce/crm-master.ts), with shared dispatch in [capabilities](../src/application/capabilities/). The maintained DDL is [0001-schema.sql](../migrations/0001-schema.sql), [0002-integrity.sql](../migrations/0002-integrity.sql) and [0003-roles.sql](../migrations/0003-roles.sql).

## Historical implementation notes

The notes below record the superseded SQL implementation and its original validation. Migration filenames and statement-map instructions here are historical references, not installation steps or current ownership. Use the [API layout and replacement status](../README.md) and [local setup](../../../docs/local-development.md) for the current application.

`9020-crm-master.sql` extends the existing synthetic commerce party register. It retains immutable book-scoped contacts, aliases, and manually supplied registry-provenance notes. Each annotation requires evidence already retained in the same book and records its actor and time. The directory filters by role, searches current party names, external keys, and alias labels, and pages by stable party ID. The existing party revision is the editable display name; prior revisions and issued-invoice snapshots stay unchanged.

This is not a registry verification service. `registry_provenance` records an operator assertion linked to evidence; it does not turn `legalIdentityVerified` true. The scoped HTTP directory read/export route exposes metadata only, bounded to 200 entries with a cursor; it does not expose evidence content, unrelated books or merge capacity. No provider request, merge, redirect, cross-book import/export, or legal-identity reconciliation is authorized by this migration. Provider credentials/configuration, applicable terms, source acceptance and a reviewed merge contract remain gates. Existing synthetic-profile restrictions on party creation still apply.
