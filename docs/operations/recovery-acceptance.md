# Recovery package acceptance and risk boundary

Written before the recovery package changes. These are operator acceptance cases, not tests or fixtures.

## Accepted result

A new versioned backup must bind one PostgreSQL snapshot to explicit database, object, evidence, receipt, supplementary-file, configuration-custody, release-file, migration, role and durable-work inventories. Missing declared files, mismatched hashes, broken retained evidence/object references, unapplied/changed release migrations or unsupported database/object types must stop completion. Restore must produce useful private stage diagnostics and a receipt only after reconstruction and quarantine checks. `inspect` must emit a machine-readable result that distinguishes complete closure from a legacy bundle. No code path enables an application or provider writer.

## Cases that must fail closed

1. A source targets the wrong host/cluster/database or an existing protected port; refuse before accounting content reads.
2. An expected configuration/key recovery procedure or release file is absent or altered; no complete backup manifest.
3. Inline evidence bytes do not match their digest, a relational evidence link is missing, or a committed JSON evidence reference resolves to a different/missing digest; no complete bundle. The exact saved-intent exception is specified below.
4. A database object pointer is introduced without a reviewed local closure adapter, an unsupported object type is present, or a referenced object/evidence/receipt is missing; refuse, even if all ordinary table hashes match.
5. A sequence, unsupported extension, foreign/materialized/unlogged relation, subscription/publication, disabled constraint or unreviewed relation kind exists; refuse instead of claiming complete reconstruction.
6. A source release file changes during capture, or an applied migration is absent/different in the pinned release; refuse completion.
7. Destination roles differ in privilege flags/membership, or required schema/database characteristics differ; refuse before new database creation where possible.
8. A restore command fails, is interrupted, or table/control/file verification fails; retain private stage diagnostics and leave destination fenced. No success receipt.
9. Quarantine cannot be confirmed after a connection loss; record `not-confirmed`, never `disabled` or a successful restore.
10. A database restore succeeds but runtime-role/Beter Auth reads have not run; application recovery stays blocked. Session refresh, rate-limit writes and `FOR SHARE` admission must not be bypassed for a probe.
11. A stale checksum or a file under a symlink/hardlink is supplied; refuse. A local checksum is not authenticity, encryption, decryption-key recovery or compliant retention.
12. Pending approvals/outbox work or historical auth sessions survive reconstruction; retain them but never reactivate delivery or browser admission.

## Verification handoff

Root owns type/lint validation and all authorized native observations. This worker will not start processes, connect to either database, run backup/restore, add tests/fixtures, or change immutable migrations. The runbook must distinguish implemented checks from observed runtime evidence and leave company completeness, archive compliance and operational authority unresolved.

## Saved posting intent evidence closure — failure contract before implementation

Saved `prepare_journal` commands may retain syntactically valid missing or foreign-book
`evidenceId` input before execution, or after a terminal refusal. Such input is retained intent,
not a committed evidence link. Recovery must preserve it without inventing evidence or refusing
an otherwise valid snapshot solely for that missing input target.

- Exempt only JSON evidence-link validation inside the exact
  `openerp.posting_saved_requests.command` column, and only when its same-book/key outcome is
  absent or refused AND no same-book `command_receipts.key = command_key` exists.
- An absent outcome does not prove nonexecution.0310 permits an exact original kernel call using
  the reserved command key. Its committed command receipt requires strict evidence closure
  even before the saved-request outcome is recorded.
- A committed outcome, any other outcome state or any receipt at the scoped reserved command
  key keeps strict closure. A malformed/mismatched receipt cannot create an exemption.
- Keep strict closure for all other JSON columns/owners and relational evidence links, including
  committed plans, events, receipts and saved outcome results. Missing or mismatched actual
  evidence still refuses. A similarly named column in another schema/table is not exempt.
- Inspect every JSON object for unsupported external pointers, including pending/refused intent.
  Count all syntactic evidence-reference objects exactly as before, regardless of exemption.
- Preserve raw commands, outcomes, table hashes, dumps and durable-work inventory bytes. Do not
  run, resume, repair, rewrite or delete any saved request. Valid historical v2 control counts
  remain comparable; no new artifact/schema/version or quarantine change is needed.

Pending authorized cases: pending missing/foreign evidence; refused MissingEvidence; pending or
refused valid evidence with unchanged counts; committed outcome missing evidence; no outcome
plus reserved-key receipt missing evidence; another JSON/relational owner missing evidence;
external pointers inside exempt intent; exact reconstruction of all raw history; and unchanged
quarantine/no-resume gates. These are source-review cases, not tests or runtime evidence.
