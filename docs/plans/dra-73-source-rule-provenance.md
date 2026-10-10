# DRA-73 source and rule provenance contract

Scope: actual-company rule admission through `RuleRelease` and the existing company profile HTTP operation. Keep rule rows operator-installed; no external source fetch, legal claim or new catalog.

Failure cases, before implementation:
- A source retrieved after the independent review is stale relative to that review: label the family incomplete and refuse activation, without any receipt or activation.
- A release with valid dates outside the source effective interval cannot qualify: label incomplete and refuse activation.
- Empty primary-source or example/counterexample coverage cannot qualify: label incomplete and refuse activation.
- SQL release identity/version/checksum differing from retained body cannot yield a witness, even if the body is otherwise reviewed.

Acceptance: the authenticated HTTP profile reports a named incomplete gap, the activation route refuses each invalid release, and the PostgreSQL counts do not change. A valid synthetic dossier still resolves. E2E artifacts retain the request outcomes and database counts. No claim of live publisher freshness or statutory qualification follows from synthetic URLs.

The rule inventory is the versioned `openerp.rule_releases` table. Its retained body carries release ID, family, jurisdiction, version, checksum, validity dates, reviewed qualification, versioned primary publisher URL/hash/retrieval and effective dates, examples and counterexamples. The SQL identity fields must match the retained body before a witness can select it. `company_get_profile` reports incomplete rather than a verified rule where qualification fails. This only proves the installed dossier is internally consistent: there is no live publisher re-fetch, source replacement feed, or legal determination in this lane. Operators must review current publisher versions and complete applicable jurisdiction/family coverage before actual-company activation.

