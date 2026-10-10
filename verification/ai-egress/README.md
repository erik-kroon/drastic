# AI egress verification

AUT-28 guards the current SystemOne HTTP and Workers AI calls and Azure document
submit/poll calls. Its application factory binds the current book authority,
loads stored identities and commits a disclosure admission before dispatch.
[Failure cases](../../docs/operations/ai-egress-failure-cases.md) preceded the implementation.

## Repeat the synthetic journeys

```sh
OPENERP_E2E_ARTIFACTS=test-results/aut28-final bun run test:e2e \
  apps/api/tests/ai-egress.e2e.test.ts \
  apps/api/tests/decision-model.e2e.test.ts \
  apps/api/tests/document-reader.e2e.test.ts --testTimeout 90000
bun run check:changed:full
bun run check:owners
```

The existing E2E harness starts migrated PostgreSQL and the local Worker with a
restricted runtime role. Provider fixtures stay on loopback. No real books,
credentials or live providers are used. The explicit timeout accommodates the
PDF and durable-job journeys without retries or changes to suite defaults.

Keep `manifest.json`, `source-integrity.json`, `results.json` and the journey JSON
files together. `ai-egress.json` records provider-visible tokenised requests and
immutable admission metadata. `ai-egress-scope.json` records retained aliases,
cross-book rejection, the audit cursor and refusal when audit INSERT permission
is withdrawn. `ai-egress-raw.json` records policy refusal plus separate raw submit
and operation-reference poll admissions. Document-reader artifacts retain the
real extraction owner, cancellation and no-resubmit observations. Results are
local ignored artifacts, not a production archive. [The committed observation](observed.json)
retains commands, source digests and synthetic provider-visible examples.

## Use the boundary

Call `openAiEgress(token, scope, purpose)` from an application operation and pass
that context to the adapter. The factory rechecks current authority for each
admission. It loads client and historical setup identities, actor/profile names
and emails, owners, employment references and private counterparty revisions.
Names already observed for clients and people remain in the private alias store.
Ambiguous personal aliases refuse disclosure. Client aliases always take
masking priority, including when a supplier has the same name.

An unclassified counterparty is masked. An operator can retain an evidence-bound
`company`, `person` or `sole_trader` classification for the current revision.
A company classification permits that revision's public company name to remain.
It does not unmask historical private revisions. Use the operator console with
the restricted database connection and current access token already in the
environment.

```sh
cd apps/api
bun scripts/ai-egress.ts classify <entity> <book> <party> <revision> <kind> <evidence>
bun scripts/ai-egress.ts audit <entity> <book> [after-sequence]
```

Console output contains metadata, not prompts or aliases. Admission rows record
the configured provider release, disclosure categories, destination, policy
reference, payload digest and database timestamp. They establish attempted
admission before dispatch, not provider receipt. An admitted call can still be
cancelled before the network starts. Admission writes and identity mappings are
immutable; the audit cursor is monotonic.

Decision requests can carry typed `AiState` facts for amounts, accounts, VAT and
dates. These values are preserved exactly in the declared root decision-state field.
Financial-shaped objects elsewhere in JSON are ordinary text and receive masking.
Application consumers must obtain financial facts from authoritative stored records. Free text is matched against known
aliases and Swedish personal/coordination-number patterns. Identity-bearing
object keys refuse admission because changing protocol keys is unsafe. Supplied
reserved tokens refuse admission. This first implementation accepts fresh
identity-bearing input, not raw tokenised conversation replay.

Each validated decision response carries its captured `tokens` registry.
Use `restoreIdentity({kind, token})` for a declared identity field or
`renderTemplate` with explicit identity parts. Narrative text keeps its tokens.
Wrong kinds, unknown tokens, malformed tokens and cross-book tokens refuse
restoration or output admission. Personal-number pattern tokens cannot be
restored to raw numbers. Future agent consumers must use these same operations
and typed slots rather than add prompt-local replacement.

## Qualify live use separately

Live adapters require `OPENERP_AI_EGRESS_POLICY` set to
`eu-no-training-no-retention` or `self-hosted` and
`OPENERP_AI_EGRESS_APPROVAL` set to a retained approval reference. These settings
are deployment attestations, not verification of geography, contracts, retention
or model weights. Keep private qualification evidence in `drastic-hq`.

Raw document readers receive the original. Their admissions explicitly record
`raw_document`; tokenisation begins after extraction. Existing extraction claims
still prevent resubmission when the submission receipt is lost. A refusal after
a claim does not authorize sending the original again.

Known-name matching does not guarantee anonymity. Nicknames, unknown aliases,
signatures and unusual inflections can escape it. Tokenised data remains
sensitive. The general claim that names never reach an AI provider cannot cover
raw documents. Synthetic fixtures do not qualify any live provider or certify
accounting compliance.
