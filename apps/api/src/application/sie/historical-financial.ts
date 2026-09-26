import * as Accounting from "@open-erp/contracts/accounting";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Db from "../../db/historical";
import * as Ledger from "../../db/posting";
import * as SourceDb from "../../db/sie-import";
import type { Transaction } from "../../db/transaction";
import { decode, withBook, type Scope } from "../commerce/support";
import { failure } from "../failures";
import {
  createEvidenceInTransaction,
  prepareJournalInTransaction,
  executeChangeInTransaction,
  replay,
  saveCommand,
  isoNow,
  newId,
  digest,
} from "../posting";
import {
  readPlan,
  readBasis,
  mappedControls,
  sameBalances,
  type Identified,
  type Command,
} from "./historical-shared";
import { minorUnits } from "./source-controls";

type Voucher = (typeof Sie.SiePreview.Type.vouchers)[number];

const readRun = Effect.fn("historical.readRun")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const row = (yield* Db.readRun(tx, scope.bookId, id))[0];

  if (!row) return yield* failure("NotFound");

  return row;
});

const readSource = Effect.fn("historical.readSource")(function* (
  tx: Transaction,
  scope: Scope,
  id: string,
) {
  const source = (yield* SourceDb.readRun(tx, scope.bookId, id))[0];

  if (!source) return yield* failure("NotFound");
  const plan = yield* readPlan(tx, scope, source.planId);
  const rows = yield* Db.readSourceVouchers(tx, scope.bookId, id);

  const vouchers = yield* Schema.decodeUnknownEffect(Sie.SiePreview.fields.vouchers)(
    rows.map((row) => row.body),
  ).pipe(Effect.mapError(() => failure("InternalError")));

  return { source, plan, vouchers };
});

function lease(now: string) {
  return new Date(Date.parse(now) + 900_000).toISOString();
}

function sourceDate(voucher: Voucher) {
  if (!/^\d{8}$/.test(voucher.date)) return undefined;
  const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;
  const parsed = Date.parse(`${date}T00:00:00Z`);

  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

const linesFor = Effect.fn("historical.sourceLines")(function* (
  plan: typeof Sie.SiePlan.Type,
  voucher: Voucher,
) {
  const lines: Array<(typeof Accounting.PrepareJournal.Type.lines)[number]> = [];

  for (const item of voucher.transactions.filter((row) => row.kind === "TRANS")) {
    const account = plan.input.mappings.find(
      (row) => row.sourceAccount === item.account,
    )?.accountId;

    const amount = minorUnits(item.amount);

    if (!account || amount === undefined || amount === 0n || item.dimensions !== "{}")
      return yield* failure("InvalidJournal");
    lines.push({
      accountId: account,
      debitMinor: (amount > 0n ? amount : 0n).toString(),
      creditMinor: (amount < 0n ? -amount : 0n).toString(),
      description: `SIE ${voucher.sourceReference}`,
    });
  }

  return lines;
});

const viewRun = Effect.fn("historical.viewRun")(function* (
  tx: Transaction,
  scope: Scope,
  run: Db.RunRow,
) {
  const items = yield* Db.readPostings(tx, scope.bookId, run.id);

  return yield* decode(Historical.Run, { ...run, items });
});

const checkCursor = Effect.fn("historical.checkCursor")(function* (
  tx: Transaction,
  run: Db.RunRow,
  input: { fence: string; planDigest: string; ordinal: number },
) {
  const now = yield* isoNow(tx);

  if (
    run.status !== "running" ||
    Date.parse(run.leaseUntil) <= Date.parse(now) ||
    run.fence !== input.fence ||
    run.planDigest !== input.planDigest ||
    run.nextOrdinal !== input.ordinal
  )
    return yield* failure("StaleDependency");
});

export const startFinancialRun = Effect.fn("historical.startFinancialRun")(function* (
  token: string,
  command: Command & { fiscalYearId: string; planDigest: string },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, idempotencyKey } = command;
      const operation = "start_sie_financial_run";

      const input = {
        sourceRunId: id,
        fiscalYearId: command.fiscalYearId,
        planDigest: command.planDigest,
      };

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        input,
        Historical.RunStart,
      );

      if (request.previous) return request.previous;
      const { source, plan, vouchers } = yield* readSource(tx, scope, id);

      if (source.status !== "staged") return yield* failure("StaleDependency");
      const basis = yield* readBasis(tx, scope, command.fiscalYearId);
      const year = (yield* Ledger.readFiscalYear(tx, scope.bookId, command.fiscalYearId))[0];

      if (
        !year ||
        basis.mode !== "full_history" ||
        basis.sourcePlanId !== plan.id ||
        basis.sourceDigest !== command.planDigest ||
        plan.digest !== command.planDigest
      )
        return yield* failure("ApprovalRequired");

      if (
        (yield* Db.readRunForSource(tx, scope.bookId, id)).length ||
        (yield* Db.readPostedDates(tx, scope.bookId)).some((row) => row.fiscalYearId === year.id)
      )
        return yield* failure("AlreadyPosted");

      if (
        vouchers.length !== plan.voucherCount ||
        new Set(vouchers.map((v) => v.sourceReference)).size !== vouchers.length ||
        vouchers.some(
          (v, index) =>
            v.ordinal !== index + 1 ||
            !sourceDate(v) ||
            sourceDate(v)! < year.startsOn ||
            sourceDate(v)! > year.endsOn,
        )
      )
        return yield* failure("InvalidJournal");
      const sourceYears = [...new Set(plan.input.openingControls.map((c) => c.year))];

      if (sourceYears.length !== 1) return yield* failure("UnsupportedProfile");
      const movements = new Map<string, bigint>();

      for (const voucher of vouchers) {
        yield* linesFor(plan, voucher);

        for (const item of voucher.transactions.filter((row) => row.kind === "TRANS")) {
          const amount = minorUnits(item.amount);

          if (
            amount === undefined ||
            !plan.input.openingControls.some((c) => c.sourceAccount === item.account)
          )
            return yield* failure("InvalidJournal");
          movements.set(item.account, (movements.get(item.account) ?? 0n) + amount);
        }
      }

      if (
        plan.input.openingControls.some(
          (c) =>
            (movements.get(c.sourceAccount) ?? 0n) !==
            BigInt(c.independentClosingMinor) - BigInt(c.independentOpeningMinor),
        )
      )
        return yield* failure("InvalidJournal");
      const prior = yield* Db.readBalances(tx, scope.bookId, year.startsOn, false);

      if (
        !sameBalances(
          mappedControls(plan, "opening"),
          new Map(prior.map((row) => [row.accountId, BigInt(row.amount)])),
        )
      )
        return yield* failure("InvalidJournal");

      const run: Db.RunRow = {
        id: newId("siefin"),
        sourceRunId: id,
        fiscalYearId: year.id,
        planDigest: plan.digest,
        nextOrdinal: 1,
        fence: "1",
        status: vouchers.length === 0 ? "posted" : "running",
        leaseUntil: lease(yield* isoNow(tx)),
      };

      yield* Db.insertRun(tx, scope.bookId, run);

      const result = yield* decode(Historical.RunStart, {
        ...run,
        sourceYear: sourceYears[0] ?? "",
      });

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

export const getFinancialRun = Effect.fn("historical.getFinancialRun")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    return yield* viewRun(tx, command.scope, yield* readRun(tx, command.scope, command.id));
  });
});

export const getFinancialWorkspace = Effect.fn("historical.getFinancialWorkspace")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    if (!(yield* SourceDb.readRun(tx, command.scope.bookId, command.id))[0])
      return yield* failure("NotFound");
    const found = (yield* Db.readRunForSource(tx, command.scope.bookId, command.id))[0];

    if (!found) return { run: null, nextProposal: null };
    const run = yield* readRun(tx, command.scope, found.id);
    const proposal = (yield* Db.readProposal(tx, command.scope.bookId, run.id, run.nextOrdinal))[0];

    return yield* decode(Historical.FinancialWorkspace, {
      run: yield* viewRun(tx, command.scope, run),
      nextProposal: proposal?.plan ?? null,
    });
  });
});

export const prepareFinancialVoucher = Effect.fn("historical.prepareFinancialVoucher")(function* (
  token: string,
  command: Command & { input: typeof Historical.PrepareSourceVoucher.Type },
) {
  return yield* withBook(
    token,
    command.scope,
    false,
    function* (tx, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "prepare_sie_financial_voucher";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { runId: id, input },
        Accounting.ChangeSet,
      );

      if (request.previous) return request.previous;
      const run = yield* readRun(tx, scope, id);
      yield* checkCursor(tx, run, input);
      const { plan, vouchers } = yield* readSource(tx, scope, run.sourceRunId);
      const voucher = vouchers.find((row) => row.ordinal === run.nextOrdinal);

      if (!voucher) return yield* failure("NotFound");
      const date = sourceDate(voucher);
      const period = (yield* Ledger.readPeriod(tx, scope.bookId, input.accountingPeriodId))[0];

      if (
        !date ||
        !period ||
        period.fiscalYearId !== run.fiscalYearId ||
        date < period.startsOn ||
        date > period.endsOn
      )
        return yield* failure("InvalidJournal");

      const evidence = yield* createEvidenceInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${idempotencyKey}_evidence`,
        input: {
          title: `SIE ${voucher.sourceReference}`,
          origin: "Retained SIE source voucher",
          mediaType: "application/json",
          content: JSON.stringify({
            sourcePlanId: plan.id,
            sourcePlanDigest: plan.digest,
            sourceSha256: plan.sourceSha256,
            sourceRunId: run.sourceRunId,
            voucher,
          }),
        },
      });

      const result = yield* prepareJournalInTransaction(tx, principal, {
        scope,
        idempotencyKey: `${idempotencyKey}_journal`,
        input: {
          kind: "manual_journal",
          evidenceId: evidence.id,
          eventKey: `sie_${run.sourceRunId}_${voucher.ordinal}`,
          accountingPeriodId: period.id,
          postingDate: date,
          series: input.series,
          description: `SIE ${voucher.sourceReference}`,
          rationale: input.rationale,
          taxAssessment: "not_applicable",
          lines: yield* linesFor(plan, voucher),
        },
      });

      yield* Db.insertProposal(tx, scope.bookId, run.id, voucher.ordinal, result.id);
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

export const advanceFinancialRun = Effect.fn("historical.advanceFinancialRun")(function* (
  token: string,
  command: Command & {
    input: {
      readonly fence: string;
      readonly planDigest: string;
      readonly firstOrdinal: number;
      readonly items: ReadonlyArray<{
        readonly changeSetId: string;
        readonly planDigest: string;
        readonly approvalId: string;
      }>;
    };
  },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const { scope, id, idempotencyKey, input } = command;
      const operation = "advance_sie_financial_run";

      const request = yield* replay(
        tx,
        scope,
        idempotencyKey,
        operation,
        principal.actorId,
        { runId: id, input },
        Historical.Chunk,
      );

      if (request.previous) return request.previous;
      const run = yield* readRun(tx, scope, id);
      yield* checkCursor(tx, run, { ...input, ordinal: input.firstOrdinal });
      const { plan, vouchers } = yield* readSource(tx, scope, run.sourceRunId);

      if (
        input.items.length < 1 ||
        input.items.length > 20 ||
        run.nextOrdinal + input.items.length - 1 > plan.voucherCount
      )
        return yield* failure("InvalidJournal");
      const items: Array<(typeof Historical.Run.Type.items)[number]> = [];

      for (const [index, binding] of input.items.entries()) {
        const voucher = vouchers.find((v) => v.ordinal === run.nextOrdinal + index);
        const row = (yield* Ledger.readPlan(tx, scope.bookId, binding.changeSetId))[0];

        if (!voucher || !row) return yield* failure("StaleDependency");
        const change = yield* decode(Accounting.ChangeSet, row.plan);

        if (change.planDigest !== binding.planDigest) return yield* failure("StaleDependency");
        const action = change.groups[0]?.actions[0];
        const expected = yield* linesFor(plan, voucher);

        if (
          change.groups.length !== 1 ||
          change.groups[0]?.actions.length !== 1 ||
          !action ||
          action.fiscalYearId !== run.fiscalYearId ||
          action.postingDate !== sourceDate(voucher) ||
          action.postingPurpose !== "adjustment" ||
          action.occurrenceKey !== "manual_journal" ||
          action.lines.length !== expected.length ||
          expected.some((line, i) => {
            const actual = action.lines[i];

            return (
              !actual ||
              actual.accountId !== line.accountId ||
              actual.debitMinor !== line.debitMinor ||
              actual.creditMinor !== line.creditMinor
            );
          })
        )
          return yield* failure("InvalidJournal");

        const receipt = yield* executeChangeInTransaction(tx, principal, {
          scope,
          changeSetId: change.id,
          idempotencyKey: `${idempotencyKey}_ledger_${index + 1}`,
          owner: { kind: "historical_import", id: run.id },
          input: { version: 1, planDigest: change.planDigest, approvalId: binding.approvalId },
        });

        const item = {
          ordinal: voucher.ordinal,
          sourceReference: voucher.sourceReference,
          sourceDigest: yield* digest(voucher),
          ledgerReceipt: receipt,
        };

        yield* Db.insertPosting(tx, scope.bookId, run.id, item, change.id);
        items.push(item);
      }

      const next = run.nextOrdinal + items.length;

      const updated: Db.RunRow = {
        ...run,
        nextOrdinal: next,
        status: next > plan.voucherCount ? "posted" : "running",
        leaseUntil: lease(yield* isoNow(tx)),
      };

      yield* Db.updateRun(tx, scope.bookId, updated);
      const result = yield* decode(Historical.Chunk, { ...updated, items });
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

export const reclaimFinancialRun = Effect.fn("historical.reclaimFinancialRun")(function* (
  token: string,
  command: Command & { action: "pause" | "resume" },
) {
  return yield* withBook(
    token,
    command.scope,
    true,
    function* (tx, principal) {
      const operation = "reclaim_sie_financial_run";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        { runId: command.id, action: command.action },
        Historical.Fence,
      );

      if (request.previous) return request.previous;
      const run = yield* readRun(tx, command.scope, command.id);

      if (run.status === "posted") return yield* failure("InvalidJournal");

      if (BigInt(run.fence) >= 9223372036854775807n) return yield* failure("UnsupportedProfile");

      const updated: Db.RunRow = {
        ...run,
        status: command.action === "pause" ? "paused" : "running",
        fence: (BigInt(run.fence) + 1n).toString(),
        leaseUntil: lease(yield* isoNow(tx)),
      };

      yield* Db.updateRun(tx, command.scope.bookId, updated);
      const result = yield* decode(Historical.Fence, updated);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
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

export const compareSieClosing = Effect.fn("historical.compareSieClosing")(function* (
  token: string,
  command: Identified,
) {
  return yield* withBook(token, command.scope, false, function* (tx) {
    const found = (yield* Db.readRunForSource(tx, command.scope.bookId, command.id))[0];

    if (!found) return yield* failure("NotFound");
    const run = yield* readRun(tx, command.scope, found.id);
    const { plan } = yield* readSource(tx, command.scope, command.id);
    const year = (yield* Ledger.readFiscalYear(tx, command.scope.bookId, run.fiscalYearId))[0];
    const book = (yield* Ledger.readBook(tx, command.scope))[0];

    if (!year || !book) return yield* failure("InternalError");
    const expected = mappedControls(plan, "closing");

    const actual = new Map(
      (yield* Db.readBalances(tx, command.scope.bookId, year.endsOn, true)).map((row) => [
        row.accountId,
        BigInt(row.amount),
      ]),
    );

    const accounts = yield* Ledger.readAccounts(tx, command.scope.bookId, [
      ...new Set([...expected.keys(), ...actual.keys()]),
    ]);

    const items = accounts
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((account) => ({
        accountId: account.id,
        code: account.code,
        expectedMinor: (expected.get(account.id) ?? 0n).toString(),
        actualMinor: (actual.get(account.id) ?? 0n).toString(),
        differenceMinor: (
          (actual.get(account.id) ?? 0n) - (expected.get(account.id) ?? 0n)
        ).toString(),
      }));

    return yield* decode(Historical.ClosingComparison, {
      scope: command.scope,
      sourceRunId: command.id,
      sourcePlanId: plan.id,
      fiscalYearId: year.id,
      asOf: year.endsOn,
      bookSequence: book.committedSequence.toString(),
      postingComplete: run.status === "posted",
      balanced: items.length > 0 && items.every((item) => item.differenceMinor === "0"),
      items,
    });
  });
});
