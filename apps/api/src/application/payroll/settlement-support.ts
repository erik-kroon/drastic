import * as Accounting from "@open-erp/contracts/accounting";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as Db from "../../db/payroll/settlements";
import * as Foundation from "../../db/payroll-foundation";
import type { Transaction } from "../../db/transaction";
import {
  decode,
  requireTableAccess,
  toJsonObject,
  type Scope,
  type Principal,
} from "../commerce/support";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { failure } from "../failures";

export const recordMetadata = {
  scope: Accounting.Scope,
  digest: Accounting.Digest,
  createdAt: Schema.String,
  createdBy: Accounting.Identifier,
  receipt: Settlement.SettlementReview.fields.receipt,
};

export const ClaimRecord = Schema.Struct({ ...Settlement.RecoveryClaim.fields, ...recordMetadata });

export const InstructionRecord = Schema.Struct({
  ...Settlement.AdjustmentInstruction.fields,
  ...recordMetadata,
});

export const AllocationRecord = Schema.Struct({
  id: Accounting.Identifier,
  claimId: Accounting.Identifier,
  executionId: Accounting.Identifier,
  amountMinor: Accounting.MinorUnits,
  payrollRunId: Schema.optional(Accounting.Identifier),
  ...recordMetadata,
});

export const ReportingCorrection = Schema.Struct({
  id: Accounting.Identifier,
  paidEventId: Accounting.Identifier,
  executionId: Accounting.Identifier,
  kind: Settlement.AdjustmentKind,
  grossCashMinor: Accounting.MinorUnits,
  withholdingMinor: Accounting.MinorUnits,
  contributionBaseMinor: Accounting.MinorUnits,
  contributionDeltaMinor: Accounting.SignedMinorUnits,
  specificationNumber: Schema.String,
  ...recordMetadata,
});

export const requireSettlementAccess = Effect.fn("payroll.settlementAccess")(function* (
  tx: Transaction,
  scope: Scope,
  actorId: string,
  write: boolean,
) {
  if ((yield* Foundation.readPayrollAccess(tx, scope.bookId, actorId)).length !== 1)
    return yield* failure("Forbidden");
  yield* requireTableAccess(tx, Db.settlementTables, write);
});

export function readRetained<A>(
  tx: Transaction,
  scope: Scope,
  table: Parameters<typeof Db.readRecord>[2],
  id: string,
  schema: Schema.Decoder<A>,
) {
  return Effect.gen(function* () {
    const row = (yield* Db.readRecord(tx, scope.bookId, table, id))[0];

    if (!row) return yield* failure("NotFound");
    const body = Object.fromEntries(Object.entries(row.body).filter(([key]) => key !== "digest"));

    if (row.body.id !== id || (yield* digest(body)) !== row.body.digest)
      return yield* failure("StaleDependency");

    return yield* decode(schema, row.body);
  });
}

export type RetainedFields<A> = {
  -readonly [K in keyof Omit<A, "scope" | "digest" | "createdAt" | "createdBy" | "receipt">]: Omit<
    A,
    "scope" | "digest" | "createdAt" | "createdBy" | "receipt"
  >[K];
};

export function seal<A>(
  tx: Transaction,
  scope: Scope,
  principal: Principal,
  operation: string,
  key: string,
  schema: Schema.Decoder<A>,
  fields: RetainedFields<A>,
) {
  return Effect.gen(function* () {
    const payload = yield* toJsonObject(fields);

    const body = {
      ...payload,
      scope,
      createdBy: principal.actorId,
      createdAt: yield* isoNow(tx),
      receipt: { key, operation, actorId: principal.actorId },
    };

    const parsed = yield* decode(
      schema,
      yield* toJsonObject({ ...body, digest: yield* digest(body) }),
    );

    const retained = yield* toJsonObject(parsed);

    const canonical = Object.fromEntries(
      Object.entries(retained).filter(([name]) => name !== "digest"),
    );

    return yield* decode(
      schema,
      yield* toJsonObject({ ...canonical, digest: yield* digest(canonical) }),
    );
  });
}

export function persist(
  tx: Transaction,
  table: Parameters<typeof Db.insertRecord>[1],
  result: { readonly id: string; readonly scope: Scope; readonly digest: string },
) {
  return Effect.gen(function* () {
    yield* Db.insertRecord(tx, table, result, yield* toJsonObject(result));
  });
}

export const claimBalance = Effect.fn("payroll.claimBalance")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const claim = yield* readRetained(tx, scope, "payroll_recovery_claims", id, ClaimRecord);
  const allocations = [];

  for (const row of yield* Db.readRecords(tx, scope.bookId, "payroll_recovery_allocations")) {
    const allocation = yield* decode(AllocationRecord, row.body);

    if (allocation.claimId === id) allocations.push(allocation);
  }

  const received = allocations.reduce((sum, row) => sum + BigInt(row.amountMinor), 0n);
  const remaining = BigInt(claim.receivableMinor ?? claim.claimedGrossMinor) - received;

  if (remaining < 0n) return yield* failure("StaleDependency");

  return {
    claim,
    allocations,
    remaining: remaining.toString(),
    digest: yield* digest({ claim, allocations }),
  };
});
