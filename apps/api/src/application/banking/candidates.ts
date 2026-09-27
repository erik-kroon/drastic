import * as Accounting from "@open-erp/contracts/accounting";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import { StatementPaymentReference } from "@open-erp/contracts/reconciliation";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { failure } from "../failures";
import { digest } from "../posting";
import * as CandidateDb from "../../db/banking/candidates";
import * as BankDb from "../../db/banking/shared";
import * as Shared from "./shared";

type Scope = typeof Accounting.Scope.Type;

type Json = Schema.Json;

type JsonObject = Schema.JsonObject;

const CandidatesSchema = Candidates.BankMatchCandidates;

const candidateTables = [
  "books",
  "accounts",
  "periods",
  "bank_sources",
  "bank_statements",
  "bank_observations",
  "bank_matches",
  "bank_active_matches",
  "bank_active_allocation_legs",
  "journal_lines",
  "vouchers",
  "evidence",
  "tax_account_match_capacity",
  "commerce_active_allocation_legs",
  "commerce_invoices",
  "invoice_issues",
];

const maximumPeriods = 1000;

const maximumLines = 1000;

type Period = {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly locked: boolean;
};

function periodState(periods: ReadonlyArray<Period>, date: string) {
  const covering = periods.filter((period) => period.startsOn <= date && period.endsOn >= date);

  if (covering.length === 0) return "missing";

  if (covering.length > 1) return "ambiguous";

  return covering[0]?.locked === true ? "locked" : "open";
}

function readPeriods(value: Json | undefined) {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const startsOn = Shared.textField(entry, "startsOn");
    const endsOn = Shared.textField(entry, "endsOn");

    return startsOn === undefined || endsOn === undefined
      ? []
      : [{ startsOn, endsOn, locked: Shared.booleanField(entry, "locked") === true }];
  });
}

function readLines(value: Json | undefined) {
  return (Array.isArray(value) ? value : []).flatMap((entry) =>
    Shared.isJsonObject(entry) ? [entry] : [],
  );
}

function capacityIsConsistent(amount: bigint, allocated: bigint) {
  return (
    Shared.absolute(allocated) <= Shared.absolute(amount) &&
    (allocated === 0n || Shared.signOf(allocated) === Shared.signOf(amount))
  );
}

export const discoverBankMatchCandidates = Effect.fn("banking.candidates.discover")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly input: typeof Candidates.DiscoverBankMatchCandidates.Type;
  },
) {
  return yield* Shared.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* Shared.requireTables(transaction, candidateTables);
      yield* Shared.requireColumns(transaction, Shared.accountColumns);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      yield* Shared.requireNativeBankProfile(book.profile, book.authority);

      const statement = (yield* CandidateDb.readCandidateStatementExists(
        transaction,
        command.scope.bookId,
        command.input.statementId,
      ))[0];

      if (statement?.present !== true) return yield* failure("NotFound");

      const source = (yield* CandidateDb.readCandidateSource(
        transaction,
        command.scope.bookId,
        command.input.statementId,
        command.input.rowOrdinal,
      ))[0];

      if (!source) return yield* failure("NotFound");

      const sourceReference = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(StatementPaymentReference),
      )(source.paymentReference).pipe(Effect.mapError(() => failure("UnsupportedProfile")));

      const referenceComparable =
        sourceReference !== null &&
        sourceReference.kind === "invoice_document_number" &&
        sourceReference.sourceField === "dedicated_reference" &&
        sourceReference.issuerNamespace === "entity" &&
        sourceReference.issuerId === book.entityId;

      const captured = (yield* CandidateDb.readCandidatePeriods(
        transaction,
        command.scope.bookId,
      ))[0];

      if (!captured) return yield* failure("InternalError");

      if (captured.total > maximumPeriods) return yield* Shared.unsupported();
      const periods = readPeriods(captured.periods);
      const periodDigest = yield* digest({ periods: captured.periods ?? [] });

      const sourceAmount = Shared.minor(source.amountMinor);
      const sourceAllocated = Shared.minor(source.allocatedMinor);

      if (sourceAmount === undefined || sourceAllocated === undefined) {
        return yield* Shared.unsupported();
      }

      if (!capacityIsConsistent(sourceAmount, sourceAllocated)) {
        return yield* failure("InvalidJournal");
      }

      const sourceRemaining = sourceAmount - sourceAllocated;
      const sourceCurrencyOk = source.currency === book.currency;

      const sourceBlocks: string[] = [];

      if (!source.accountActive) sourceBlocks.push("account_inactive");

      if (!sourceCurrencyOk) sourceBlocks.push("currency_mismatch");

      if (sourceRemaining === 0n) sourceBlocks.push("source_no_capacity");
      const sourcePeriod = periodState(periods, source.observedOn);

      if (sourcePeriod !== "open") sourceBlocks.push(`source_period_${sourcePeriod}`);

      const found = (yield* CandidateDb.readCandidateLines(
        transaction,
        command.scope.bookId,
        book.currency,
        source.accountId,
        source.startsOn,
        source.endsOn,
        book.committedSequence,
        source.statementId,
        source.rowOrdinal,
      ))[0];

      if (!found) return yield* failure("InternalError");

      if (found.total > maximumLines) return yield* Shared.unsupported();

      const candidates = yield* Effect.forEach(readLines(found.lines), (line) =>
        Effect.gen(function* () {
          const amount = Shared.minor(Shared.textField(line, "amountMinor"));
          const allocated = Shared.minor(Shared.textField(line, "allocatedMinor"));

          if (amount === undefined || allocated === undefined) {
            return yield* Shared.unsupported();
          }

          if (!capacityIsConsistent(amount, allocated)) {
            return yield* failure("InvalidJournal");
          }

          const remaining = amount - allocated;
          const blocks = [...sourceBlocks];

          const sameCurrency =
            sourceCurrencyOk && Shared.booleanField(line, "sameCurrency") === true;

          if (sourceCurrencyOk && !sameCurrency) blocks.push("currency_mismatch");

          if (Shared.signOf(amount) !== Shared.signOf(sourceAmount)) blocks.push("opposite_sign");

          if (remaining === 0n) blocks.push("line_no_capacity");

          if (Shared.booleanField(line, "taxReserved") === true) {
            blocks.push("tax_account_reserved");
          }

          if (Shared.textField(line, "postingPurpose") === "reversal") {
            blocks.push("reversing_voucher");
          }

          if (Shared.booleanField(line, "reversed") === true) blocks.push("reversed_voucher");
          const postedOn = Shared.textField(line, "postedOn");

          if (postedOn === undefined) return yield* failure("InternalError");
          const postingPeriod = periodState(periods, postedOn);

          if (postingPeriod !== "open") blocks.push(`posting_period_${postingPeriod}`);

          const retained = Shared.booleanField(line, "retainedRelationship") === true;
          const cited = Shared.booleanField(line, "evidenceCited") === true;
          const equal = sourceRemaining !== 0n && remaining === sourceRemaining;

          const referenceEvidence = yield* Schema.decodeUnknownEffect(
            Schema.Array(Candidates.BankCandidateReference).check(Schema.isMaxLength(50)),
          )(line["referenceEvidence"] ?? []).pipe(
            Effect.mapError(() => failure("UnsupportedProfile")),
          );

          // Compare the exact issued number. Removing punctuation or leading zeros
          // would merge distinct documents. Provider IDs and free text are not references.
          const referenceComparison =
            !referenceComparable || referenceEvidence.length === 0
              ? "unavailable"
              : referenceEvidence.some(
                    (reference) =>
                      reference.value === sourceReference?.value &&
                      reference.issuerId === sourceReference.issuerId,
                  )
                ? "match"
                : "mismatch";

          const reasons = [
            ...(retained ? ["retained_relationship_history"] : []),
            ...(referenceComparison === "match" ? ["retained_invoice_reference"] : []),
            ...(cited ? ["statement_evidence_cited"] : []),
            ...(equal ? ["equal_remaining_amount"] : []),
            "amount_proximity_heuristic",
            "date_proximity_heuristic",
          ];

          const days = Shared.dayDistance(postedOn, source.observedOn);

          if (days === undefined) return yield* failure("InternalError");

          const amountDistance = Shared.absolute(
            Shared.absolute(remaining) - Shared.absolute(sourceRemaining),
          );

          return {
            eligible: blocks.length === 0,
            retained,
            referenceMatched: referenceComparison === "match",
            cited,
            equal,
            amountDistance,
            days,
            body: Object.assign(
              {},
              {
                voucherId: Shared.textField(line, "voucherId") ?? "",
                lineId: Shared.textField(line, "lineId") ?? "",
                accountId: Shared.textField(line, "accountId") ?? "",
                postedOn,
                sequence: Shared.textField(line, "sequence") ?? "",
                description: Shared.textField(line, "description") ?? "",
                amountMinor: Shared.signedText(amount),
                allocatedMinor: Shared.signedText(allocated),
                remainingMinor: Shared.signedText(remaining),
                eligible: blocks.length === 0,
                blockedReasons: blocks,
                sameAccount: true,
                sameCurrency,
                sameSign: Shared.signOf(amount) === Shared.signOf(sourceAmount),
                retainedRelationship: retained,
                statementEvidenceCited: cited,
                equalRemainingAmount: equal,
                amountDistanceMinor: Shared.signedText(amountDistance),
                dayDistance: days,
                rankingReasons: reasons,
                referenceComparison,
                referenceEvidence,
              },
            ) satisfies JsonObject,
          };
        }),
      );

      candidates.sort((left, right) => {
        if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;

        if (left.retained !== right.retained) return left.retained ? -1 : 1;

        if (left.referenceMatched !== right.referenceMatched) return left.referenceMatched ? -1 : 1;

        if (left.cited !== right.cited) return left.cited ? -1 : 1;

        if (left.equal !== right.equal) return left.equal ? -1 : 1;

        if (left.amountDistance !== right.amountDistance) {
          return left.amountDistance < right.amountDistance ? -1 : 1;
        }

        if (left.days !== right.days) return left.days - right.days;

        const voucher = (Shared.textField(left.body, "voucherId") ?? "").localeCompare(
          Shared.textField(right.body, "voucherId") ?? "",
        );

        if (voucher !== 0) return voucher;

        return (Shared.textField(left.body, "lineId") ?? "").localeCompare(
          Shared.textField(right.body, "lineId") ?? "",
        );
      });

      const eligible = candidates.filter((candidate) => candidate.eligible);

      const body = Object.assign({}, {
        version: "bank_match_candidates_v1",
        scope: { entityId: book.entityId, bookId: book.id },
        currency: book.currency,
        currencyScale: book.currencyScale,
        window: {
          accountId: source.accountId,
          startsOn: source.startsOn,
          endsOn: source.endsOn,
          lineLimit: maximumLines,
          completeWithinScope: true,
        },
        cutoff: {
          committedSequence: book.committedSequence,
          sourceRevision: source.sourceRevision,
          accountVersion: source.accountVersion,
          profileVersion: book.profileVersion,
          writerEpoch: book.writerEpoch,
          periodDigest,
        },
        source: {
          statementId: source.statementId,
          rowOrdinal: source.rowOrdinal,
          evidenceId: source.evidenceId,
          evidenceSha256: source.evidenceSha256,
          sourceBankAccountId: source.sourceBankAccountId,
          providerId: source.providerId,
          observedOn: source.observedOn,
          description: source.description,
          amountMinor: Shared.signedText(sourceAmount),
          allocatedMinor: Shared.signedText(sourceAllocated),
          remainingMinor: Shared.signedText(sourceRemaining),
          eligible: sourceBlocks.length === 0,
          blockedReasons: sourceBlocks,
          paymentReference: sourceReference,
        },
        candidates: candidates.map((candidate) => candidate.body),
        eligibleCount: eligible.length,
        equalAmountEligibleCount: eligible.filter((candidate) => candidate.equal).length,
        multipleEligibleCandidates: eligible.length > 1,
        identityEstablished: false,
        providerReferenceComparison: referenceComparable
          ? "invoice_document_number_v1"
          : "unavailable",
        rankingPolicy: "retained_then_reference_amount_date_v2",
        coverage: "not_established",
      } satisfies JsonObject);

      const bodyDigest = yield* digest(body);
      const previousDigest = command.input.previousDigest;

      return yield* Shared.decode(
        CandidatesSchema,
        yield* Shared.toJsonObject(
          Object.assign({}, body, {
            digest: bodyDigest,
            previousDigestMatches:
              previousDigest === undefined ? null : previousDigest === bodyDigest,
          }),
        ),
      );
    }),
  );
});
