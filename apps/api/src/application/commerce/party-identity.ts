import { prepareResolution, resolveDirectoryBalances } from "@open-erp/domain/party-identity";
import * as Commerce from "@open-erp/contracts/commerce";
import * as PartyIdentity from "@open-erp/contracts/party-identity";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { digest, newId, replay, saveCommand } from "../posting";
import { readLiveInvoicePage } from "../../db/commerce/invoices";
import { decode, requireTableAccess, toJsonObject, withBook, type Scope } from "./support";
import * as DirectoryDb from "../../db/commerce/party-identity";

// NEXT-27: reviewed party identity resolution without balance merging,
// extending the party directory (crm-master) owner.
//
// A resolution records that retained party records denote the same legal
// entity, related-but-distinct entities, or not duplicates at all. It never
// merges a balance, never rewrites an old payee fact and never combines
// settlement capacity. What changes is how later reads group obligations for
// presentation, and which downstream records the resolution invalidates.
//
// The owner owns three decisions. It owns the member set, which it builds
// from retained counterparty heads: every named party must exist in this
// book, and the canonical party must belong to the set. It owns what the
// members carry, which is exactly what the retained record carries — an
// external key, a display name and a role, plus a bank account only where a
// verified payee proposal retains one. And it owns whether the resolution may
// claim its kind.
//
// Two things it refuses. It refuses to verify legal identity, because the
// retained record carries `legalIdentityVerified: false`: every derived
// identifier is marked unverified, and a same-legal-entity resolution
// additionally requires cited retained evidence that a human reviewed. The
// leaf then enforces that conflicting verified identifiers can only resolve
// as related or not a duplicate. And it refuses to invent members,
// identifiers, obligations or drafts: an empty invalidation list means the
// owner looked and found none, never that it did not look.

const maximumMembers = 50;

const maximumObligations = 2000;

const maximumReservations = 200;

const maximumDrafts = 200;

const ResolutionSchema = PartyIdentity.PartyResolutionReport;

const BalancesSchema = PartyIdentity.DirectoryBalanceView;

const RetainedCurrency = Schema.Struct({ currency: Schema.String });

export const preparePartyResolution = Effect.fn("directory.prepareResolution")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof PartyIdentity.PreparePartyResolution.Type;
  },
) {
  return yield* withBook(token, command.scope, true, function* (transaction, principal) {
    yield* requireTableAccess(transaction, [...DirectoryDb.partyIdentityTables], true);

    const scope = command.scope;
    const bookId = scope.bookId;
    const input = command.input;

    if (input.partyIds.length > maximumMembers) return yield* failure("UnsupportedProfile");

    const request = yield* replay(
      transaction,
      scope,
      command.idempotencyKey,
      "prepare_party_resolution",
      principal.actorId,
      yield* toJsonObject({
        partyIds: input.partyIds,
        canonicalPartyId: input.canonicalPartyId,
        kind: input.kind,
      }),
      ResolutionSchema,
    );

    if (request.previous) return request.previous;

    const heads = yield* DirectoryDb.readCounterpartyHeads(transaction, bookId, input.partyIds);

    if (heads.length !== input.partyIds.length) return yield* failure("NotFound");

    const byId = new Map(heads.map((head) => [head.id, head]));

    // Every identifier the owner derives is marked unverified, because the
    // retained record marks legal identity unverified. A bank account from a
    // verified payee proposal is still unverified as identity: the leaf's
    // own rule is that a bank account alone never proves legal identity.
    const members: Array<{
      partyId: string;
      partyRevision: string;
      bookId: string;
      identifiers: Array<{ scheme: "unqualified"; value: string; verified: false }>;
      redirectClosure: Array<string>;
      identityEpoch: string;
    }> = [];

    for (const partyId of input.partyIds) {
      const head = byId.get(partyId);

      if (!head) return yield* failure("NotFound");

      const revision = yield* decode(Commerce.CounterpartyRevision, head.revision);

      members.push({
        partyId,
        partyRevision: head.currentRevision,
        bookId,
        identifiers: [
          {
            scheme: "unqualified",
            value: revision.externalKey,
            verified: false,
          },
        ],
        redirectClosure: [],
        identityEpoch: head.currentRevision,
      });
    }

    const resolved = members;

    let evidenceReviewed = false;
    let evidenceRef: string | null = null;

    if (input.kind === "same_legal_entity") {
      if (input.evidenceId === null) return yield* failure("MissingEvidence");

      const present = (yield* DirectoryDb.readEvidencePresent(
        transaction,
        bookId,
        input.evidenceId,
      ))[0]?.present;

      if (!present) return yield* failure("MissingEvidence");

      evidenceReviewed = true;
      evidenceRef = input.evidenceId;
    }

    const memberDigest = yield* digest({
      members: resolved.map((member) => ({
        partyId: member.partyId,
        partyRevision: member.partyRevision,
        identifiers: member.identifiers,
      })),
      canonicalPartyId: input.canonicalPartyId,
      kind: input.kind,
    });

    const invoiceRows = yield* DirectoryDb.readInvoiceIdsByCounterparty(
      transaction,
      bookId,
      input.partyIds,
      maximumObligations,
    );

    if (invoiceRows.length > maximumObligations) return yield* failure("UnsupportedProfile");

    const live = yield* readLiveInvoicePage(
      transaction,
      bookId,
      invoiceRows.map((row) => row.id),
    );

    const openObligationIds = live
      .filter((row) => row.outstandingMinor !== null && BigInt(row.outstandingMinor) > 0n)
      .map((row) => row.id);

    const reservations =
      openObligationIds.length === 0
        ? []
        : yield* DirectoryDb.readReservationItems(
            transaction,
            bookId,
            openObligationIds,
            maximumReservations,
          );

    if (reservations.length > maximumReservations) {
      return yield* failure("UnsupportedProfile");
    }

    const drafts = yield* DirectoryDb.readUnissuedDrafts(
      transaction,
      bookId,
      input.partyIds,
      maximumDrafts,
    );

    if (drafts.length > maximumDrafts) return yield* failure("UnsupportedProfile");

    const prepared = prepareResolution({
      resolutionId: newId("party_resolution"),
      members: resolved.map((member) => ({
        ...member,
        memberDigest,
      })),
      canonicalPartyId: input.canonicalPartyId,
      kind: input.kind,
      evidenceReviewed,
      evidenceRef,
      memberDigest,
      openObligationIds,
      paymentReservations: reservations.map((row) => row.exportId),
      unissuedDependentDrafts: drafts.map((row) => row.id),
    });

    if (Result.isFailure(prepared)) return yield* failure("InvalidJournal");

    const resolution = prepared.success;

    const report = {
      resolutionId: resolution.id,
      members: resolved.map((member) => ({
        partyId: member.partyId,
        partyRevision: member.partyRevision,
        identifiers: member.identifiers.map((identifier) => ({
          scheme: "unqualified",
          value: identifier.value,
          verified: false,
        })),
        redirectClosure: [],
      })),
      canonicalPartyId: resolution.canonicalPartyId,
      kind: resolution.kind,
      evidenceReviewed: resolution.evidenceReviewed,
      evidenceRef: resolution.evidenceRef,
      memberDigest: resolution.memberDigest,
      invalidatedObligationIds: resolution.downstreamInvalidation.filter((id) =>
        openObligationIds.includes(id),
      ),
      invalidatedReservationIds: resolution.downstreamInvalidation.filter((id) =>
        reservations.some((row) => row.exportId === id),
      ),
      invalidatedDraftIds: resolution.downstreamInvalidation.filter((id) =>
        drafts.some((row) => row.id === id),
      ),
      receipt: {
        key: command.idempotencyKey,
        operation: "prepare_party_resolution",
        actorId: principal.actorId,
      },
    };

    yield* saveCommand(
      transaction,
      scope,
      command.idempotencyKey,
      request.expected,
      "prepare_party_resolution",
      principal.actorId,
      yield* toJsonObject(report),
    );

    return yield* decode(ResolutionSchema, yield* toJsonObject(report));
  });
});

export const readDirectoryBalances = Effect.fn("directory.balances")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof PartyIdentity.ReadDirectoryBalances.Type;
  },
) {
  return yield* withBook(token, command.scope, false, function* (transaction, principal) {
    yield* requireTableAccess(transaction, [...DirectoryDb.partyIdentityTables], false);

    const scope = command.scope;
    const bookId = scope.bookId;
    const input = command.input;

    const request = yield* replay(
      transaction,
      scope,
      command.idempotencyKey,
      "read_directory_balances",
      principal.actorId,
      yield* toJsonObject({ partyIds: input.partyIds, resolutionKey: input.resolutionKey }),
      BalancesSchema,
    );

    if (request.previous) return request.previous;

    const heads = yield* DirectoryDb.readCounterpartyHeads(transaction, bookId, input.partyIds);

    if (heads.length !== input.partyIds.length) return yield* failure("NotFound");

    // A saved resolution is read by its own command key and decoded through
    // the contract. What the caller asserts is the key; everything the view
    // groups by comes from the retained receipt.
    let resolution: typeof PartyIdentity.PartyResolutionReport.Type | null = null;

    if (input.resolutionKey !== null) {
      const saved = yield* DirectoryDb.readPartyResolutionByKey(
        transaction,
        bookId,
        input.resolutionKey,
      );

      const row = saved[0];

      if (!row) return yield* failure("NotFound");

      resolution = yield* decode(ResolutionSchema, row.body);

      // A resolution that no longer matches the current revisions is stale,
      // and a stale resolution groups nothing. The leaf's own currency
      // guard is the arbiter; the owner checks it before grouping.
      const current = yield* assertCurrent(transaction, bookId, resolution);

      if (!current) {
        return yield* finishIncomplete(
          transaction,
          scope,
          command.idempotencyKey,
          principal.actorId,
          request.expected,
          "the saved resolution no longer matches current party revisions",
        );
      }
    }

    const invoiceRows = yield* DirectoryDb.readInvoiceIdsByCounterparty(
      transaction,
      bookId,
      input.partyIds,
      maximumObligations,
    );

    if (invoiceRows.length > maximumObligations) return yield* failure("UnsupportedProfile");

    const live = yield* readLiveInvoicePage(
      transaction,
      bookId,
      invoiceRows.map((row) => row.id),
    );

    // Currency, direction and control account come from retained rows, and
    // direction decides the role: a customer invoice is a receivable, a
    // supplier invoice is a payable. The leaf refuses to net across either
    // boundary, so getting either wrong would be a wrong total rather than
    // a refused one. An invoice whose direction is neither is not an
    // obligation this view understands, and it is left out with the count
    // retained rather than forced into a role.
    const obligations: Array<{
      obligationId: string;
      ownerPartyId: string;
      role: "receivable" | "payable";
      currency: string;
      outstandingMinor: string;
      controlAccount: string;
    }> = [];

    for (const row of live) {
      if (row.outstandingMinor === null || BigInt(row.outstandingMinor) <= 0n) continue;

      const identity = invoiceRows.find((candidate) => candidate.id === row.id);

      if (!identity) continue;

      const role =
        identity.direction === "customer"
          ? "receivable"
          : identity.direction === "supplier"
            ? "payable"
            : null;

      if (role === null) continue;

      const decoded = yield* decode(RetainedCurrency, row.body);

      obligations.push({
        obligationId: row.id,
        ownerPartyId: identity.counterpartyId,
        role,
        currency: decoded.currency,
        outstandingMinor: row.outstandingMinor,
        controlAccount: identity.controlAccountId,
      });
    }

    const enriched = obligations;

    const grouped = resolveDirectoryBalances({
      resolution:
        resolution === null
          ? null
          : {
              id: resolution.resolutionId,
              members: resolution.members.map((member) => ({
                partyId: member.partyId,
                partyRevision: member.partyRevision,
                bookId,
                identifiers: member.identifiers.map((identifier) => ({
                  scheme: "unqualified" as const,
                  value: identifier.value,
                  verified: false,
                })),
                redirectClosure: [],
                identityEpoch: member.partyRevision,
              })),
              canonicalPartyId: resolution.canonicalPartyId,
              kind: resolution.kind,
              evidenceReviewed: resolution.evidenceReviewed,
              evidenceRef: resolution.evidenceRef,
              memberDigest: resolution.memberDigest,
              downstreamInvalidation: [],
            },
      obligations: enriched,
    });

    if (Result.isFailure(grouped)) {
      return yield* finishIncomplete(
        transaction,
        scope,
        command.idempotencyKey,
        principal.actorId,
        request.expected,
        `grouping refused: ${grouped.failure.code}: ${grouped.failure.message}`,
      );
    }

    const view = {
      groups: grouped.success.map((group) => ({
        legalIdentity: group.legalIdentity,
        currency: group.currency,
        totalOutstandingMinor: group.totalOutstandingMinor,
        obligationIds: [...group.obligationIds],
        controlAccounts: [...group.controlAccounts],
      })),
      resolutionId: resolution?.resolutionId ?? null,
      complete: true,
      reason: null,
    };

    yield* saveCommand(
      transaction,
      scope,
      command.idempotencyKey,
      request.expected,
      "read_directory_balances",
      principal.actorId,
      yield* toJsonObject(view),
    );

    return yield* decode(BalancesSchema, yield* toJsonObject(view));
  });
});

function assertCurrent(
  transaction: Parameters<typeof readLiveInvoicePage>[0],
  bookId: string,
  resolution: typeof PartyIdentity.PartyResolutionReport.Type,
) {
  return Effect.gen(function* () {
    const heads = yield* DirectoryDb.readCounterpartyHeads(
      transaction,
      bookId,
      resolution.members.map((member) => member.partyId),
    );

    if (heads.length !== resolution.members.length) return false;

    return resolution.members.every((member) => {
      const head = heads.find((candidate) => candidate.id === member.partyId);

      return head !== undefined && head.currentRevision === member.partyRevision;
    });
  });
}

function finishIncomplete(
  transaction: Parameters<typeof readLiveInvoicePage>[0],
  scope: Scope,
  key: string,
  actorId: string,
  expected: string,
  reason: string,
) {
  return Effect.gen(function* () {
    const view = {
      groups: [],
      resolutionId: null,
      complete: false,
      reason,
    };

    yield* saveCommand(
      transaction,
      scope,
      key,
      expected,
      "read_directory_balances",
      actorId,
      yield* toJsonObject(view),
    );

    return yield* decode(BalancesSchema, yield* toJsonObject(view));
  });
}
