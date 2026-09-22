# 0890 owner/correction impact integration

Root reserved `0890-owner-correction-impact.sql` for this correction-domain fix. It requires0410 and0610 and replaces only the private impact-resource reader, while adding one private owner-resource helper. Both explicitly revoke PUBLIC/runtime EXECUTE and use protected search paths. No shared dispatcher, authentication, route, capability or Drizzle mapping change is needed.

## Source behavior

- Match owner sources through the original voucher's event and retained evidence/locator, including records with no posted effect.
- Also match owner effects by voucher and posted proposal attachments by the posted change-set identity. Missing effect capture does not erase source/proposal provenance.
- Return blocking `owner_record` resources with links to `/owner-register/records/:id`.
- Bind source/current revision/current review, all record proposal links/effects and applied allocation legs into an exact `dependencyDigest`. Owner changes therefore alter the frozen impact basis even without ledger or account-version movement.
- Reuse existing0410 preflight, seal, approval, execution and reversal-only guards; no owner release, capacity change, ledger write or new authority is implemented.
- Preserve all historical snapshot/approval/receipt rows. Old snapshots for newly affected owners compare stale; unaffected resources retain their old shape. Exact committed replay still occurs before live checks in the unchanged bundle command.

The contract only adds `owner_record` and optional `dependencyDigest`; old persisted resources still decode. The owned impact UI displays that digest with an English/Swedish label and its existing affected-record link.

## Validation and limits

Bounded owned-file Oxlint passed with zero warnings/errors on the contract and two changed UI files. Oxfmt passed on those files and the workbench document. Source review confirmed0410 and0610 bytes were unchanged during this fix. No SQL, migration, runtime, browser, tests, global check, dependency, Git action or delegation was run. Concurrent owner admission, snapshot comparison, rejection before financial writes, rollback and historical receipt recovery remain unverified. Root controls the migration batch and native validation.

Next root action: inspect0890 and apply it after0610/0410 in the authorized local batch; keep the known-owner blocking policy until an explicit owner correction/release contribution exists. Acceptance cases are recorded in `CORRECTIONS-WORKBENCH.md`.

## Released SHA-256

- `apps/api/migrations/0890-owner-correction-impact.sql`: `537ec54ceb827645777d1788953c1aa6661138ac232f0ce2be1f969408913859`
- `packages/contracts/src/corrections.ts`: `7627d0e6145ed618af91adf46b17a1c955262dc66b3ec49a4d8efd0cd5b73844`
- `apps/web/src/components/corrections/impact-review.tsx`: `f39a48d50c90d9e0ea8fbda9882c119ef944208a2118ac57599016febba8d72a`
- `apps/web/src/components/corrections/copy.ts`: `4e159d0aad3ccfc77a0167eccd506f2adffa9a3fd9f74333f7639739fe2f4f77`
- `apps/api/CORRECTIONS-WORKBENCH.md`: `82c0fdd2c68f6e3c02f92e29eaa90e0cae071a5246f9d9913a35a344ff3b6513`

Consumed unchanged prerequisites:

- `apps/api/migrations/0410-correction-impact-workbench.sql`: `17d09cbd78cf8230b1ed5ebbe1b4b403d0248c9c397033ef9a08d1a5095d5981`
- `apps/api/migrations/0610-owner-register.sql`: `5e54e781e33993df5a39a6613b3950b07e72063c136113c7c6e164eba6daee64`
