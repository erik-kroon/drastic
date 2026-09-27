import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Digest, Identifier } from "./values";
import { MinorUnits } from "./money";

// Pure party-identity math for one book.
// NEXT-27 leaf: reviewed duplicate identity resolution without balance
// merging. Only same_legal_entity creates a lookup redirect; related
// companies and similar names stay separate counterparties. No original
// party, invoice, payment verification or ledger reference is rewritten:
// reads group original obligations for presentation, and an erroneous
// resolution is replaced, never undone financially. The application owns
// resolution persistence, head epochs and plan invalidation; the existing
// directory/annotation owner keeps its records.

export const IdentityFailureCode = Schema.Literals([
  "CrossBookMembership",
  "RedirectCycle",
  "CanonicalOutsideMembers",
  "IncompatibleLegalIdentity",
  "EvidenceNotReviewed",
  "StaleIdentityBasis",
  "RedirectRecursion",
  "ResolutionOversize",
  "CurrencyNettingRefused",
  "RoleNettingRefused",
  "MissingDependencyEvidence",
]);

export type IdentityFailureCode = typeof IdentityFailureCode.Type;

export const IdentityFailure = Schema.Struct({
  code: IdentityFailureCode,
  message: Description,
});

export type IdentityFailure = typeof IdentityFailure.Type;

export type Checked<A> = Result.Result<A, IdentityFailure>;

function fail(code: IdentityFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

export const ResolutionKind = Schema.Literals([
  "same_legal_entity",
  "related_but_distinct",
  "not_duplicate",
]);

export type ResolutionKind = typeof ResolutionKind.Type;

export const LegalIdentifierScheme = Schema.Literals([
  "se_organisation_number",
  "se_personal_number",
  "eu_vat_number",
  "other_tax_registration",
  "bank_account",
  "unqualified",
]);

export type LegalIdentifierScheme = typeof LegalIdentifierScheme.Type;

export const LegalIdentifier = Schema.Struct({
  scheme: LegalIdentifierScheme,
  value: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  verified: Schema.Boolean,
});

export type LegalIdentifier = typeof LegalIdentifier.Type;

export const ResolutionMember = Schema.Struct({
  partyId: Identifier,
  partyRevision: Identifier,
  bookId: Identifier,
  identifiers: Schema.Array(LegalIdentifier),
  redirectClosure: Schema.Array(Identifier),
  identityEpoch: MinorUnits,
});

export type ResolutionMember = typeof ResolutionMember.Type;

export const PartyResolution = Schema.Struct({
  id: Identifier,
  members: Schema.Array(ResolutionMember).check(Schema.isMinLength(2), Schema.isMaxLength(50)),
  canonicalPartyId: Identifier,
  kind: ResolutionKind,
  evidenceReviewed: Schema.Boolean,
  evidenceRef: Schema.NullOr(Identifier),
  memberDigest: Digest,
  downstreamInvalidation: Schema.Array(Identifier),
});

export type PartyResolution = typeof PartyResolution.Type;

export const PrepareResolutionInput = Schema.Struct({
  resolutionId: Identifier,
  members: Schema.Array(ResolutionMember).check(Schema.isMinLength(2), Schema.isMaxLength(50)),
  canonicalPartyId: Identifier,
  kind: ResolutionKind,
  evidenceReviewed: Schema.Boolean,
  evidenceRef: Schema.NullOr(Identifier),
  memberDigest: Digest,
  openObligationIds: Schema.Array(Identifier),
  paymentReservations: Schema.Array(Identifier),
  unissuedDependentDrafts: Schema.Array(Identifier),
});

export type PrepareResolutionInput = typeof PrepareResolutionInput.Type;

function verifiedValues(member: ResolutionMember, scheme: LegalIdentifierScheme) {
  return member.identifiers
    .filter((identifier) => identifier.scheme === scheme && identifier.verified)
    .map((identifier) => identifier.value);
}

// Preparation seals the exact member set, revisions, classification and the
// downstream invalidation list. Verified legal identifiers decide: two
// members with different verified organisation, personal or VAT numbers can
// only resolve as related or not a duplicate. A bank account or tax number
// alone never proves legal identity, and name or email similarity never
// substitutes for reviewed evidence.
export function prepareResolution(input: PrepareResolutionInput): Checked<PartyResolution> {
  const books = new Set(input.members.map((member) => member.bookId));

  if (books.size !== 1) {
    return fail("CrossBookMembership", "A resolution cannot span books.");
  }

  const memberIds = new Set(input.members.map((member) => member.partyId));

  if (!memberIds.has(input.canonicalPartyId)) {
    return fail(
      "CanonicalOutsideMembers",
      "The canonical party must belong to the resolved member set.",
    );
  }

  for (const member of input.members) {
    if (member.redirectClosure.includes(member.partyId)) {
      return fail("RedirectCycle", "A member redirect closure contains the member itself.");
    }

    for (const target of member.redirectClosure) {
      if (memberIds.has(target)) {
        return fail(
          "RedirectCycle",
          "A member redirect closure reaches another member of the same resolution.",
        );
      }
    }
  }

  const schemes: Array<LegalIdentifierScheme> = [
    "se_organisation_number",
    "se_personal_number",
    "eu_vat_number",
  ];

  for (const scheme of schemes) {
    const distinct = new Set<string>();

    for (const member of input.members) {
      for (const value of verifiedValues(member, scheme)) distinct.add(value);
    }

    if (distinct.size > 1 && input.kind === "same_legal_entity") {
      return fail(
        "IncompatibleLegalIdentity",
        "Incompatible verified legal identities permit only a related or not-duplicate resolution.",
      );
    }
  }

  if (input.kind === "same_legal_entity") {
    if (!input.evidenceReviewed || input.evidenceRef === null) {
      return fail(
        "EvidenceNotReviewed",
        "A same-legal-entity resolution needs reviewed identity evidence.",
      );
    }
  }

  return Result.succeed({
    id: input.resolutionId,
    members: [...input.members],
    canonicalPartyId: input.canonicalPartyId,
    kind: input.kind,
    evidenceReviewed: input.evidenceReviewed,
    evidenceRef: input.evidenceRef,
    memberDigest: input.memberDigest,
    downstreamInvalidation: [
      ...input.openObligationIds,
      ...input.paymentReservations,
      ...input.unissuedDependentDrafts,
    ],
  });
}

export const ObligationRole = Schema.Literals(["receivable", "payable"]);

export type ObligationRole = typeof ObligationRole.Type;

export const CurrencyCode = Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/));

export const OriginalObligation = Schema.Struct({
  obligationId: Identifier,
  ownerPartyId: Identifier,
  role: ObligationRole,
  currency: CurrencyCode,
  outstandingMinor: MinorUnits,
  controlAccount: Identifier,
});

export type OriginalObligation = typeof OriginalObligation.Type;

export const BalanceGroup = Schema.Struct({
  legalIdentity: Identifier,
  currency: CurrencyCode,
  totalOutstandingMinor: MinorUnits,
  obligationIds: Schema.Array(Identifier),
  controlAccounts: Schema.Array(Identifier),
});

export type BalanceGroup = typeof BalanceGroup.Type;

export const DirectoryViewInput = Schema.Struct({
  resolution: Schema.NullOr(PartyResolution),
  obligations: Schema.Array(OriginalObligation),
});

export type DirectoryViewInput = typeof DirectoryViewInput.Type;

function canonicalFor(resolution: PartyResolution, partyId: string) {
  const member = resolution.members.find((candidate) => candidate.partyId === partyId);

  if (member === undefined) return partyId;

  return resolution.kind === "same_legal_entity" ? resolution.canonicalPartyId : partyId;
}

// Directory reads retrieve each original obligation once and group by legal
// identity and currency for presentation. Different currencies are never
// summed and receivables are never netted against payables: two invoices of
// 100 group to a total of 200, never 100 or 0.
export function resolveDirectoryBalances(input: DirectoryViewInput): Checked<Array<BalanceGroup>> {
  const identityOf = (partyId: string) =>
    input.resolution === null ? partyId : canonicalFor(input.resolution, partyId);

  const seen = new Set<string>();
  const groups = new Map<string, BalanceGroup>();

  for (const obligation of input.obligations) {
    if (seen.has(obligation.obligationId)) {
      return fail(
        "MissingDependencyEvidence",
        "An obligation appears twice in the directory read.",
      );
    }

    seen.add(obligation.obligationId);

    const key = `${identityOf(obligation.ownerPartyId)}|${obligation.role}|${obligation.currency}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        legalIdentity: identityOf(obligation.ownerPartyId),
        currency: obligation.currency,
        totalOutstandingMinor: obligation.outstandingMinor,
        obligationIds: [obligation.obligationId],
        controlAccounts: [obligation.controlAccount],
      });
    } else {
      groups.set(key, {
        legalIdentity: existing.legalIdentity,
        currency: existing.currency,
        totalOutstandingMinor: (
          BigInt(existing.totalOutstandingMinor) + BigInt(obligation.outstandingMinor)
        ).toString(),
        obligationIds: [...existing.obligationIds, obligation.obligationId],
        controlAccounts: [...existing.controlAccounts, obligation.controlAccount],
      });
    }
  }

  return Result.succeed([...groups.values()]);
}

export const IdentityBasis = Schema.Struct({
  memberEpochs: Schema.Array(
    Schema.Struct({ partyId: Identifier, identityEpoch: MinorUnits }),
  ),
  redirectClosures: Schema.Array(
    Schema.Struct({ partyId: Identifier, closure: Schema.Array(Identifier) }),
  ),
  paymentWitness: Schema.Struct({
    bankDetailsRef: Identifier,
    bookingPolicyRef: Identifier,
  }),
});

export type IdentityBasis = typeof IdentityBasis.Type;

// Execution re-checks the sealed basis inside the owning transaction.
// Concurrent resolutions serialize: exactly one closure wins and every
// other worker refuses stale instead of publishing a second current
// closure. A bank-detail change while review is open retires the
// payment-dependent witness.
export function assertResolutionCurrent(
  resolution: PartyResolution,
  current: IdentityBasis,
): Checked<PartyResolution> {
  const epochs = new Map(current.memberEpochs.map((entry) => [entry.partyId, entry.identityEpoch]));

  const closures = new Map(
    current.redirectClosures.map((entry) => [entry.partyId, entry.closure]),
  );

  for (const member of resolution.members) {
    if (epochs.get(member.partyId) !== member.identityEpoch) {
      return fail(
        "StaleIdentityBasis",
        "A member epoch moved since the resolution was prepared.",
      );
    }

    const closure = closures.get(member.partyId) ?? [];
    const sealed = [...member.redirectClosure].sort();
    const live = [...closure].sort();

    if (sealed.length !== live.length || sealed.some((id, index) => id !== live[index])) {
      return fail(
        "StaleIdentityBasis",
        "A redirect closure moved since the resolution was prepared.",
      );
    }
  }

  return Result.succeed(resolution);
}

export function assertPaymentWitnessCurrent(
  sealedWitness: IdentityBasis["paymentWitness"],
  currentWitness: IdentityBasis["paymentWitness"],
): Checked<typeof currentWitness> {
  if (
    sealedWitness.bankDetailsRef !== currentWitness.bankDetailsRef ||
    sealedWitness.bookingPolicyRef !== currentWitness.bookingPolicyRef
  ) {
    return fail(
      "StaleIdentityBasis",
      "Bank details changed while the review was open; the payment witness is stale.",
    );
  }

  return Result.succeed(currentWitness);
}

export const ResolutionChangeInput = Schema.Struct({
  prior: PartyResolution,
  changeId: Identifier,
  replacementKind: ResolutionKind,
  replacementCanonical: Identifier,
  reviewRef: Identifier,
  decidedAt: AccountingDate,
});

export type ResolutionChangeInput = typeof ResolutionChangeInput.Type;

export const ResolutionChange = Schema.Struct({
  changeId: Identifier,
  resolutionId: Identifier,
  replacementKind: ResolutionKind,
  replacementCanonical: Identifier,
  reviewRef: Identifier,
  decidedAt: AccountingDate,
  unissuedPlansStale: Schema.Array(Identifier),
});

export type ResolutionChange = typeof ResolutionChange.Type;

// An erroneous resolution is replaced by a reviewed change. Issued
// document snapshots and existing allocations are not inputs here, so
// they cannot be rewritten: the change only retires the redirect and
// marks unissued dependent plans stale.
export function replaceResolution(input: ResolutionChangeInput): Checked<ResolutionChange> {
  const memberIds = new Set(input.prior.members.map((member) => member.partyId));

  if (!memberIds.has(input.replacementCanonical)) {
    return fail(
      "CanonicalOutsideMembers",
      "The replacement canonical party must belong to the member set.",
    );
  }

  return Result.succeed({
    changeId: input.changeId,
    resolutionId: input.prior.id,
    replacementKind: input.replacementKind,
    replacementCanonical: input.replacementCanonical,
    reviewRef: input.reviewRef,
    decidedAt: input.decidedAt,
    unissuedPlansStale: [...input.prior.downstreamInvalidation],
  });
}

export const LookupInput = Schema.Struct({
  resolution: PartyResolution,
  partyId: Identifier,
  depth: MinorUnits,
});

export type LookupInput = typeof LookupInput.Type;

// Bounded lookup resolution for runtime reads. Only a same-legal-entity
// resolution redirects, and only to the canonical member: one hop, no
// recursion, no oversize traversal.
export function resolveLookup(input: LookupInput): Checked<typeof Identifier.Type> {
  if (BigInt(input.depth) > 8n) {
    return fail("RedirectRecursion", "Identity lookup exceeded its bounded depth.");
  }

  if (input.resolution.members.length > 50) {
    return fail("ResolutionOversize", "The resolved member set is too large to traverse.");
  }

  if (input.resolution.kind !== "same_legal_entity") return Result.succeed(input.partyId);

  const member = input.resolution.members.find((candidate) => candidate.partyId === input.partyId);

  if (member === undefined) return Result.succeed(input.partyId);

  return Result.succeed(input.resolution.canonicalPartyId);
}
