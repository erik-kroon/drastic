# Recovery package acceptance and risk boundary

Written before the recovery package changes. These are operator acceptance cases, not tests or fixtures.

## Accepted result

A new versioned backup must bind one PostgreSQL snapshot to an explicit inline-evidence, supplementary-file, configuration-custody, release-file, migration and role inventory. Missing declared files, mismatched hashes, broken retained evidence links, unapplied/changed release migrations or unsupported database objects must stop completion. Restore must produce useful private stage diagnostics and a receipt only after reconstruction and quarantine checks. No code path enables an application or provider writer.

## Cases that must fail closed

1. A source targets the wrong host/cluster/database or an existing protected port; refuse before accounting content reads.
2. An expected configuration/key recovery procedure or release file is absent or altered; no complete backup manifest.
3. Inline evidence bytes do not match their digest, a relational evidence link is missing, or a JSON evidence reference resolves to a different/missing digest; no complete bundle.
4. A database object pointer is introduced without a reviewed local closure adapter; refuse, even if all ordinary table hashes match.
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
