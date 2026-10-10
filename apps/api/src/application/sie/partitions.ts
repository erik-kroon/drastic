import * as Contracts from "@open-erp/contracts/sie-partitions";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Partitions from "@open-erp/domain/sie-partitions";
import * as Dimensions from "@open-erp/domain/dimensions";
import { isCalendarDate } from "@open-erp/domain/values";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Db from "../../db/sie-partitions";
import * as SieDb from "../../db/sie-import";
import * as Ledger from "../../db/posting";
import * as Catalogue from "../../db/dimensions";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import { digest } from "../json";
import { isoNow, replay, saveCommand } from "../command-receipts";
import { newId } from "../identifiers";
import { readPlan, sameBalances } from "./historical-shared";
import { minorUnits } from "./source-controls";

type Preview = typeof Sie.SiePreview.Type;

type Input = typeof Contracts.PreparePartition.Type;

type Year = typeof Contracts.YearPartition.Type;

type Member = typeof Contracts.VoucherMember.Type;

export function sourceDate(retained: string) {
  if (!/^\d{8}$/.test(retained)) return undefined;
  const date = `${retained.slice(0, 4)}-${retained.slice(4, 6)}-${retained.slice(6, 8)}`;

  return isCalendarDate(date) ? date : undefined;
}

export const readPartition = Effect.fn("sie.readPartition")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readPartition(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return yield* decode(Contracts.Partition, row.body);
});

const resolveYears = Effect.fn("sie.partitionYears")(function* (
  tx: Transaction,
  scope: Scope,
  preview: Preview,
  input: Input,
) {
  const declarations = preview.records.filter((record) => record.tag === "RAR");

  if (
    declarations.length !== input.fiscalMappings.length ||
    new Set(input.fiscalMappings.map((row) => row.sourceYear)).size !== declarations.length ||
    new Set(input.fiscalMappings.map((row) => row.fiscalYearId)).size !== declarations.length
  )
    return yield* failure("InvalidJournal");
  const years: Array<Year> = [];

  for (const record of declarations) {
    const sourceYear = record.fields[0],
      startsOn = sourceDate(record.fields[1] ?? ""),
      endsOn = sourceDate(record.fields[2] ?? "");

    const mapping = input.fiscalMappings.find((row) => row.sourceYear === sourceYear);

    if (
      !sourceYear ||
      !startsOn ||
      !endsOn ||
      !mapping ||
      record.fields.length !== 3 ||
      startsOn > endsOn ||
      years.some((row) => row.sourceYear === sourceYear)
    )
      return yield* failure("InvalidJournal");
    const native = (yield* Ledger.readFiscalYear(tx, scope.bookId, mapping.fiscalYearId))[0];

    if (!native || native.startsOn !== startsOn || native.endsOn !== endsOn)
      return yield* failure("InvalidJournal");
    years.push({
      sourceYear,
      sourceYearOrdinal: 0,
      fiscalYearId: native.id,
      startsOn,
      endsOn,
      voucherOrdinals: [],
      controls: [],
      objectControls: [],
    });
  }

  years.sort((left, right) => left.startsOn.localeCompare(right.startsOn));

  for (const [ordinal, year] of years.entries()) {
    years[ordinal] = { ...year, sourceYearOrdinal: ordinal };

    if (ordinal > 0 && years[ordinal - 1]!.endsOn >= year.startsOn)
      return yield* failure("InvalidJournal");
  }

  if (preview.controls.some((row) => !years.some((year) => year.sourceYear === row.year)))
    return yield* failure("InvalidJournal");

  return years;
});

function sourceAlias(sourceCode: string, nativeCode: string) {
  return sourceCode === nativeCode ? null : sourceCode;
}

function completeObjectMappings(input: Input, objects: Preview["records"]) {
  return (
    objects.length === input.objectMappings.length &&
    new Set(input.objectMappings.map((row) => `${row.sourceDimensionId}/${row.sourceObjectCode}`))
      .size === input.objectMappings.length &&
    input.objectMappings.every(
      (row) =>
        objects.filter(
          (object) =>
            object.fields[0] === row.sourceDimensionId && object.fields[1] === row.sourceObjectCode,
        ).length === 1,
    )
  );
}

const resolveLines = Effect.fn("sie.partitionLines")(function* (
  tx: Transaction,
  scope: Scope,
  preview: Preview,
  input: Input,
  plan: typeof Sie.SiePlan.Type,
  voucher: typeof Sie.Voucher.Type,
  on: string,
) {
  const dimensions = yield* Catalogue.readEffectiveDimensions(tx, scope.bookId, on);
  const values = yield* Catalogue.readEffectiveDimensionValues(tx, scope.bookId, on);
  const declarations = preview.records.filter((row) => row.tag === "DIM");
  const objects = preview.records.filter((row) => row.tag === "OBJEKT");

  if (
    new Set(input.dimensionMappings.map((row) => row.sourceDimensionId)).size !==
      input.dimensionMappings.length ||
    new Set(input.dimensionMappings.map((row) => row.dimensionCode)).size !==
      input.dimensionMappings.length ||
    declarations.length !== input.dimensionMappings.length ||
    !completeObjectMappings(input, objects)
  )
    return yield* failure("InvalidJournal");

  for (const declaration of declarations) {
    const mapping = input.dimensionMappings.find(
      (row) => row.sourceDimensionId === declaration.fields[0],
    );

    if (
      !mapping ||
      declarations.filter((row) => row.fields[0] === mapping.sourceDimensionId).length !== 1 ||
      !dimensions.some((row) => row.code === mapping.dimensionCode)
    )
      return yield* failure("InvalidJournal");
  }

  const lines: Array<(typeof Contracts.VoucherMember.Type.lines)[number]> = [];

  for (const item of voucher.transactions.filter((row) => row.kind === "TRANS")) {
    const sourceRecord = preview.records.find((row) => row.ordinal === item.recordOrdinal);
    const lineDate = sourceRecord?.fields[3];

    if (!sourceRecord || (lineDate && sourceDate(lineDate) !== on))
      return yield* failure("UnsupportedProfile");

    const mappedAccount = plan.input.mappings.find(
      (row) => row.sourceAccount === item.account,
    )?.accountId;

    const amount = minorUnits(item.amount);

    if (
      !mappedAccount ||
      amount === undefined ||
      amount === 0n ||
      !/^\{.*\}$/.test(item.dimensions)
    )
      return yield* failure("InvalidJournal");
    const fields = item.dimensions.slice(1, -1).trim().split(/\s+/).filter(Boolean);

    if (fields.length % 2 !== 0) return yield* failure("InvalidJournal");
    const assignments: Array<Dimensions.OriginalDimensionAssignment> = [];

    for (let offset = 0; offset < fields.length; offset += 2) {
      const sourceDimensionId = fields[offset]!,
        sourceObjectCode = fields[offset + 1]!;

      if (
        objects.filter(
          (row) => row.fields[0] === sourceDimensionId && row.fields[1] === sourceObjectCode,
        ).length !== 1
      )
        return yield* failure("InvalidJournal");

      const checked = Partitions.resolveObjectAssignment(
        sourceDimensionId,
        sourceObjectCode,
        input.dimensionMappings.map((row) => ({
          sourceDimensionId: row.sourceDimensionId,
          nativeDimensionCode: row.dimensionCode,
        })),
        input.objectMappings.map((row) => ({ ...row, nativeValueCode: row.valueCode })),
        String(sourceRecord.line),
      );

      if (Result.isFailure(checked)) return yield* failure("InvalidJournal");
      const dimension = dimensions.find((row) => row.code === checked.success.nativeDimensionCode);

      const value = values.find(
        (row) =>
          row.dimensionCode === checked.success.nativeDimensionCode &&
          row.code === checked.success.nativeValueCode,
      );

      if (!dimension || !value || assignments.some((row) => row.dimensionCode === dimension.code))
        return yield* failure("InvalidJournal");
      assignments.push({
        dimensionCode: dimension.code,
        dimensionRevision: dimension.revision,
        status: "explicit",
        valueCode: value.code,
        valueRevision: value.revision,
        capturedLabel: value.name,
        exemptionEvidenceId: null,
        sourceValueCode: sourceAlias(sourceObjectCode, value.code),
      });
    }

    lines.push({
      accountId: mappedAccount,
      debitMinor: (amount > 0n ? amount : 0n).toString(),
      creditMinor: (amount < 0n ? -amount : 0n).toString(),
      description: `SIE ${voucher.sourceReference}`,
      originalDimensions: Dimensions.canonicalAssignments(assignments),
    });
  }

  if (
    lines.length < 2 ||
    lines.reduce((sum, row) => sum + BigInt(row.debitMinor) - BigInt(row.creditMinor), 0n) !== 0n
  )
    return yield* failure("InvalidJournal");

  return {
    lines,
    dimensionPolicy: dimensions.map((row) => ({
      dimensionCode: row.code,
      requirement: "optional" as const,
      fixedValueCode: null,
      fixedValueRevision: null,
      defaultValueCode: null,
    })),
  };
});

const yearControls = Effect.fn("sie.completeYearControls")(function* (
  preview: Preview,
  plan: typeof Sie.SiePlan.Type,
  year: Year,
  members: ReadonlyArray<Member>,
) {
  const controls: Array<typeof Contracts.AccountControl.Type> = [];

  const sourceAccounts = new Set([
    ...plan.input.mappings.map((row) => row.sourceAccount),
    ...preview.controls.filter((row) => row.year === year.sourceYear).map((row) => row.account),
    ...preview.vouchers
      .filter((voucher) => members.some((member) => member.ordinal === voucher.ordinal))
      .flatMap((voucher) => voucher.transactions.map((row) => row.account)),
  ]);

  for (const sourceAccount of sourceAccounts) {
    const sourceControls = preview.controls.filter(
      (row) => row.year === year.sourceYear && row.account === sourceAccount,
    );

    const opening = sourceControls.filter((row) => row.kind === "IB"),
      closing = sourceControls.filter((row) => row.kind === "UB");

    const independent = plan.input.openingControls.filter(
      (row) => row.year === year.sourceYear && row.sourceAccount === sourceAccount,
    );

    const accountId = plan.input.mappings.find(
      (row) => row.sourceAccount === sourceAccount,
    )?.accountId;

    const openingMinor = opening[0] ? minorUnits(opening[0].amount) : undefined,
      closingMinor = closing[0] ? minorUnits(closing[0].amount) : undefined;

    if (
      !accountId ||
      opening.length !== 1 ||
      closing.length !== 1 ||
      independent.length !== 1 ||
      openingMinor === undefined ||
      closingMinor === undefined ||
      BigInt(independent[0]!.independentOpeningMinor) !== openingMinor ||
      BigInt(independent[0]!.independentClosingMinor) !== closingMinor
    )
      return yield* failure("InvalidJournal");

    const movement = members
      .flatMap((row) => row.lines)
      .filter((row) => row.accountId === accountId)
      .reduce((sum, row) => sum + BigInt(row.debitMinor) - BigInt(row.creditMinor), 0n);

    const checked = Partitions.assertYearControl({
      sourceYearOrdinal: year.sourceYearOrdinal,
      openingMinor: openingMinor.toString(),
      movementMinor: movement.toString(),
      closingMinor: closingMinor.toString(),
      controlRowPresent: true,
      omissionMeansZeroEstablished: false,
    });

    if (Result.isFailure(checked)) return yield* failure("InvalidJournal");
    controls.push({
      sourceAccount,
      accountId,
      openingMinor: openingMinor.toString(),
      movementMinor: movement.toString(),
      closingMinor: closingMinor.toString(),
    });
  }

  return controls.sort((left, right) => left.sourceAccount.localeCompare(right.sourceAccount));
});

const yearObjectControls = Effect.fn("sie.completeObjectControls")(function* (
  preview: Preview,
  input: Input,
  year: Year,
  members: ReadonlyArray<Member>,
) {
  const records = preview.records.filter(
    (row) => (row.tag === "OIB" || row.tag === "OUB") && row.fields[0] === year.sourceYear,
  );

  if (!preview.records.some((row) => row.tag === "OIB" || row.tag === "OUB")) return [];

  if (!records.length) return yield* failure("InvalidJournal");

  if (preview.profile !== "synthetic_sie4_partition_v1")
    return yield* failure("UnsupportedProfile");
  const controls: Array<typeof Contracts.ObjectControl.Type> = [];

  for (const account of year.controls) {
    for (const object of input.objectMappings) {
      const dimension = input.dimensionMappings.find(
        (row) => row.sourceDimensionId === object.sourceDimensionId,
      );

      if (!dimension) return yield* failure("InvalidJournal");
      const group = `{${object.sourceDimensionId} ${object.sourceObjectCode}}`;

      const selected = records.filter(
        (row) => row.fields[1] === account.sourceAccount && row.fields[2] === group,
      );

      const opening = selected.filter((row) => row.tag === "OIB"),
        closing = selected.filter((row) => row.tag === "OUB");

      const openingMinor = opening[0] ? minorUnits(opening[0].fields[3]!) : undefined;
      const closingMinor = closing[0] ? minorUnits(closing[0].fields[3]!) : undefined;

      if (
        opening.length !== 1 ||
        closing.length !== 1 ||
        openingMinor === undefined ||
        closingMinor === undefined
      )
        return yield* failure("InvalidJournal");

      const movementMinor = members
        .flatMap((row) => row.lines)
        .filter(
          (row) =>
            row.accountId === account.accountId &&
            row.originalDimensions?.some(
              (assignment) =>
                assignment.dimensionCode === dimension.dimensionCode &&
                assignment.valueCode === object.valueCode,
            ),
        )
        .reduce((sum, row) => sum + BigInt(row.debitMinor) - BigInt(row.creditMinor), 0n);

      if (openingMinor + movementMinor !== closingMinor) return yield* failure("InvalidJournal");
      controls.push({
        sourceAccount: account.sourceAccount,
        accountId: account.accountId,
        ...object,
        dimensionCode: dimension.dimensionCode,
        openingMinor: openingMinor.toString(),
        movementMinor: movementMinor.toString(),
        closingMinor: closingMinor.toString(),
      });
    }

    for (const dimension of input.dimensionMappings) {
      const selected = controls.filter(
        (row) =>
          row.accountId === account.accountId && row.dimensionCode === dimension.dimensionCode,
      );

      if (
        selected.reduce((sum, row) => sum + BigInt(row.openingMinor), 0n) !==
          BigInt(account.openingMinor) ||
        selected.reduce((sum, row) => sum + BigInt(row.closingMinor), 0n) !==
          BigInt(account.closingMinor)
      )
        return yield* failure("InvalidJournal");
    }
  }

  if (controls.length * 2 !== records.length) return yield* failure("InvalidJournal");

  return controls;
});

export const prepareSiePartition = Effect.fn("sie.preparePartition")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Input },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, input, idempotencyKey } = command;
      const operation = "prepare_sie_partition";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Contracts.Partition,
      );

      if (request.previous) return request.previous;
      const previewRow = (yield* SieDb.readPreview(tx, scope.bookId, input.previewId))[0];

      if (!previewRow) return yield* failure("NotFound");
      const preview = yield* decode(Sie.SiePreview, previewRow.body);
      const source = (yield* SieDb.readSource(tx, scope.bookId, preview.occurrenceId))[0];
      const plan = yield* readPlan(tx, scope, input.sourcePlanId);

      if (
        !source ||
        !source.sourceSystem.startsWith("synthetic_") ||
        plan.input.sourceKind !== "synthetic"
      )
        return yield* failure("UnsupportedProfile");

      if (
        !preview.ready ||
        preview.digest !== input.previewDigest ||
        plan.digest !== input.sourcePlanDigest ||
        plan.previewId !== preview.id
      )
        return yield* failure("StaleDependency");

      if ((yield* Db.readForPreview(tx, scope.bookId, preview.id)).length)
        return yield* failure("AlreadyPosted");
      const years = yield* resolveYears(tx, scope, preview, input);

      if (
        preview.records.some(
          (row) =>
            (row.tag === "OIB" || row.tag === "OUB") &&
            !years.some((year) => year.sourceYear === row.fields[0]),
        )
      )
        return yield* failure("InvalidJournal");
      const vouchers: Array<Member> = [];

      for (const voucher of preview.vouchers) {
        const on = sourceDate(voucher.date);

        if (!on) return yield* failure("InvalidJournal");

        const placed = Partitions.partitionVoucher(
          on,
          years.map((year) => ({
            sourceYearOrdinal: year.sourceYearOrdinal,
            fiscalStartOn: year.startsOn,
            fiscalEndOn: year.endsOn,
          })),
          String(voucher.recordOrdinal),
        );

        if (Result.isFailure(placed)) return yield* failure("InvalidJournal");

        const scopedIdentity = Partitions.scopeVoucherIdentity({
          fiscalYearOrdinal: placed.success,
          series: voucher.series,
          number: voucher.number,
        });

        if (vouchers.some((row) => row.scopedIdentity === scopedIdentity))
          return yield* failure("InvalidJournal");
        const resolved = yield* resolveLines(tx, scope, preview, input, plan, voucher, on);
        vouchers.push({
          ordinal: voucher.ordinal,
          sourceYearOrdinal: placed.success,
          scopedIdentity,
          accountingOn: on,
          sourceDigest: yield* digest(voucher),
          historyDigest: yield* digest(voucher.transactions.filter((row) => row.kind !== "TRANS")),
          sourceReference: voucher.sourceReference,
          ...resolved,
        });
      }

      for (const year of years) {
        const members = vouchers.filter((row) => row.sourceYearOrdinal === year.sourceYearOrdinal);

        let completed = {
          ...year,
          voucherOrdinals: members.map((row) => row.ordinal),
          controls: yield* yearControls(preview, plan, year, members),
        };

        completed = {
          ...completed,
          objectControls: yield* yearObjectControls(preview, input, completed, members),
        };
        years[year.sourceYearOrdinal] = completed;
        const prior = years[year.sourceYearOrdinal - 1];

        if (
          prior &&
          !sameBalances(
            new Map(
              prior.objectControls.map((row) => [
                `${row.accountId}/${row.dimensionCode}/${row.valueCode}`,
                BigInt(row.closingMinor),
              ]),
            ),
            new Map(
              completed.objectControls.map((row) => [
                `${row.accountId}/${row.dimensionCode}/${row.valueCode}`,
                BigInt(row.openingMinor),
              ]),
            ),
          )
        )
          return yield* failure("InvalidJournal");

        if (
          prior &&
          !sameBalances(
            new Map(prior.controls.map((row) => [row.accountId, BigInt(row.closingMinor)])),
            new Map(completed.controls.map((row) => [row.accountId, BigInt(row.openingMinor)])),
          )
        )
          return yield* failure("StaleDependency");
      }

      const ordered = vouchers
        .slice()
        .sort(
          (left, right) =>
            left.sourceYearOrdinal - right.sourceYearOrdinal || left.ordinal - right.ordinal,
        );

      const body = {
        id: newId("siepartition"),
        scope,
        input,
        sourceSha256: preview.sourceSha256,
        years,
        vouchers: ordered,
        membershipDigest: yield* digest(ordered),
        createdBy: principal.actorId,
        createdAt: yield* isoNow(tx),
      };

      const result = yield* decode(Contracts.Partition, { ...body, digest: yield* digest(body) });
      yield* Db.insertPartition(tx, scope.bookId, result);
      yield* saveCommand(
        tx,
        scope,
        idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        result,
      );

      return result;
    },
    "update",
  );
});

export const getSiePartition = Effect.fn("sie.getPartition")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    return yield* readPartition(tx, command.scope, command.id);
  });
});
