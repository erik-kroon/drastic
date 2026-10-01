import * as Accounting from "@open-erp/contracts/accounting";
import * as CashMethod from "@open-erp/contracts/cash-method";
import * as Effect from "effect/Effect";
import * as CashMethodDb from "../../db/commerce/cash-method";
import { failure } from "../failures";
import { decode, requireTableAccess, toJsonObject, withBook } from "./support";
import { admitCashMethodInvoice } from "./cash-invoices";
import { applyAllocation } from "./allocation-reversals";
import { prepareCashYearEnd } from "./cash-year-end";

type Scope = typeof Accounting.Scope.Type;

export const registerCashMethodLine = Effect.fn("commerce.cashMethod.registerLine")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RegisterCashMethodLine },
) {
  return yield* admitCashMethodInvoice(token, command);
});

export const recognizeCashPayment = Effect.fn("commerce.cashMethod.recognizePayment")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RecognizeCashPayment },
) {
  return yield* applyAllocation(token, {
    scope: command.scope,
    id: command.input.allocationPlanId,
    idempotencyKey: command.idempotencyKey,
    input: {
      version: 1,
      planDigest: command.input.planDigest,
      approvalId: command.input.approvalId,
    },
  });
});

export const runCashMethodYearEnd = Effect.fn("commerce.cashMethod.runYearEnd")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: CashMethod.RunCashMethodYearEnd },
) {
  return yield* prepareCashYearEnd(token, command);
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
