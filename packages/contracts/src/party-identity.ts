import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import * as Accounting from "./accounting";
import { accountingErrors as errors } from "./accounting-errors";

// NEXT-27 owner contract: reviewed party identity resolution without balance
// merging, extending the existing party directory (crm-master) owner.
//
// A resolution records that two or more retained party records denote the
// same legal entity, related-but-distinct entities, or not duplicates at
// all. It never merges balances, never rewrites an old payee fact, and never
// combines settlement capacity. What it changes is how later reads group
// obligations for presentation, and which downstream records must be
// rechecked when the resolution changes.
//
// Two things this owner does not do. It does not verify legal identity: the
// retained counterparty record carries `legalIdentityVerified: false`, so
// every identifier the owner derives is marked unverified, and a
// same-legal-entity resolution additionally requires cited retained evidence
// that a human reviewed. The leaf then enforces that conflicting verified
// identifiers can only resolve as related or not a duplicate. And it does not
// invent identifiers: a member carries exactly what the retained party record
// carries, which today is an external key, a display name and a role, plus a
// bank account only where a verified payee proposal retains one.

export const PreparePartyResolution = Schema.Struct({
  partyIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(50),
    Schema.isUnique(),
  ),
  canonicalPartyId: Accounting.Identifier,
  kind: Schema.Literals(["same_legal_entity", "related_but_distinct", "not_duplicate"]),
  evidenceId: Schema.NullOr(Accounting.Identifier),
});

export type PreparePartyResolution = typeof PreparePartyResolution.Type;

export const LegalIdentifierView = Schema.Struct({
  scheme: Schema.String,
  value: Schema.String,
  verified: Schema.Boolean,
});

export type LegalIdentifierView = typeof LegalIdentifierView.Type;

export const ResolutionMemberView = Schema.Struct({
  partyId: Accounting.Identifier,
  partyRevision: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,17}$/)),
  identifiers: Schema.Array(LegalIdentifierView),
  redirectClosure: Schema.Array(Accounting.Identifier),
});

export type ResolutionMemberView = typeof ResolutionMemberView.Type;

export const PartyResolutionReport = Schema.Struct({
  resolutionId: Accounting.Identifier,
  members: Schema.Array(ResolutionMemberView),
  canonicalPartyId: Accounting.Identifier,
  kind: Schema.Literals(["same_legal_entity", "related_but_distinct", "not_duplicate"]),
  evidenceReviewed: Schema.Boolean,
  evidenceRef: Schema.NullOr(Accounting.Identifier),
  memberDigest: Accounting.Digest,
  invalidatedObligationIds: Schema.Array(Accounting.Identifier),
  invalidatedReservationIds: Schema.Array(Accounting.Identifier),
  invalidatedDraftIds: Schema.Array(Accounting.Identifier),
  receipt: Schema.Struct({
    key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    operation: Schema.String,
    actorId: Accounting.Identifier,
  }),
});

export type PartyResolutionReport = typeof PartyResolutionReport.Type;

export const DirectoryBalanceGroup = Schema.Struct({
  legalIdentity: Accounting.Identifier,
  currency: Schema.String,
  totalOutstandingMinor: Accounting.MinorUnits,
  obligationIds: Schema.Array(Accounting.Identifier),
  controlAccounts: Schema.Array(Accounting.Identifier),
});

export type DirectoryBalanceGroup = typeof DirectoryBalanceGroup.Type;

export const DirectoryBalanceView = Schema.Struct({
  groups: Schema.Array(DirectoryBalanceGroup),
  resolutionId: Schema.NullOr(Accounting.Identifier),
  complete: Schema.Boolean,
  reason: Schema.NullOr(Schema.String),
});

export type DirectoryBalanceView = typeof DirectoryBalanceView.Type;

export const ReadDirectoryBalances = Schema.Struct({
  partyIds: Schema.Array(Accounting.Identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(50),
  ),
  resolutionKey: Schema.NullOr(Accounting.IdempotencyHeaders.fields["idempotency-key"]),
});

export type ReadDirectoryBalances = typeof ReadDirectoryBalances.Type;

const path = "/v1/entities/:entityId/books/:bookId/commerce/party-identity";

export const PartyIdentityApi = HttpApiGroup.make("partyIdentity").add(
  HttpApiEndpoint.post("preparePartyResolution", path, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: PreparePartyResolution.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: PartyResolutionReport,
    error: errors,
  }),
  HttpApiEndpoint.post("readDirectoryBalances", `${path}/balances`, {
    params: Accounting.Scope,
    headers: Accounting.IdempotencyHeaders,
    payload: ReadDirectoryBalances.annotate({ parseOptions: { onExcessProperty: "error" } }),
    success: DirectoryBalanceView,
    error: errors,
  }),
);

// Agent surface. Read-only and deliberately narrow: an agent may read how
// retained open obligations group under a saved resolution. It may not
// prepare a resolution, because recording that two parties are the same
// legal entity is a reviewed human decision with cited evidence, and name
// or email similarity never substitutes for it.
export const PartyIdentityCapabilities = {
  directory_read_balances: {
    description:
      "Group retained open obligations by legal identity and currency under a saved party resolution, without netting across parties, roles or currencies. Each group carries its obligation identities and control accounts. A stale resolution groups nothing.",
    input: Schema.Struct({
      scope: Accounting.Scope,
      idempotencyKey: Accounting.IdempotencyHeaders.fields["idempotency-key"],
      input: ReadDirectoryBalances,
    }),
    output: DirectoryBalanceView,
    readOnly: true,
  },
};
