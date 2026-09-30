import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Effect from "effect/Effect";
import * as CashMethodDb from "../../db/commerce/cash-method";
import { failure } from "../failures";
import { decode, requireTableAccess, toJsonObject, withBook } from "./support";

type Scope = typeof Accounting.Scope.Type;

// The current invoice owner admits an invoice only after an accrual voucher has
// posted. A cash-method registration over that invoice would count the same
// revenue/tax twice. A caller-supplied amount or evidence ID also cannot prove
// that cash was finally allocated. Until commerce owns unposted cash-method
// documents and derives recognition from retained final allocations, no write
// operation in this API is admissible.
function refuseUnqualifiedWrite(token: string, scope: Scope) {
  return withBook(
    token,
    scope,
    true,
    function* () {
      return yield* failure("UnsupportedProfile");
    },
    "update",
  );
}

export const registerCashMethodLine = Effect.fn("commerce.cashMethod.registerLine")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RegisterCashMethodLine },
) {
  return yield* refuseUnqualifiedWrite(token, command.scope);
});

export const recognizeCashPayment = Effect.fn("commerce.cashMethod.recognizePayment")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RecognizeCashPayment },
) {
  return yield* refuseUnqualifiedWrite(token, command.scope);
});

export const runCashMethodYearEnd = Effect.fn("commerce.cashMethod.runYearEnd")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RunCashMethodYearEnd },
) {
  return yield* refuseUnqualifiedWrite(token, command.scope);
});

// Previously retained rows remain inspectable. The response derives both
// balances from the row's exact prefixes, rather than accepting a balance
// supplied by a client or treating recognition as payment.
export const readCashMethodLine = Effect.fn("commerce.cashMethod.readLine")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.ReadCashMethodLine },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (transaction, principal) {
      yield* requireTableAccess(transaction, CashMethodDb.cashMethodTables, false);

      const line = (yield* CashMethodDb.readLine(
        transaction,
        command.scope.bookId,
        command.input.lineId,
      ))[0];

      if (!line) return yield* failure("NotFound");

      const recognized = BigInt(line.recognizedGrossMinor);
      const paid = BigInt(line.paidGrossMinor);
      const commercial = BigInt(line.originalGrossMinor) - BigInt(line.creditedGrossMinor) - paid;

      const yearEndRecognized =
        (yield* CashMethodDb.readYearEndForLine(transaction, command.scope.bookId, line.id))[0]
          ?.present === true;

      return yield* decode(
        CashMethod.CashMethodLineView,
        yield* toJsonObject({
          lineId: line.id,
          invoiceId: line.invoiceId,
          sourceLineId: line.sourceLineId,
          direction: line.direction,
          currency: line.currency,
          originalGrossMinor: line.originalGrossMinor,
          creditedGrossMinor: line.creditedGrossMinor,
          paidGrossMinor: line.paidGrossMinor,
          recognizedGrossMinor: line.recognizedGrossMinor,
          commercialUnpaidMinor: commercial.toString(),
          recognizedUnpaidMinor: (recognized - paid).toString(),
          profileWitness: line.profileWitness,
          yearEndRecognized,
          receipt: {
            key: command.idempotencyKey,
            operation: "read_cash_method_line",
            actorId: principal.actorId,
          },
        }),
      );
    },
    "share",
  );
});
