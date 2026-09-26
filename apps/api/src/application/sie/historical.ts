import * as Accounting from "@open-erp/contracts/accounting";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Effect from "effect/Effect";
import { failure } from "../failures";
import { withAdmittedPrincipal, type VerifiedPrincipal } from "../identity";
import { databaseFailure, type Transaction } from "../../db/transaction";

type Scope = typeof Accounting.Scope.Type;
type Principal = VerifiedPrincipal;
type RefreshOpening = typeof Historical.RefreshOpening.Type;
type PrepareOpening = typeof Historical.PrepareOpening.Type;
type PrepareSourceVoucher = typeof Historical.PrepareSourceVoucher.Type;
type SelectBasis = typeof Historical.SelectBasis.Type;
type AdmitItems = typeof Historical.AdmitItems.Type;
type FenceAction = "pause" | "resume";
type ApprovedItem = {
  readonly changeSetId: string;
  readonly planDigest: string;
  readonly approvalId: string;
};

function withHistoricalBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
) {
  return withAdmittedPrincipal({ token }, scope, { operatorOnly }, (transaction, principal) =>
    operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
  );
}

function unsupported() {
  return failure("UnsupportedProfile");
}

export const refreshOpening = Effect.fn("historical.refreshOpening")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; id: string; input: RefreshOpening },
) {
  return yield* withHistoricalBook(token, command.scope, true, () => unsupported());
});

export const compareSieClosing = Effect.fn("historical.compareSieClosing")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const prepareOpening = Effect.fn("historical.prepareOpening")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: PrepareOpening },
) {
  return yield* withHistoricalBook(token, command.scope, true, () => unsupported());
});

export const getFinancialWorkspace = Effect.fn("historical.getFinancialWorkspace")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const prepareFinancialVoucher = Effect.fn("historical.prepareFinancialVoucher")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; id: string; input: PrepareSourceVoucher },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const admitItems = Effect.fn("historical.admitItems")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; id: string; input: AdmitItems },
) {
  return yield* withHistoricalBook(token, command.scope, true, () => unsupported());
});

export const getPlanItems = Effect.fn("historical.getPlanItems")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const getItems = Effect.fn("historical.getItems")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const listBases = Effect.fn("historical.listBases")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const selectBasis = Effect.fn("historical.selectBasis")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: SelectBasis },
) {
  return yield* withHistoricalBook(token, command.scope, true, () => unsupported());
});

export const getBasis = Effect.fn("historical.getBasis")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const postOpening = Effect.fn("historical.postOpening")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    id: string;
    planDigest: string;
    approvalId: string;
  },
) {
  return yield* withHistoricalBook(token, command.scope, true, () => unsupported());
});

export const startFinancialRun = Effect.fn("historical.startFinancialRun")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    id: string;
    fiscalYearId: string;
    planDigest: string;
  },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const getFinancialRun = Effect.fn("historical.getFinancialRun")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const advanceFinancialRun = Effect.fn("historical.advanceFinancialRun")(function* (
  token: string,
  command: {
    scope: Scope;
    idempotencyKey: string;
    id: string;
    input: {
      readonly fence: string;
      readonly planDigest: string;
      readonly firstOrdinal: number;
      readonly items: ReadonlyArray<ApprovedItem>;
    };
  },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});

export const reclaimFinancialRun = Effect.fn("historical.reclaimFinancialRun")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; id: string; action: FenceAction },
) {
  return yield* withHistoricalBook(token, command.scope, false, () => unsupported());
});
