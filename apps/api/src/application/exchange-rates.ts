import * as Rates from "@open-erp/contracts/exchange-rates";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "./failures";
import { lockBookForShare, lockBookForUpdate } from "../db/posting";
import { digestJson } from "../db/commerce/access";
import * as RateDb from "../db/exchange-rates";
import type { Transaction } from "../db/transaction";
import { isoNow, newId, replay, saveCommand } from "./posting";
import {
  decode,
  exactKeys,
  toJsonObject,
  unsupported,
  withBook,
  type JsonObject,
  type Scope,
} from "./commerce/support";

type CreateInput = typeof Rates.CreateExchangeRate.Type;
type ReviseInput = typeof Rates.ReviseExchangeRate.Type;
type WithdrawInput = typeof Rates.WithdrawExchangeRate.Type;
type CaptureInput = typeof Rates.CaptureConversionReview.Type;
type Terms = typeof Rates.ExchangeRateTerms.Type;
type BookBasis = typeof Rates.ConversionBookBasis.Type;
type RevisionBody = typeof Rates.ExchangeRateRevision.Type;
type Amounts = typeof Rates.ConversionAmounts.Type;

const RevisionSchema = Rates.ExchangeRateRevision;
const WithdrawalSchema = Rates.ExchangeRateWithdrawal;
const UsabilitySchema = Rates.ExchangeRateUsability;
const BookBasisSchema = Rates.ConversionBookBasis;
const ViewSchema = Rates.ExchangeRateView;
const ListSchema = Rates.ExchangeRateList;
const ReviewSchema = Rates.ConversionReview;
const ReviewViewSchema = Rates.ConversionReviewView;
const ReviewListSchema = Rates.ConversionReviewList;

const termKeys = [
  "fromCurrency",
  "toCurrency",
  "effectiveOn",
  "retrievedOn",
  "rateNumerator",
  "rateDenominator",
  "evidenceId",
  "sourceLocator",
  "reviewEvidenceId",
  "rationale",
] as const;
const withdrawalInputKeys = ["expectedDigest", "evidenceId", "rationale"] as const;
const conversionInputKeys = [
  "observationId",
  "revisionDigest",
  "conversionDate",
  "fromCurrency",
  "sourceScale",
  "originalMinor",
  "roundingPolicy",
  "evidenceId",
  "sourceLocator",
  "rationale",
] as const;
const conversionFormula =
  "N = originalMinor * rateNumerator * 10^bookScale; D = rateDenominator * 10^sourceScale; rounded = div(N,D) + (2*mod(N,D) >= D ? 1 : 0); residualNumerator = N - rounded*D; residualDenominator = D";
const maximumRevision = 20;
const maximumObservations = 200;
const maximumConversions = 200;
const maximumArtifactBytes = 1048576;
const minorUnitBound = 10n ** 38n;

function requireRateAccess(transaction: Transaction, write: boolean) {
  return RateDb.readRateAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      const denied = RateDb.rateTables.some((name) => {
        const access = rows.find((row) => row.tableName === name);
        return access === undefined || !access.canSelect || (write && !access.canInsert);
      });
      return denied ? unsupported() : Effect.void;
    }),
  );
}

function requireTrimmable(value: string) {
  return value.trim() === value && value.length >= 1 && value.length <= 2000
    ? Effect.void
    : failure("InvalidJournal");
}

function requireNativeSynthetic(book: { profile: string; writerAuthority: string }) {
  return book.profile === "synthetic-core-v1" && book.writerAuthority === "native"
    ? Effect.void
    : unsupported();
}

function readCurrent(transaction: Transaction, bookId: string, observationId: string) {
  return RateDb.readRevisions(transaction, bookId, observationId).pipe(
    Effect.flatMap((rows) => {
      const row = rows.at(-1);
      return row ? decode(RevisionSchema, row.body) : failure("NotFound");
    }),
  );
}

function readUsability(transaction: Transaction, bookId: string, observationId: string) {
  return RateDb.readWithdrawal(transaction, bookId, observationId).pipe(
    Effect.flatMap((rows) => {
      const body = rows[0]?.body;
      return decode(UsabilitySchema, {
        state: body === undefined ? "active" : "withdrawn",
        withdrawal: body ?? null,
      });
    }),
  );
}

function requireActive(transaction: Transaction, bookId: string, observationId: string) {
  return RateDb.readWithdrawal(transaction, bookId, observationId).pipe(
    Effect.flatMap((rows) => (rows.length === 0 ? Effect.void : failure("StaleDependency"))),
  );
}

function readBookBasis(transaction: Transaction, bookId: string) {
  return RateDb.readBookBasis(transaction, bookId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row ? decode(BookBasisSchema, row) : failure("Forbidden");
    }),
  );
}

function readNativeBook(transaction: Transaction, bookId: string) {
  return Effect.gen(function* () {
    const row = (yield* RateDb.readBookBasis(transaction, bookId))[0];
    if (!row) return yield* failure("Forbidden");
    yield* requireNativeSynthetic(row);
    return yield* decode(BookBasisSchema, row);
  });
}

function readEvidenceSha(transaction: Transaction, bookId: string, evidenceId: string) {
  return RateDb.readEvidenceDigest(transaction, bookId, evidenceId).pipe(
    Effect.flatMap((rows) => {
      const row = rows[0];
      return row ? Effect.succeed(row.sha256) : failure("MissingEvidence");
    }),
  );
}

function recordMetadata(actorId: string, key: string, operation: string, now: string) {
  return { createdAt: now, receipt: { key, operation, actorId } } satisfies JsonObject;
}

function digestBody(transaction: Transaction, body: JsonObject) {
  return digestJson(transaction, body).pipe(
    Effect.flatMap((rows) => {
      const digest = rows[0]?.digest;
      return digest === undefined ? failure("InternalError") : Effect.succeed(digest);
    }),
    Effect.map((digest): JsonObject => Object.assign({}, body, { digest })),
  );
}

function canonicalContent(body: JsonObject) {
  return Effect.gen(function* () {
    const canonical = yield* Effect.sync(() => canonicalizeJson(body));
    if (Result.isFailure(canonical)) return yield* failure("InternalError");
    return canonical.success.json;
  });
}

function sha256Hex(value: string) {
  return Effect.tryPromise({
    try: async () => {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: () => failure("InternalError"),
  });
}

function buildRevision(
  transaction: Transaction,
  scope: Scope,
  bookCurrency: string,
  row: {
    readonly observationId: string;
    readonly sourceKey: string;
    readonly revision: number;
    readonly previousDigest: string | null;
    readonly terms: Terms;
  },
  command: { readonly key: string; readonly operation: string; readonly actorId: string },
) {
  return Effect.gen(function* () {
    yield* exactKeys(yield* toJsonObject(row.terms), termKeys);
    if (row.terms.fromCurrency === row.terms.toCurrency || row.terms.toCurrency !== bookCurrency) {
      return yield* unsupported();
    }
    yield* requireTrimmable(row.terms.sourceLocator);
    yield* requireTrimmable(row.terms.rationale);
    const sourceSha256 = yield* readEvidenceSha(transaction, scope.bookId, row.terms.evidenceId);
    const reviewSha256 = yield* readEvidenceSha(
      transaction,
      scope.bookId,
      row.terms.reviewEvidenceId,
    );
    const now = yield* isoNow(transaction);
    return yield* decode(
      RevisionSchema,
      yield* digestBody(transaction, {
        observationId: row.observationId,
        sourceKey: row.sourceKey,
        revision: row.revision,
        scope,
        terms: row.terms,
        direction: "target_major_units_per_source_major_unit",
        sourceSha256,
        reviewSha256,
        previousDigest: row.previousDigest,
        legalPolicyApproved: false,
        ...recordMetadata(command.actorId, command.key, command.operation, now),
      }),
    );
  });
}

export const createExchangeRate = Effect.fn("exchangeRates.create")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CreateInput },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "create_exchange_rate",
        principal.actorId,
        payload,
        RevisionSchema,
      );
      if (request.previous) return request.previous;
      yield* requireRateAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(payload, ["sourceKey", "terms"]);
      const book = yield* readNativeBook(transaction, command.scope.bookId);
      const existing = yield* RateDb.readObservationBySourceKey(
        transaction,
        command.scope.bookId,
        command.input.sourceKey,
      );
      if (existing.length > 0) return yield* failure("IdempotencyConflict");
      const bound = yield* RateDb.countObservations(transaction, command.scope.bookId);
      if ((bound[0]?.total ?? 0) >= maximumObservations) return yield* unsupported();
      const observationId = newId("rate");
      const body = yield* buildRevision(
        transaction,
        command.scope,
        book.currency,
        {
          observationId,
          sourceKey: command.input.sourceKey,
          revision: 1,
          previousDigest: null,
          terms: command.input.terms,
        },
        {
          key: command.idempotencyKey,
          operation: "create_exchange_rate",
          actorId: principal.actorId,
        },
      );
      yield* RateDb.insertObservation(transaction, {
        bookId: command.scope.bookId,
        id: observationId,
        sourceKey: command.input.sourceKey,
      });
      yield* RateDb.insertRevision(transaction, {
        bookId: command.scope.bookId,
        observationId,
        revision: 1,
        evidenceId: command.input.terms.evidenceId,
        reviewEvidenceId: command.input.terms.reviewEvidenceId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "create_exchange_rate",
        principal.actorId,
        body,
      );
      return body;
    },
    "update",
  );
});

export const reviseExchangeRate = Effect.fn("exchangeRates.revise")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: ReviseInput },
) {
  const payload: JsonObject = { id: command.id, input: command.input };
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "revise_exchange_rate",
        principal.actorId,
        payload,
        RevisionSchema,
      );
      if (request.previous) return request.previous;
      yield* requireRateAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), ["expectedDigest", "terms"]);
      const book = yield* readNativeBook(transaction, command.scope.bookId);
      const current = yield* readCurrent(transaction, command.scope.bookId, command.id);
      yield* requireActive(transaction, command.scope.bookId, command.id);
      if (current.digest !== command.input.expectedDigest) return yield* failure("StaleDependency");
      const revision = current.revision + 1;
      if (revision > maximumRevision) return yield* unsupported();
      const body = yield* buildRevision(
        transaction,
        command.scope,
        book.currency,
        {
          observationId: command.id,
          sourceKey: current.sourceKey,
          revision,
          previousDigest: current.digest,
          terms: command.input.terms,
        },
        {
          key: command.idempotencyKey,
          operation: "revise_exchange_rate",
          actorId: principal.actorId,
        },
      );
      yield* RateDb.insertRevision(transaction, {
        bookId: command.scope.bookId,
        observationId: command.id,
        revision,
        evidenceId: command.input.terms.evidenceId,
        reviewEvidenceId: command.input.terms.reviewEvidenceId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "revise_exchange_rate",
        principal.actorId,
        payload,
      );
      return body;
    },
    "update",
  );
});

export const withdrawExchangeRate = Effect.fn("exchangeRates.withdraw")(function* (
  token: string,
  command: { scope: Scope; id: string; idempotencyKey: string; input: WithdrawInput },
) {
  const payload: JsonObject = { id: command.id, input: command.input };
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "withdraw_exchange_rate",
        principal.actorId,
        payload,
        WithdrawalSchema,
      );
      if (request.previous) return request.previous;
      yield* requireRateAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(yield* toJsonObject(command.input), withdrawalInputKeys);
      const current = yield* readCurrent(transaction, command.scope.bookId, command.id);
      if (current.digest !== command.input.expectedDigest) return yield* failure("StaleDependency");
      yield* requireActive(transaction, command.scope.bookId, command.id);
      yield* requireTrimmable(command.input.rationale);
      const evidenceSha256 = yield* readEvidenceSha(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      );
      const now = yield* isoNow(transaction);
      const body = yield* decode(
        WithdrawalSchema,
        yield* digestBody(transaction, {
          id: newId("rate_withdrawal"),
          scope: command.scope,
          observationId: command.id,
          revision: current.revision,
          revisionDigest: current.digest,
          input: command.input,
          evidenceSha256,
          permanent: true,
          ...recordMetadata(
            principal.actorId,
            command.idempotencyKey,
            "withdraw_exchange_rate",
            now,
          ),
        }),
      );
      yield* RateDb.insertWithdrawal(transaction, {
        bookId: command.scope.bookId,
        observationId: command.id,
        id: body.id,
        revision: body.revision,
        evidenceId: command.input.evidenceId,
        body,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "withdraw_exchange_rate",
        principal.actorId,
        payload,
      );
      return body;
    },
    "update",
  );
});

export const getExchangeRate = Effect.fn("exchangeRates.get")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRateAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const rows = yield* RateDb.readRevisions(transaction, input.scope.bookId, input.id);
    if (rows.length === 0) return yield* failure("NotFound");
    const revisions = yield* Effect.forEach(rows, (row) => decode(RevisionSchema, row.body));
    const current = revisions.at(-1);
    if (!current) return yield* failure("NotFound");
    const usability = yield* readUsability(transaction, input.scope.bookId, input.id);
    return yield* decode(ViewSchema, { current, revisions, usability });
  });
});

export const listExchangeRates = Effect.fn("exchangeRates.list")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRateAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const observations = yield* RateDb.readObservations(transaction, input.scope.bookId);
    const items = yield* Effect.forEach(observations, (observation) =>
      readCurrent(transaction, input.scope.bookId, observation.id),
    );
    const statuses = yield* Effect.forEach(observations, (observation) =>
      readUsability(transaction, input.scope.bookId, observation.id).pipe(
        Effect.map((usability) => ({ observationId: observation.id, usability })),
      ),
    );
    return yield* decode(ListSchema, { scope: input.scope, items, statuses });
  });
});

function convert(input: CaptureInput, bookScale: number, rate: RevisionBody) {
  const numerator =
    BigInt(input.originalMinor) * BigInt(rate.terms.rateNumerator) * 10n ** BigInt(bookScale);
  const denominator = BigInt(rate.terms.rateDenominator) * 10n ** BigInt(input.sourceScale);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const rounded = quotient + (2n * remainder >= denominator ? 1n : 0n);
  if (rounded >= minorUnitBound) return failure("InvalidJournal");
  return Effect.succeed({
    exactNumerator: numerator.toString(),
    exactDenominator: denominator.toString(),
    quotientMinor: quotient.toString(),
    remainderNumerator: remainder.toString(),
    roundedMinor: rounded.toString(),
    residualNumerator: (numerator - rounded * denominator).toString(),
    residualDenominator: denominator.toString(),
  } satisfies Amounts);
}

export const captureConversionReview = Effect.fn("exchangeRates.captureConversion")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CaptureInput },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      const payload = yield* toJsonObject(command.input);
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "capture_conversion_review",
        principal.actorId,
        payload,
        ReviewSchema,
      );
      if (request.previous) return request.previous;
      yield* requireRateAccess(transaction, true);
      yield* lockBookForUpdate(transaction, command.scope);
      yield* exactKeys(payload, conversionInputKeys);
      const book = yield* readNativeBook(transaction, command.scope.bookId);
      yield* requireTrimmable(command.input.sourceLocator);
      yield* requireTrimmable(command.input.rationale);
      const rate = yield* readCurrent(
        transaction,
        command.scope.bookId,
        command.input.observationId,
      );
      yield* requireActive(transaction, command.scope.bookId, command.input.observationId);
      if (rate.digest !== command.input.revisionDigest) return yield* failure("StaleDependency");
      if (
        command.input.conversionDate !== rate.terms.effectiveOn ||
        command.input.fromCurrency !== rate.terms.fromCurrency ||
        book.currency !== rate.terms.toCurrency
      ) {
        return yield* failure("StaleDependency");
      }
      const sourceSha256 = yield* readEvidenceSha(
        transaction,
        command.scope.bookId,
        command.input.evidenceId,
      );
      const bound = yield* RateDb.countConversions(transaction, command.scope.bookId);
      if ((bound[0]?.total ?? 0) >= maximumConversions) return yield* unsupported();
      const calculation = yield* convert(command.input, book.currencyScale, rate);
      const now = yield* isoNow(transaction);
      const body = yield* decode(
        ReviewSchema,
        yield* digestBody(transaction, {
          id: newId("conversion"),
          scope: command.scope,
          kind: "synthetic_exchange_conversion_v1",
          input: command.input,
          sourceSha256,
          rate,
          bookBasis: book,
          calculation,
          formula: conversionFormula,
          legalPolicyApproved: false,
          postingSupported: false,
          financialCloseReady: false,
          ...recordMetadata(
            principal.actorId,
            command.idempotencyKey,
            "capture_conversion_review",
            now,
          ),
        }),
      );
      const content = yield* canonicalContent(yield* toJsonObject(body));
      const byteLength = new TextEncoder().encode(content).byteLength;
      if (byteLength > maximumArtifactBytes) return yield* unsupported();
      const sha256 = yield* sha256Hex(content);
      yield* RateDb.insertConversion(transaction, {
        bookId: command.scope.bookId,
        id: body.id,
        observationId: body.rate.observationId,
        revision: body.rate.revision,
        evidenceId: command.input.evidenceId,
        body,
        content,
        sha256,
        byteLength,
      });
      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "capture_conversion_review",
        principal.actorId,
        payload,
      );
      return body;
    },
    "update",
  );
});

function sameBasis(left: BookBasis, right: BookBasis) {
  return (
    left.currency === right.currency &&
    left.currencyScale === right.currencyScale &&
    left.profile === right.profile &&
    left.profileVersion === right.profileVersion &&
    left.writerAuthority === right.writerAuthority &&
    left.writerEpoch === right.writerEpoch
  );
}

export const getConversionReview = Effect.fn("exchangeRates.getConversion")(function* (
  token: string,
  input: { scope: Scope; id: string },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRateAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const row = (yield* RateDb.readConversion(transaction, input.scope.bookId, input.id))[0];
    if (!row) return yield* failure("NotFound");
    const review = yield* decode(ReviewSchema, row.body);
    const rate = yield* readCurrent(transaction, input.scope.bookId, row.observationId);
    const book = yield* readBookBasis(transaction, input.scope.bookId);
    const rateUsability = yield* readUsability(transaction, input.scope.bookId, row.observationId);
    return yield* decode(ReviewViewSchema, {
      review,
      rateUsability,
      dependenciesCurrent:
        rateUsability.state === "active" &&
        rate.digest === review.rate.digest &&
        sameBasis(book, review.bookBasis),
      artifact: {
        content: row.content,
        sha256: row.sha256,
        byteLength: row.byteLength,
        mediaType: "application/json",
      },
    });
  });
});

export const listConversionReviews = Effect.fn("exchangeRates.listConversions")(function* (
  token: string,
  input: { scope: Scope },
) {
  return yield* withBook(token, input.scope, false, function* (transaction) {
    yield* requireRateAccess(transaction, false);
    yield* lockBookForShare(transaction, input.scope);
    const rows = yield* RateDb.listConversions(transaction, input.scope.bookId);
    const items = yield* Effect.forEach(rows, (row) =>
      decode(ReviewSchema, row.body).pipe(
        Effect.map((review) => ({
          id: review.id,
          observationId: review.rate.observationId,
          revisionDigest: review.rate.digest,
          conversionDate: review.input.conversionDate,
          fromCurrency: review.input.fromCurrency,
          originalMinor: review.input.originalMinor,
          sourceScale: review.input.sourceScale,
          roundedMinor: review.calculation.roundedMinor,
          bookCurrency: review.bookBasis.currency,
          bookScale: review.bookBasis.currencyScale,
          createdAt: review.createdAt,
          digest: review.digest,
        })),
      ),
    );
    return yield* decode(ReviewListSchema, { scope: input.scope, items });
  });
});
