import * as V from "@open-erp/contracts/variable-pay-review";
import * as Inputs from "@open-erp/contracts/payroll-inputs";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { equalJson } from "@open-erp/domain/canonicalization";
import type { Transaction } from "../../db/transaction";
import { type Scope } from "../commerce/support";
import { failure } from "../failures";
import { readSourceBytesInTransaction } from "../source-retention";

type Row = (typeof V.VariablePaySourceProfile.Type.rows)[number];

export function variableOccurrenceKey(employeeId: string, row: Row) {
  return JSON.stringify([
    employeeId,
    row.scheduleDate,
    row.kind,
    row.startLocal,
    row.endLocal,
    row.breakMinutes,
  ]);
}

function localMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);

  return hours! * 60 + minutes!;
}

export const readVariableSource = Effect.fn("variablePay.readSource")(function* (
  tx: Transaction,
  scope: Scope,
  occurrenceId: string,
) {
  const source = yield* readSourceBytesInTransaction(tx, scope, occurrenceId);

  const parsed = yield* Effect.try({
    try: () =>
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source.bytes)),
    catch: () => failure("UnsupportedProfile"),
  });

  const profile = yield* Schema.decodeUnknownEffect(V.VariablePaySourceProfile)(parsed).pipe(
    Effect.mapError(() => failure("UnsupportedProfile")),
  );

  if (
    source.occurrence.mediaType !== "application/json" ||
    profile.sourceSystem !== source.occurrence.sourceSystem ||
    profile.sourceAccountId !== source.occurrence.sourceAccountId ||
    profile.occurrenceKey !== source.occurrence.occurrenceKey
  )
    return yield* failure("UnsupportedProfile");
  const identities = new Set<string>();
  const occurrences = new Set<string>();

  for (const row of profile.rows) {
    const minutes =
      localMinutes(row.endLocal) - localMinutes(row.startLocal) - Number(row.breakMinutes);

    if (
      row.scheduleDate.slice(0, 7) !== profile.month ||
      row.economicOccurrence !== variableOccurrenceKey(profile.employeeId, row) ||
      identities.has(row.rowIdentity) ||
      occurrences.has(row.economicOccurrence) ||
      !Number.isSafeInteger(minutes) ||
      minutes <= 0 ||
      BigInt(minutes) !== BigInt(row.unitsMinor)
    )
      return yield* failure("UnsupportedProfile");
    identities.add(row.rowIdentity);
    occurrences.add(row.economicOccurrence);
  }

  for (const [index, row] of profile.rows.entries()) {
    for (const other of profile.rows.slice(index + 1)) {
      if (
        row.scheduleDate === other.scheduleDate &&
        localMinutes(row.startLocal) < localMinutes(other.endLocal) &&
        localMinutes(other.startLocal) < localMinutes(row.endLocal)
      )
        return yield* failure("UnsupportedProfile");
    }
  }

  return { profile, occurrence: source.occurrence };
});

export const requireVariableSourceBinding = Effect.fn("variablePay.sourceBinding")(function* (
  submitted: typeof Inputs.PayrollInput.Type,
  profile: typeof V.VariablePaySourceProfile.Type,
) {
  const basis = submitted.input.basis;

  if (
    basis.kind !== "variable" ||
    profile.employeeId !== submitted.input.employeeId ||
    profile.month !== submitted.input.month ||
    profile.paymentOn.slice(0, 7) < profile.month ||
    basis.work.length !== profile.rows.length
  )
    return yield* failure("UnsupportedProfile");

  if (
    basis.earnings.length !==
      profile.rows.filter((row) => ["worked", "overtime"].includes(row.kind)).length ||
    basis.earnings.some(
      (row) =>
        row.componentKind !== "cash" ||
        !row.withholdingBase ||
        !row.contributionBase ||
        !row.holidayAccrualBase,
    )
  )
    return yield* failure("UnsupportedProfile");

  for (const row of profile.rows) {
    const work = basis.work.filter((item) => item.sourceId === row.sourceId);

    if (
      work.length !== 1 ||
      !equalJson(work[0], {
        sourceId: row.sourceId,
        kind: row.kind,
        scheduleDate: row.scheduleDate,
        unitsMinor: row.unitsMinor,
      })
    )
      return yield* failure("UnsupportedProfile");

    if (["worked", "overtime"].includes(row.kind)) {
      const earning = basis.earnings.filter((item) => item.sourceIdentity === row.sourceId);

      if (
        earning.length !== 1 ||
        earning[0]?.rateMinor !== row.rateMinor ||
        BigInt(earning[0].unitsNumerator) * 60n !==
          BigInt(row.unitsMinor) * BigInt(earning[0].unitsDenominator)
      )
        return yield* failure("UnsupportedProfile");
    }
  }

  return basis;
});
