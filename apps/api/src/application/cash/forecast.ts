import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-forecast";
import * as Forecast from "@open-erp/domain/cash-forecast";
import * as Effect from "effect/Effect";
import * as BankDb from "../../db/banking/shared";
import * as ForecastDb from "../../db/cash/forecast";
import * as Bank from "../banking/shared";
import { readEvidenceReference, requireTableAccess } from "../commerce/support";
import { failure } from "../failures";
import { digest, isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import { readCashBasisInTransaction } from "./basis";

type Scope = typeof Accounting.Scope.Type;

export const captureCashForecast = Effect.fn("cash.forecast.capture")(function* (
  token: string,
  command: {
    readonly scope: Scope;
    readonly idempotencyKey: string;
    readonly input: typeof Cash.CaptureCashForecast.Type;
  },
) {
  return yield* Bank.withBook(token, command.scope, false, "update", (transaction, principal) =>
    Effect.gen(function* () {
      yield* requireTableAccess(transaction, ["cash_forecasts", "command_receipts"], true);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "update"))[0];

      if (!book) return yield* failure("Forbidden");
      const replayed = yield* replay(
        transaction, command.scope, command.idempotencyKey, "capture_cash_forecast",
        principal.actorId, yield* Bank.toJsonObject(command.input), Cash.CashForecastSnapshot,
      );

      if (replayed.previous) return replayed.previous;
      const view = yield* readCashBasisInTransaction(transaction, command.scope, book, command.input.basisId);
      const basis = view.basis;

      if (basis.digest !== command.input.basisDigest || !view.dependenciesCurrent)
        return yield* failure("StaleDependency");

      const expected = new Map(command.input.expectedDates.map((entry) => [entry.invoiceId, entry.expectedOn]));
      const invoiceIds = new Set(basis.contributions.map((entry) => entry.invoiceId));

      if (expected.size !== command.input.expectedDates.length) return yield* failure("InvalidJournal");

      for (const assumption of command.input.expectedDates) {
        if (!invoiceIds.has(assumption.invoiceId)) return yield* failure("NotFound");
        const reference = yield* readEvidenceReference(transaction, command.scope.bookId, assumption.review.evidenceId);

        if (reference.sha256 !== assumption.review.sha256) return yield* failure("StaleDependency");
      }

      const calculationInput = yield* Bank.decode(Forecast.ForecastCalculationInput, {
        asOf: basis.asOf, horizonDays: command.input.horizonDays, bufferMinor: command.input.bufferMinor,
        openingMinor: basis.opening.totalMinor,
        events: basis.contributions.map((entry) => ({
          invoiceId: entry.invoiceId, direction: entry.direction, amountMinor: entry.amountMinor,
          inclusion: entry.inclusion, reason: entry.reason, dueOn: entry.dueOn,
          expectedOn: expected.get(entry.invoiceId) ?? entry.expectedOn,
        })),
      });
      const calculated = Forecast.calculateCashForecast(calculationInput);
      const captured = yield* Bank.toJsonObject({
        id: newId("cash_forecast"), scope: command.scope, actorId: principal.actorId,
        createdAt: yield* isoNow(transaction), calculatorVersion: "known_items_exact_v1",
        basisId: basis.id, basisDigest: basis.digest, input: command.input,
        asOf: basis.asOf, recordedCutoff: basis.recordedCutoff,
        horizonDays: command.input.horizonDays,
        endsOn: Forecast.forecastCalendarOffset(basis.asOf, command.input.horizonDays - 1),
        label: "known_items", companyCoverage: "incomplete",
        quality: {
          opening: basis.opening.status, sourceCoverage: "incomplete", dependenciesAtCapture: "current",
          datedContributions: basis.foreignObligations.length > 0 || calculated.contributions.some(
            (entry) => entry.disposition === "blocked" || entry.disposition === "undated",
          ) ? "incomplete" : "qualified",
        },
        result: calculated.result, contributions: calculated.contributions,
        foreignObligations: basis.foreignObligations,
      });
      const body = yield* Bank.toJsonObject({ ...captured, digest: yield* digest(captured) });
      const forecast = yield* Bank.decode(Cash.CashForecastSnapshot, body);
      const content = yield* Bank.canonicalText(body);
      const byteLength = Bank.byteLength(content);

      if (byteLength > 8388608) return yield* failure("UnsupportedProfile");
      yield* ForecastDb.insertForecast(transaction, command.scope.bookId, forecast.id, basis.id, {
        body, content, sha256: yield* sha256Hex(content), byteLength,
      });
      yield* saveCommand(transaction, command.scope, command.idempotencyKey, replayed.expected,
        "capture_cash_forecast", principal.actorId, body);

      return forecast;
    }),
  );
});

export const getCashForecast = Effect.fn("cash.forecast.get")(function* (
  token: string,
  command: { readonly scope: Scope; readonly id: string },
) {
  return yield* Bank.withBook(token, command.scope, false, "share", (transaction) =>
    Effect.gen(function* () {
      yield* requireTableAccess(transaction, ["cash_forecasts"], false);
      const book = (yield* BankDb.lockBook(transaction, command.scope.bookId, "share"))[0];

      if (!book) return yield* failure("Forbidden");
      const row = (yield* ForecastDb.readForecast(transaction, command.scope.bookId, command.id))[0];

      if (!row) return yield* failure("NotFound");
      const forecast = yield* Bank.decode(Cash.CashForecastSnapshot, row.body);
      const basis = yield* readCashBasisInTransaction(transaction, command.scope, book, forecast.basisId);

      if (basis.basis.digest !== forecast.basisDigest) return yield* failure("StaleDependency");

      return yield* Bank.decode(Cash.CashForecastView, {
        forecast, dependenciesCurrent: basis.dependenciesCurrent,
        dependencyStatus: basis.dependencyStatus, dependencyReason: basis.dependencyReason,
        artifact: { content: row.content, sha256: row.sha256, byteLength: row.byteLength, mediaType: "application/json" },
      });
    }),
  );
});
