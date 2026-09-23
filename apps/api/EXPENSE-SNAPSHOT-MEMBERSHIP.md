#5200 expense snapshot membership — pre-code failure contract

Extend the existing expense snapshot list only.0710 list summaries have no source membership;
4500 source history has no snapshot references. Snapshot history is not capped at500.

Failure contract:

- Preserve unfiltered query/cursor/output semantics by delegating to the existing0710
  three-argument list owner. Add an explicit four-argument overload, not a replacement artifact.
- Authorize scope and confirm the exact source identity belongs to that book. Withdrawn source
  identities stay readable; current basis, assessment, readiness and providers are not called.
- Freeze the current ordinal ceiling on the first filtered request. Filtered cursors bind
  scope, source and ceiling. Unfiltered/filtered mode switches and different-source reuse fail.
- Select/materialize at most25 global snapshot rows BEFORE examining entry membership. Advance
  by the last examined ordinal, even if zero returned entries match. Empty items with next are
  not absence/completeness proof. Expose ceiling, examined-through and examined-count metadata.
- Retain exact sourceId membership from saved v1/v2 entries, including excluded/withdrawn cases.
  Project captured revision/review/withdrawal identities and saved assessment, never command,
  approval or reviewer input payloads. Preserve absent v1 withdrawal metadata versus explicit
  v2 null. Refuse unsupported/malformed/duplicate membership rather than silently omit it.
- Enforce an8MiB complete canonical UTF-8 response bound. No count/byte truncation. Preserve
  historical snapshot bytes and existing original-key mutation recovery.
- No new artifact family, financial calculation, approval, posting, legal/currentness claim,
  UI expansion, tests, runtime/SQL execution or migration application.

Inspected0710: snapshots have immutable book ordinals, body.entries, schemaVersion1 and
expense-tax-controls-v1; each entry retains source, nullable review and assessment.4500 writes
schemaVersion2/expense-tax-controls-v2 and adds nullable withdrawal per entry. The existing HTTP
list route already forwards its query object through the existing read-only capability.
