import { digest as digestNative, canonicalText as canonicalNative } from "../json";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import * as Subledgers from "@open-erp/contracts/subledgers";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as Db from "../../db/posting";
import * as ControlsDb from "../../db/subledger/controls";
import * as SchedulesDb from "../../db/subledger/schedules";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { failure } from "../failures";
import { withAdmittedPrincipal, type AuthorityLockMode, type VerifiedPrincipal } from "../identity";
import { isoNow, newId, replay, saveCommand, sha256Hex } from "../posting";
import { basisMatchesRevision, readOccurrenceStates } from "./schedules";

type Scope = typeof Accounting.Scope.Type;

type Principal = VerifiedPrincipal;

type JsonObject = Schema.JsonObject;

type ControlInput = typeof Controls.CreateSubledgerControl.Type;

type Revision = typeof Subledgers.ScheduleRevision.Type;

const BasisSchema = Controls.SubledgerBasis;

const BasisListSchema = Controls.SubledgerBasisList;

const ControlListSchema = Controls.SubledgerControlList;

const ControlSchema = Controls.SubledgerControl;

const ControlViewSchema = Controls.SubledgerControlView;

const coverage = "not_established" as const;

const retainedBasisBound = 200;

const retainedControlBound = 200;

const scheduleBound = 200;

const accountBound = 1000;

const periodBound = 1000;

const preparationBound = 10000;

const impairmentReviewBound = 4000;

const impairmentBound = 4000;

const ledgerLineBound = 5000;

const controlByteBound = 8388608;

function unsupported() {
  return failure("UnsupportedProfile");
}

function decode<A>(schema: Schema.Decoder<A>, value: JsonObject) {
  return Schema.decodeEffect(schema)(value).pipe(Effect.mapError(() => failure("InternalError")));
}

function toJsonObject(value: unknown) {
  return Schema.decodeUnknownEffect(Schema.JsonObject)(value).pipe(
    Effect.mapError(() => failure("InternalError")),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(value: JsonObject | undefined, key: string) {
  const candidate = value?.[key];

  return typeof candidate === "string" ? candidate : undefined;
}

function objectField(value: JsonObject | undefined, key: string): JsonObject {
  const candidate = value?.[key];

  return isJsonObject(candidate) ? candidate : {};
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function minor(value: string) {
  return BigInt(value);
}

function isCalendarDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);

  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function digestValue(value: Schema.Json) {
  return toJsonObject(value).pipe(Effect.flatMap((object) => digestNative(object)));
}

function merge(...sources: ReadonlyArray<JsonObject>): JsonObject {
  return Object.assign({}, ...sources);
}

function digestBody(body: JsonObject) {
  return digestValue(body).pipe(Effect.map((digest) => merge(body, { digest })));
}

function withSubledgerBook<A>(
  token: string,
  scope: Scope,
  operatorOnly: boolean,
  operation: (transaction: Transaction, principal: Principal) => Effect.Effect<A, unknown, never>,
  lockMode: AuthorityLockMode = "share",
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    { operatorOnly },
    (transaction, principal) =>
      operation(transaction, principal).pipe(Effect.mapError(databaseFailure)),
    lockMode,
  );
}

function readBook(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const book = (yield* Db.readBook(transaction, scope))[0];

    if (book === undefined) return yield* failure("Forbidden");

    if (book.profile !== "synthetic-core-v1" || book.authority !== "native") {
      return yield* unsupported();
    }

    return book;
  });
}

function requireBasisGrants(transaction: Transaction) {
  return ControlsDb.readBasisGrants(transaction).pipe(
    Effect.flatMap((rows) => (rows.some((row) => !row.allowed) ? unsupported() : Effect.void)),
  );
}

function requireControlGrants(transaction: Transaction) {
  return ControlsDb.readControlGrants(transaction).pipe(
    Effect.flatMap((rows) => (rows.some((row) => !row.allowed) ? unsupported() : Effect.void)),
  );
}

function readDependencyDigest(
  transaction: Transaction,
  scope: Scope,
  book: {
    readonly committedSequence: bigint;
    readonly profile: string;
    readonly profileVersion: bigint;
    readonly authority: string;
    readonly writerEpoch: bigint;
    readonly currency: string;
    readonly currencyScale: number;
  },
) {
  return Effect.gen(function* () {
    const schedules = yield* SchedulesDb.readScheduleInventory(transaction, scope.bookId);

    if (schedules.length > scheduleBound) return null;

    if ((yield* Db.readAllAccounts(transaction, scope.bookId)).length > accountBound) return null;

    if ((yield* Db.readAllPeriods(transaction, scope.bookId)).length > periodBound) return null;
    const preparations = yield* SchedulesDb.listBookPreparations(transaction, scope.bookId);

    if (preparations.length > preparationBound) return null;
    const reviews = yield* SchedulesDb.countPreparationReviews(transaction, scope.bookId);

    if ((reviews[0]?.total ?? 0) > impairmentReviewBound) return null;
    const impairments = yield* SchedulesDb.listBookImpairments(transaction, scope.bookId);

    if (impairments.length > impairmentBound) return null;
    const periods = yield* Db.readAllPeriods(transaction, scope.bookId);
    const accounts = yield* Db.readAllAccounts(transaction, scope.bookId);
    const digests: Array<JsonObject> = [];

    for (const schedule of schedules) {
      const row = (yield* SchedulesDb.readCurrentRevision(
        transaction,
        scope.bookId,
        schedule.id,
      ))[0];

      if (row !== undefined)
        digests.push(yield* toJsonObject({ digest: textField(row.body, "digest") }));
    }

    const bases = yield* SchedulesDb.listBookBases(transaction, scope.bookId);
    const disposals = yield* SchedulesDb.listBookDisposals(transaction, scope.bookId);

    const body = yield* toJsonObject({
      sequence: book.committedSequence.toString(),
      profile: book.profile,
      profileVersion: book.profileVersion.toString(),
      authority: book.authority,
      writerEpoch: book.writerEpoch.toString(),
      currency: book.currency,
      currencyScale: book.currencyScale,
      periods: periods.map((period) => ({
        id: period.id,
        version: period.version.toString(),
        locked: period.locked,
        startsOn: period.startsOn,
        endsOn: period.endsOn,
        year: period.fiscalYearId,
      })),
      accounts: accounts.map((account) => ({
        id: account.id,
        version: account.version.toString(),
        code: account.code,
        name: account.name,
        active: account.active,
      })),
      schedules: digests,
      bases: bases.map((basis) => ({ digest: textField(basis.body, "digest") })),
      preparations: preparations.map((preparation) => [
        preparation.scheduleId,
        preparation.ordinal,
        preparation.attempt,
        preparation.changeSetId,
      ]),
    });

    const completed =
      disposals.length === 0
        ? body
        : {
            ...body,
            disposals: disposals.map((disposal) => ({
              digest: textField(disposal.body, "digest"),
            })),
          };

    const withDisposals =
      impairments.length === 0
        ? completed
        : {
            ...completed,
            impairments: impairments.map((impairment) => ({
              digest: textField(impairment.body, "digest"),
            })),
          };

    return yield* digestValue(yield* toJsonObject(withDisposals));
  });
}

type ExpectedEffect = {
  readonly scheduleId: string;
  readonly kind: string;
  readonly voucherId: string;
  readonly ordinal: number;
  readonly accountId: string;
  readonly expectedMinor: bigint;
};

type CapturedSchedule = {
  readonly revision: Revision;
  readonly basis: JsonObject | null;
  readonly basisVoucherId: string | null;
  readonly basisReversed: boolean;
  readonly disposal: JsonObject | null;
  readonly disposalPostingDate: string | null;
  readonly recognized: bigint;
  readonly impairment: bigint;
  readonly carrying: bigint | null;
  readonly occurrences: Array<JsonObject>;
};

export { prepareDisposal, prepareImpairment } from "./asset-reviews";

export {
  approveDisposal,
  approveImpairment,
  executeDisposal,
  executeImpairment,
} from "./asset-execution";

export {
  getDisposalReview,
  getImpairmentReview,
  listDisposalReviews,
  listImpairmentReviews,
} from "./asset-reads";

export { recordBasis } from "./basis";

export const getBasis = Effect.fn("subledger.getBasis")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireBasisGrants(transaction);
      const rows = yield* ControlsDb.readBasis(transaction, command.scope.bookId, command.id);
      const basis = rows[0];

      if (!basis) return yield* failure("NotFound");

      return yield* decode(BasisSchema, basis.body);
    }),
  );
});

export const listBases = Effect.fn("subledger.listBases")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireBasisGrants(transaction);
      const rows = yield* ControlsDb.listBases(transaction, command.scope.bookId);

      if (rows.length > retainedBasisBound) return yield* unsupported();
      const items = yield* Effect.forEach(rows, (row) => decode(BasisSchema, row.body));

      return yield* decode(BasisListSchema, { scope: command.scope, items, coverage });
    }),
  );
});

function captureSchedule(
  transaction: Transaction,
  scope: Scope,
  asOfDate: string,
  sequence: string,
  scheduleId: string,
  basis: SchedulesDb.BookBasisRow | undefined,
  disposal: SchedulesDb.BookDisposalRow | undefined,
  impairments: ReadonlyArray<SchedulesDb.BookImpairmentRow>,
  impairmentAccountIds: Array<string>,
) {
  return Effect.gen(function* () {
    const row = (yield* SchedulesDb.readRevisionAt(
      transaction,
      scope.bookId,
      scheduleId,
      asOfDate,
    ))[0];

    if (row === undefined) return undefined;
    const revision = yield* decode(Subledgers.ScheduleRevision, row.body);

    const effectiveDisposal =
      disposal === undefined || disposal.postingDate > asOfDate ? undefined : disposal;

    const occurrences = yield* readOccurrenceStates(transaction, scope, revision, asOfDate);
    let recognized = 0n;

    for (const occurrence of occurrences) {
      if (occurrence.state === "posted") {
        recognized += minor(textField(occurrence, "amountMinor") ?? "0");
      }
    }

    let impairment = 0n;

    for (const retained of impairments) {
      if (retained.postingDate > asOfDate) continue;
      impairment += minor(retained.impairmentMinor);

      if (!impairmentAccountIds.includes(retained.accumulatedImpairmentAccountId)) {
        impairmentAccountIds.push(retained.accumulatedImpairmentAccountId);
      }
    }

    const basisReversed =
      basis !== undefined &&
      (yield* SchedulesDb.readReversalBefore(
        transaction,
        scope.bookId,
        basis.voucherId,
        asOfDate,
        sequence,
      )).length > 0;

    const input = objectField(basis?.body ?? {}, "input");
    const effectiveOn = textField(input, "effectiveOn") ?? null;
    const carryingBasis = textField(input, "carryingMinor") ?? null;

    const carrying =
      basis === undefined || basisReversed || (effectiveOn !== null && effectiveOn > asOfDate)
        ? null
        : effectiveDisposal !== undefined
          ? 0n
          : carryingBasis === null
            ? null
            : minor(carryingBasis) - recognized - impairment;

    return {
      revision,
      basis: basis?.body ?? null,
      basisVoucherId: basis?.voucherId ?? null,
      basisReversed,
      disposal: effectiveDisposal?.body ?? null,
      disposalPostingDate: effectiveDisposal?.postingDate ?? null,
      recognized,
      impairment,
      carrying,
      occurrences,
    } satisfies CapturedSchedule;
  });
}

function captureSchedules(
  transaction: Transaction,
  scope: Scope,
  asOfDate: string,
  sequence: string,
) {
  return Effect.gen(function* () {
    const inventory = yield* SchedulesDb.readScheduleInventory(transaction, scope.bookId);
    const bases = yield* SchedulesDb.listBookBases(transaction, scope.bookId);
    const disposals = yield* SchedulesDb.listBookDisposals(transaction, scope.bookId);
    const impairments = yield* SchedulesDb.listBookImpairments(transaction, scope.bookId);
    const basisBySchedule = new Map(bases.map((basis) => [basis.scheduleId, basis]));

    const disposalBySchedule = new Map(
      disposals.map((disposal) => [disposal.scheduleId, disposal]),
    );

    const impairmentAccountIds: Array<string> = [];
    const captured: Array<CapturedSchedule> = [];

    for (const schedule of inventory) {
      const retained = yield* captureSchedule(
        transaction,
        scope,
        asOfDate,
        sequence,
        schedule.id,
        basisBySchedule.get(schedule.id),
        disposalBySchedule.get(schedule.id),
        impairments.filter((row) => row.scheduleId === schedule.id),
        impairmentAccountIds,
      );

      if (retained !== undefined) captured.push(retained);
    }

    return { schedules: captured, impairmentAccountIds };
  });
}

function scheduleBasisEffects(asOfDate: string, schedule: CapturedSchedule) {
  const effects: Array<ExpectedEffect> = [];
  const effectiveOn = textField(objectField(schedule.basis ?? {}, "input"), "effectiveOn");

  if (schedule.basis === null || effectiveOn === undefined || effectiveOn > asOfDate)
    return effects;

  if (schedule.basisVoucherId === null) return effects;
  const lines = schedule.basis.lines;

  if (!Array.isArray(lines)) return effects;

  for (const line of lines) {
    if (!isJsonObject(line)) continue;
    const ordinal = textField(line, "ordinal");
    const accountId = textField(line, "accountId");

    if (ordinal === undefined || !/^[1-9][0-9]{0,4}$/.test(ordinal) || accountId === undefined) {
      continue;
    }

    effects.push({
      scheduleId: schedule.revision.scheduleId,
      kind: "basis",
      voucherId: schedule.basisVoucherId,
      ordinal: Number(ordinal),
      accountId,
      expectedMinor:
        minor(textField(line, "debitMinor") ?? "0") - minor(textField(line, "creditMinor") ?? "0"),
    });
  }

  return effects;
}

function scheduleOccurrenceEffects(schedule: CapturedSchedule) {
  const effects: Array<ExpectedEffect> = [];
  const accountId = schedule.revision.terms.creditAccountId;

  for (const occurrence of schedule.occurrences) {
    const amountMinor = minor(textField(occurrence, "amountMinor") ?? "0");
    const voucherId = textField(occurrence, "voucherId");

    if (
      (occurrence.state === "posted" || occurrence.state === "reversed") &&
      voucherId !== undefined
    ) {
      effects.push({
        scheduleId: schedule.revision.scheduleId,
        kind: "occurrence",
        voucherId,
        ordinal: 2,
        accountId,
        expectedMinor: -amountMinor,
      });
    }

    const reversalVoucherId = textField(occurrence, "reversalVoucherId");

    if (occurrence.state === "reversed" && reversalVoucherId !== undefined) {
      effects.push({
        scheduleId: schedule.revision.scheduleId,
        kind: "occurrence_reversal",
        voucherId: reversalVoucherId,
        ordinal: 2,
        accountId,
        expectedMinor: amountMinor,
      });
    }
  }

  return effects;
}

function impairmentEffects(
  transaction: Transaction,
  scope: Scope,
  asOfDate: string,
  impairments: ReadonlyArray<SchedulesDb.BookImpairmentRow>,
) {
  return Effect.gen(function* () {
    const effects: Array<ExpectedEffect> = [];

    for (const impairment of impairments) {
      if (impairment.postingDate > asOfDate) continue;

      const receipt = (yield* SchedulesDb.readReceiptVoucher(
        transaction,
        scope.bookId,
        impairment.postingReceiptId,
      ))[0];

      if (receipt === undefined) continue;
      effects.push({
        scheduleId: impairment.scheduleId,
        kind: "impairment",
        voucherId: receipt.voucherId,
        ordinal: 2,
        accountId: impairment.accumulatedImpairmentAccountId,
        expectedMinor: -minor(impairment.impairmentMinor),
      });
    }

    return effects;
  });
}

function disposalEffects(
  transaction: Transaction,
  scope: Scope,
  asOfDate: string,
  disposals: ReadonlyArray<SchedulesDb.BookDisposalRow>,
) {
  return Effect.gen(function* () {
    const effects: Array<ExpectedEffect> = [];

    for (const disposal of disposals) {
      if (disposal.postingDate > asOfDate) continue;

      const receipt = (yield* SchedulesDb.readReceiptVoucher(
        transaction,
        scope.bookId,
        disposal.postingReceiptId,
      ))[0];

      const review = (yield* SchedulesDb.readDisposalReviewBody(
        transaction,
        scope.bookId,
        disposal.reviewId,
      ))[0];

      if (receipt === undefined || review === undefined) continue;
      const groups = objectField(review.body, "postingPlan").groups;
      const firstGroup = Array.isArray(groups) ? groups[0] : undefined;

      const actions =
        isJsonObject(firstGroup) && Array.isArray(firstGroup.actions) ? firstGroup.actions : [];

      const firstAction = actions[0];

      const lines =
        isJsonObject(firstAction) && Array.isArray(firstAction.lines) ? firstAction.lines : [];

      const lossAccountId = textField(objectField(review.body, "input"), "lossAccountId");

      for (const [index, line] of lines.entries()) {
        if (!isJsonObject(line)) continue;
        const accountId = textField(line, "accountId");

        if (accountId === undefined || accountId === lossAccountId) continue;
        effects.push({
          scheduleId: disposal.scheduleId,
          kind: "disposal_release",
          voucherId: receipt.voucherId,
          ordinal: index + 1,
          accountId,
          expectedMinor:
            minor(textField(line, "debitMinor") ?? "0") -
            minor(textField(line, "creditMinor") ?? "0"),
        });
      }
    }

    return effects;
  });
}

function orderEffects(effects: Array<ExpectedEffect>) {
  effects.sort(
    (left, right) =>
      compareText(left.scheduleId, right.scheduleId) ||
      compareText(left.kind, right.kind) ||
      compareText(left.voucherId, right.voucherId) ||
      left.ordinal - right.ordinal,
  );

  return effects;
}

function buildExpectedEffects(
  transaction: Transaction,
  scope: Scope,
  asOfDate: string,
  captured: ReadonlyArray<CapturedSchedule>,
) {
  return Effect.gen(function* () {
    const effects: Array<ExpectedEffect> = [];

    for (const schedule of captured) {
      effects.push(...scheduleBasisEffects(asOfDate, schedule));
      effects.push(...scheduleOccurrenceEffects(schedule));
    }

    effects.push(
      ...(yield* impairmentEffects(
        transaction,
        scope,
        asOfDate,
        yield* SchedulesDb.listBookImpairments(transaction, scope.bookId),
      )),
    );
    effects.push(
      ...(yield* disposalEffects(
        transaction,
        scope,
        asOfDate,
        yield* SchedulesDb.listBookDisposals(transaction, scope.bookId),
      )),
    );

    return orderEffects(effects);
  });
}

function requireDeclaredCoverage(
  accountIds: ReadonlyArray<string>,
  captured: ReadonlyArray<CapturedSchedule>,
  bases: ReadonlyArray<SchedulesDb.BookBasisRow>,
) {
  for (const schedule of captured) {
    if (
      !accountIds.includes(schedule.revision.terms.creditAccountId) ||
      accountIds.includes(schedule.revision.terms.debitAccountId)
    ) {
      return failure("InvalidJournal");
    }
  }

  for (const basis of bases) {
    const lines = basis.body.lines;

    if (!Array.isArray(lines)) continue;

    for (const line of lines) {
      if (!isJsonObject(line)) continue;
      const accountId = textField(line, "accountId");

      if (accountId === undefined || !accountIds.includes(accountId)) {
        return failure("InvalidJournal");
      }
    }
  }

  return Effect.void;
}

function requireDistinctEffects(effects: ReadonlyArray<ExpectedEffect>) {
  const claimed = new Set<string>();

  for (const effect of effects) {
    const key = `${effect.voucherId}:${effect.ordinal}`;

    if (claimed.has(key)) return failure("InvalidJournal");
    claimed.add(key);
  }

  return Effect.void;
}

function effectIndex(effects: ReadonlyArray<ExpectedEffect>) {
  return new Map(
    effects.map((effect) => [`${effect.voucherId}:${effect.ordinal}:${effect.accountId}`, effect]),
  );
}

function controlLineBody(
  line: SchedulesDb.LedgerContributionRow,
  effect: ExpectedEffect | undefined,
): JsonObject {
  const expected = effect?.expectedMinor ?? 0n;

  return {
    voucherId: line.voucherId,
    lineId: line.lineId,
    ordinal: line.ordinal,
    sequence: line.sequence,
    postingDate: line.postingDate,
    accountId: line.accountId,
    debitMinor: line.debitMinor,
    creditMinor: line.creditMinor,
    description: line.description,
    correctsVoucherId: line.correctsVoucherId,
    evidenceRefs: line.evidenceRefs,
    scheduleId: effect?.scheduleId ?? null,
    effectKind: effect?.kind ?? null,
    expectedMinor: expected.toString(),
    unexplainedMinor: (minor(line.debitMinor) - minor(line.creditMinor) - expected).toString(),
  };
}

function accountControlTotals(
  accountId: string,
  effects: ReadonlyArray<ExpectedEffect>,
  lines: ReadonlyArray<SchedulesDb.LedgerContributionRow>,
  index: ReadonlyMap<string, ExpectedEffect>,
) {
  let expected = 0n;

  for (const effect of effects) {
    if (effect.accountId === accountId) expected += effect.expectedMinor;
  }

  let ledger = 0n;
  let unexplained = 0;

  for (const line of lines) {
    if (line.accountId !== accountId) continue;
    const net = minor(line.debitMinor) - minor(line.creditMinor);
    const effect = index.get(`${line.voucherId}:${line.ordinal}:${line.accountId}`);
    ledger += net;

    if (net - (effect?.expectedMinor ?? 0n) !== 0n) unexplained += 1;
  }

  const missing = effects.filter(
    (effect) =>
      effect.accountId === accountId &&
      !lines.some(
        (line) =>
          line.voucherId === effect.voucherId &&
          line.ordinal === effect.ordinal &&
          line.accountId === effect.accountId,
      ),
  ).length;

  return { expected, ledger, unexplained, missing, difference: ledger - expected };
}

function scheduleHasReviewGap(schedule: CapturedSchedule) {
  if (schedule.basis === null || schedule.basisReversed) return true;

  for (const occurrence of schedule.occurrences) {
    const state = occurrence.state;

    if (state === "posted") continue;

    const excused =
      schedule.disposal !== null &&
      (state === "unprepared" || state === "prepared") &&
      schedule.disposalPostingDate !== null &&
      (textField(occurrence, "postingDate") ?? "") >= schedule.disposalPostingDate;

    if (!excused) return true;
  }

  return false;
}

export const createControl = Effect.fn("subledger.createControl")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: ControlInput },
) {
  return yield* withSubledgerBook(
    token,
    command.scope,
    false,
    (transaction, principal) =>
      Effect.gen(function* () {
        const payload = yield* toJsonObject(command.input);

        const request = yield* replay(
          transaction,
          command.scope,
          command.idempotencyKey,
          "create_subledger_control",
          principal.actorId,
          payload,
          ControlSchema,
        );

        if (request.previous) return request.previous;
        yield* requireControlGrants(transaction);
        yield* Db.lockBookForUpdate(transaction, command.scope);
        const book = yield* readBook(transaction, command.scope);

        if (
          !isCalendarDate(command.input.asOfDate) ||
          command.input.rationale.trim().length < 1 ||
          command.input.rationale.length > 2000
        ) {
          return yield* failure("InvalidJournal");
        }

        const evidence = (yield* Db.readEvidence(
          transaction,
          command.scope.bookId,
          command.input.inventoryEvidenceId,
        ))[0];

        if (evidence === undefined) return yield* failure("MissingEvidence");
        const accountIds = command.input.accountIds;

        if (
          accountIds.length < 1 ||
          accountIds.length > 20 ||
          new Set(accountIds).size !== accountIds.length
        ) {
          return yield* failure("InvalidJournal");
        }

        const declared = yield* Db.readAccounts(transaction, command.scope.bookId, [...accountIds]);

        if (declared.length !== accountIds.length) return yield* failure("InvalidJournal");
        const dependencyDigest = yield* readDependencyDigest(transaction, command.scope, book);

        if (dependencyDigest === null) return yield* unsupported();

        const snapshots = yield* SchedulesDb.countControlSnapshots(
          transaction,
          command.scope.bookId,
        );

        if ((snapshots[0]?.total ?? 0) >= retainedControlBound) return yield* unsupported();
        const sequence = book.committedSequence.toString();
        const asOfDate = command.input.asOfDate;
        const captured = yield* captureSchedules(transaction, command.scope, asOfDate, sequence);
        yield* requireDeclaredCoverage(
          accountIds,
          captured.schedules,
          yield* SchedulesDb.listBookBases(transaction, command.scope.bookId),
        );

        for (const accountId of captured.impairmentAccountIds) {
          if (!accountIds.includes(accountId)) return yield* failure("InvalidJournal");
        }

        const effects = yield* buildExpectedEffects(
          transaction,
          command.scope,
          asOfDate,
          captured.schedules,
        );

        yield* requireDistinctEffects(effects);

        const lines = yield* SchedulesDb.readLedgerContributions(
          transaction,
          command.scope.bookId,
          accountIds,
          asOfDate,
          sequence,
          ledgerLineBound + 1,
        );

        if (lines.length > ledgerLineBound) return yield* unsupported();
        const index = effectIndex(effects);

        const ledgerLines = yield* Effect.forEach(lines, (line) =>
          toJsonObject(
            controlLineBody(line, index.get(`${line.voucherId}:${line.ordinal}:${line.accountId}`)),
          ),
        );

        if (ledgerLines.length !== lines.length) return yield* failure("InvalidJournal");
        const ordered = [...declared].sort((left, right) => compareText(left.id, right.id));
        const controls: Array<JsonObject> = [];
        let reviewGaps = captured.schedules.length === 0;

        for (const account of ordered) {
          const totals = accountControlTotals(account.id, effects, lines, index);

          if (totals.difference !== 0n || totals.unexplained !== 0 || totals.missing !== 0) {
            reviewGaps = true;
          }

          controls.push(
            yield* toJsonObject({
              accountId: account.id,
              code: account.code,
              name: account.name,
              version: account.version.toString(),
              active: account.active,
              expectedMinor: totals.expected.toString(),
              ledgerMinor: totals.ledger.toString(),
              differenceMinor: totals.difference.toString(),
              unexplainedLineCount: totals.unexplained,
              missingEffectCount: totals.missing,
            }),
          );
        }

        for (const schedule of captured.schedules) {
          if (!scheduleHasReviewGap(schedule)) continue;

          if (schedule.basis === null) {
            reviewGaps = true;
            continue;
          }

          if (!(yield* basisMatchesRevision(schedule.basis, schedule.revision))) {
            reviewGaps = true;
          }
        }

        const schedules = yield* Effect.forEach(captured.schedules, (schedule) =>
          toJsonObject({
            revision: schedule.revision,
            basis: schedule.basis,
            occurrences: schedule.occurrences,
            basisReversed: schedule.basisReversed,
            disposal: schedule.disposal,
            recognizedMinor: schedule.recognized.toString(),
            impairmentMinor: schedule.impairment.toString(),
            carryingMinor: schedule.carrying === null ? null : schedule.carrying.toString(),
          }),
        );

        const expectedEffects = yield* Effect.forEach(effects, (effect) =>
          toJsonObject({
            scheduleId: effect.scheduleId,
            kind: effect.kind,
            voucherId: effect.voucherId,
            ordinal: effect.ordinal,
            accountId: effect.accountId,
            expectedMinor: effect.expectedMinor.toString(),
          }),
        );

        const base = merge({
          id: newId("schedule_control"),
          scope: command.scope,
          kind: "synthetic_subledger_control_v1",
          input: yield* toJsonObject(command.input),
          inventorySha256: evidence.sha256,
          sequence,
          currency: book.currency,
          currencyScale: book.currencyScale,
          dependencyDigest,
          knowledgeBasis: "current_known_facts_at_capture",
          coverage: "not_established",
          financialCloseReady: false,
          schedules,
          expectedEffects,
          ledgerLines,
          controls,
          hasReviewGaps: reviewGaps,
          createdAt: yield* isoNow(transaction),
          receipt: {
            key: command.idempotencyKey,
            operation: "create_subledger_control",
            actorId: principal.actorId,
          },
        });

        const body = yield* digestBody(base);
        const control = yield* decode(ControlSchema, body);

        const content = yield* canonicalNative(body);

        const byteLength = new TextEncoder().encode(content).byteLength;

        if (byteLength < 1 || byteLength > controlByteBound) return yield* unsupported();
        const hash = yield* sha256Hex(content);
        yield* SchedulesDb.insertControlSnapshot(transaction, {
          bookId: command.scope.bookId,
          id: control.id,
          body,
          content,
          sha256: hash,
          byteLength,
        });
        yield* saveCommand(
          transaction,
          command.scope,
          command.idempotencyKey,
          request.expected,
          "create_subledger_control",
          principal.actorId,
          control,
        );

        return control;
      }),
    "update",
  );
});

export const getControl = Effect.fn("subledger.getControl")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireControlGrants(transaction);

      const saved = (yield* SchedulesDb.readControlSnapshot(
        transaction,
        command.scope.bookId,
        command.id,
      ))[0];

      if (saved === undefined) return yield* failure("NotFound");
      const book = yield* readBook(transaction, command.scope);
      const dependencyDigest = yield* readDependencyDigest(transaction, command.scope, book);

      return yield* decode(ControlViewSchema, {
        snapshot: yield* decode(ControlSchema, saved.body),
        dependenciesCurrent:
          dependencyDigest !== null &&
          dependencyDigest === textField(saved.body, "dependencyDigest"),
        artifact: {
          content: saved.content,
          sha256: saved.sha256,
          byteLength: saved.byteLength,
          mediaType: "application/json",
        },
      });
    }),
  );
});

export const listControls = Effect.fn("subledger.listControls")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withSubledgerBook(token, command.scope, false, (transaction) =>
    Effect.gen(function* () {
      yield* requireControlGrants(transaction);
      const rows = yield* ControlsDb.listControlItems(transaction, command.scope.bookId);

      if (rows.length > retainedControlBound) return yield* unsupported();
      const items = yield* Effect.forEach(rows, (row) => toJsonObject(row.item));

      return yield* decode(ControlListSchema, { scope: command.scope, items, coverage });
    }),
  );
});
