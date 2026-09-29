import { calculateCashFlow } from "@open-erp/domain/cash-flow-statement";
import * as CashFlowContract from "@open-erp/contracts/cash-flow";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { failure } from "../failures";
import { digest as digestNative } from "../json";
import { isoNow } from "../posting";
import { decode, toJsonObject, unsupported, withBook } from "../commerce/support";
import { readTableAccess } from "../../db/commerce/access";
import * as Db from "../../db/reports/cash-flow-statement";

// NEXT-45: a direct cash-flow statement with a full reconciliation bridge to
// actual closing cash.
//
// The owner owns three decisions and refuses the rest. It owns which accounts
// are cash, because the caller supplies a reviewed perimeter and the owner
// checks that every perimeter account exists and carries a reviewed role. It
// owns how a cash leg is classified, because that is derived here from the
// reviewed role of the leg's counterpart inside the same voucher. And it owns
// whether the result is complete.
//
// It refuses to infer. An account is never treated as cash because of its
// name. Two equal and opposite cash amounts are never treated as an internal
// transfer without the owned transfer identity the posting purpose carries. A
// cash leg whose counterpart role does not determine exactly one activity is
// left unclassified with its reason, and an unclassified row makes the whole
// report incomplete. Opening and closing cash are derived from retained
// postings; a caller cannot state either amount.

const maximumAccounts = 500;

const maximumComponents = 5000;

const maximumPeriods = 500;

type Scope = typeof Accounting.Scope.Type;

type Line = typeof CashFlowContract.CashFlowLine.Type;

type Component = Db.CashFlowComponentRow;

type Activity = NonNullable<Line["activity"]>;

const ReportSchema = CashFlowContract.CashFlowStatementReport;

const digestOf = digestNative;

// A reviewed role determines exactly one cash-flow activity, or it does not
// determine one. other_income and other_expense are deliberately absent: either
// can carry an FX remeasurement that is not an external cash flow, and the leaf
// treats a valuation effect as a bridge item. A mapping that wants a real
// other_income item classified as operating must name the account in a role
// that says so; this owner does not decide that.
const operatingRoles: ReadonlySet<string> = new Set([
  "revenue",
  "cost_of_sales",
  "operating_expense",
  "income_tax",
  "accounts_receivable",
  "inventory",
  "other_current_assets",
  "accounts_payable",
  "accrued_liabilities",
  "tax_liabilities",
  "other_current_liabilities",
  "operating_cash_inflow",
  "operating_cash_outflow",
]);

const investingRoles: ReadonlySet<string> = new Set([
  "property_plant_and_equipment",
  "other_non_current_assets",
  "investing_cash_inflow",
  "investing_cash_outflow",
]);

const financingRoles: ReadonlySet<string> = new Set([
  "long_term_debt",
  "other_non_current_liabilities",
  "equity",
  "financing_cash_inflow",
  "financing_cash_outflow",
]);

function activityOf(role: string | undefined): Activity | null {
  if (role === undefined) return null;

  if (operatingRoles.has(role)) return "operating";

  if (investingRoles.has(role)) return "investing";

  if (financingRoles.has(role)) return "financing";

  return null;
}

function signedOf(component: Component): bigint {
  return BigInt(component.debitMinor) - BigInt(component.creditMinor);
}

type ClassifyContext = {
  readonly isCash: (accountId: string) => boolean;
  readonly roleOf: (accountId: string) => string | undefined;
  readonly exchangeEffect: ReadonlySet<string>;
};

function baseLine(
  component: Component,
  kind: Line["kind"],
  signed: bigint,
  rest: Omit<
    Line,
    "rowId" | "voucherId" | "lineId" | "postingDate" | "accountId" | "signedCashMinor" | "kind"
  >,
  rowId: string = component.componentId,
): Line {
  return {
    rowId,
    voucherId: component.voucherId,
    lineId: component.lineId,
    postingDate: component.postingDate,
    accountId: component.accountId,
    signedCashMinor: signed.toString(),
    kind,
    ...rest,
  };
}

// Each classification slice keeps its parent cash-component identity through
// voucher/line/account, but needs its own stable row identity: the pure leaf
// refuses any repeated rowId as SplitMismatch. The id is derived
// deterministically from the parent component, the resolved activity and the
// exact counterpart account, so repeated reads agree and a duplicate source
// slice still collides rather than passing silently.
function sliceRowId(componentId: string, activity: Activity, accountId: string): string {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^[^a-z]+/, "x")
      .slice(0, 40) || "x";

  return `${componentId}--${activity}--${clean(accountId)}`.slice(0, 127);
}

const unresolved = (component: Component, signed: bigint, reason: string): Line =>
  baseLine(component, "external", signed, {
    activity: null,
    originRef: null,
    transferId: null,
    witnessRef: null,
    reason,
  });

// One cash leg against only other cash legs. A transfer needs the owned
// transfer identity the posting purpose carries; equal and opposite amounts
// prove nothing, because an unrelated customer and supplier payment looks
// identical.
function transferRows(
  cashLeg: Component,
  otherCash: ReadonlyArray<Component>,
  signed: bigint,
): Array<Line> {
  if (!cashLeg.ownedTransfer) {
    return [
      baseLine(cashLeg, "internal_transfer", signed, {
        activity: null,
        originRef: null,
        transferId: null,
        witnessRef: null,
        reason: "cash-to-cash movement without an owned transfer identity",
      }),
    ];
  }

  return otherCash
    .filter((leg) => signedOf(leg) !== 0n)
    .map((leg) =>
      baseLine(leg, "internal_transfer", signedOf(leg), {
        activity: null,
        originRef: null,
        transferId: cashLeg.voucherId,
        witnessRef: cashLeg.voucherId,
        reason: null,
      }),
    );
}

// A cash leg against non-cash counterparts. Splits follow the exact counterpart
// postings, and the split must conserve the original cash component exactly.
function externalRows(
  cashLeg: Component,
  nonCash: ReadonlyArray<Component>,
  signed: bigint,
  context: ClassifyContext,
): Array<Line> {
  // A pure cash-holding remeasurement is the only voucher that becomes a
  // valuation effect: every non-cash counterpart names a reviewed
  // exchange-effect account. A receivable settlement with a realised FX gain
  // keeps its gross bank receipt as operating cash; the gain is P&L handled
  // separately, never a reason to reclassify the whole receipt. Mixed or
  // unmapped counterparts fall through to the activity split below, which
  // leaves them unclassified with a reason rather than guessing.
  const allExchange =
    nonCash.length > 0 && nonCash.every((row) => context.exchangeEffect.has(row.accountId));

  if (allExchange) {
    const valuation = nonCash[0];

    if (valuation === undefined) {
      return [unresolved(cashLeg, signed, "valuation voucher names no counterpart line")];
    }

    return [
      baseLine(cashLeg, "valuation_effect", signed, {
        activity: null,
        originRef: null,
        transferId: null,
        witnessRef: valuation.lineId,
        reason: null,
      }),
    ];
  }

  const resolved: Array<{ row: Component; activity: Activity }> = [];
  const undetermined: Array<string> = [];

  for (const row of nonCash) {
    const role = context.roleOf(row.accountId);
    const activity = activityOf(role);

    if (activity === null) undetermined.push(role ?? "unmapped");
    else resolved.push({ row, activity });
  }

  if (undetermined.length > 0) {
    return [
      unresolved(
        cashLeg,
        signed,
        `counterpart account has no reviewed activity role: ${undetermined.join(", ")}`,
      ),
    ];
  }

  // A balanced voucher's counterpart carries the opposite sign to the cash leg
  // it funds: a receipt debits cash and credits revenue. The cash movement is
  // therefore the negation of the counterpart movement, and that negation is
  // what makes the splits conserve the original component.
  const byKey = new Map<string, { row: Component; activity: Activity; minor: bigint }>();

  for (const split of resolved) {
    const key = `${split.activity}:${split.row.accountId}`;
    const funded = -signedOf(split.row);
    const existing = byKey.get(key);

    if (existing === undefined) {
      byKey.set(key, { row: split.row, activity: split.activity, minor: funded });
      continue;
    }

    existing.minor += funded;
  }

  const emitted = [...byKey.values()].reduce((sum, value) => sum + value.minor, 0n);

  if (emitted !== signed) {
    return [
      unresolved(
        cashLeg,
        signed,
        `classification split ${emitted} does not conserve the cash component ${signed}`,
      ),
    ];
  }

  const slices = [...byKey.values()];

  return slices.map((value) =>
    baseLine(
      cashLeg,
      "external",
      value.minor,
      {
        activity: value.activity,
        originRef: value.row.lineId,
        transferId: null,
        witnessRef: null,
        reason: null,
      },
      slices.length === 1
        ? cashLeg.componentId
        : sliceRowId(cashLeg.componentId, value.activity, value.row.accountId),
    ),
  );
}

function classifyCashLeg(
  cashLeg: Component,
  voucher: ReadonlyArray<Component>,
  context: ClassifyContext,
): Array<Line> {
  const signed = signedOf(cashLeg);

  if (signed === 0n) return [];

  const others = voucher.filter((row) => row.lineId !== cashLeg.lineId);
  const otherCash = others.filter((row) => context.isCash(row.accountId));
  const nonCash = others.filter((row) => !context.isCash(row.accountId));

  if (otherCash.length > 0 && nonCash.length === 0) {
    return transferRows(cashLeg, otherCash, signed);
  }

  if (nonCash.length === 0) {
    return [unresolved(cashLeg, signed, "cash movement has no counterpart posting in the voucher")];
  }

  return externalRows(cashLeg, nonCash, signed, context);
}

function deriveCashRows(interval: ReadonlyArray<Component>, context: ClassifyContext): Array<Line> {
  const byVoucher = new Map<string, Array<Component>>();

  for (const component of interval) {
    const existing = byVoucher.get(component.voucherId);

    if (existing === undefined) byVoucher.set(component.voucherId, [component]);
    else existing.push(component);
  }

  const rows: Array<Line> = [];

  for (const component of interval) {
    if (!context.isCash(component.accountId)) continue;

    const voucher = byVoucher.get(component.voucherId) ?? [component];
    rows.push(...classifyCashLeg(component, voucher, context));
  }

  return rows;
}

function cashBalances(
  components: ReadonlyArray<Component>,
  isCash: (accountId: string) => boolean,
  startsOn: string,
) {
  let opening = 0n;
  let closing = 0n;

  for (const component of components) {
    if (!isCash(component.accountId)) continue;

    const movement = signedOf(component);

    closing += movement;

    if (component.postingDate < startsOn) opening += movement;
  }

  return { opening, closing };
}

// A reported interval is covered when the retained periods tile it with no
// gap. A gap means the owner cannot claim completeness even when every row
// classified and the bridge balanced, which is the honest state: the
// arithmetic agreed over an unproven population.
function coversInterval(
  periods: ReadonlyArray<{ startsOn: string; endsOn: string }>,
  startsOn: string,
  endsOn: string,
): boolean {
  const relevant = periods
    .filter((period) => period.endsOn >= startsOn && period.startsOn <= endsOn)
    .sort((left, right) => (left.startsOn < right.startsOn ? -1 : 1));

  if (relevant.length === 0) return false;

  let cursor = startsOn;

  for (const period of relevant) {
    if (period.startsOn > cursor) return false;

    if (period.endsOn >= cursor) cursor = nextDay(period.endsOn);
  }

  return cursor > endsOn;
}

function nextDay(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);

  date.setUTCDate(date.getUTCDate() + 1);

  return date.toISOString().slice(0, 10);
}

function requireCashFlowAccess(
  transaction: Parameters<typeof readTableAccess>[0],
): Effect.Effect<number, unknown, never> {
  const tables = [...Db.cashFlowTables];

  return readTableAccess(transaction, tables).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== tables.length) return unsupported();

      if (rows.some((row) => !row.canSelect)) return unsupported();

      return Effect.succeed(tables.length);
    }),
  );
}

// The reviewed basis must name only retained accounts. A perimeter id, a role
// rule or an exchange-effect id that names nothing is a broken basis, and this
// owner refuses it rather than reporting a statement over accounts it cannot
// see.
function basisIsUsable(
  known: ReadonlySet<string>,
  mapping: typeof CashFlowContract.CashFlowMapping.Type,
): boolean {
  const named = [
    ...mapping.perimeterAccountIds,
    ...mapping.accountRoleRules.map((rule) => rule.accountId),
    ...mapping.exchangeEffectAccountIds,
  ];

  return named.every((accountId) => known.has(accountId));
}

export const prepareCashFlowStatement = Effect.fn("cashFlow.prepare")(function* (
  token: string,
  command: { scope: Scope; input: typeof CashFlowContract.PrepareCashFlowStatement.Type },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireCashFlowAccess(transaction);

    const input = command.input;
    const bookId = command.scope.bookId;
    const mapping = input.mapping;

    const [book] = yield* Db.readCashFlowBook(transaction, bookId);

    if (book === undefined) return yield* failure("NotFound");

    const accounts = yield* Db.readCashFlowAccounts(transaction, bookId, maximumAccounts);

    if (accounts.length > maximumAccounts) return yield* failure("UnsupportedProfile");

    const known = new Set(accounts.map((row) => row.id));

    if (!basisIsUsable(known, mapping)) return yield* failure("UnsupportedProfile");

    const boundary = book.committedSequence;

    const components = yield* Db.readCashFlowComponents(
      transaction,
      bookId,
      null,
      input.endsOn,
      boundary,
      maximumComponents,
    );

    if (components.length > maximumComponents) return yield* failure("UnsupportedProfile");

    const periods = yield* Db.readCashFlowPeriods(transaction, bookId, maximumPeriods);

    if (periods.length > maximumPeriods) return yield* failure("UnsupportedProfile");

    const perimeter = new Set(mapping.perimeterAccountIds);
    const roleOf = new Map(mapping.accountRoleRules.map((rule) => [rule.accountId, rule.role]));

    const isCash = (accountId: string) => perimeter.has(accountId);

    const { opening, closing } = cashBalances(components, isCash, input.startsOn);

    const interval = components.filter(
      (component) =>
        component.postingDate >= input.startsOn && component.postingDate <= input.endsOn,
    );

    const rows = deriveCashRows(interval, {
      isCash,
      roleOf: (accountId) => roleOf.get(accountId),
      exchangeEffect: new Set(mapping.exchangeEffectAccountIds),
    });

    // Period tiling proves the retained calendar covers the interval. It does
    // not prove bank sources were imported or confirmed: no source
    // attestation owner exists yet, so independent controls stay explicit.
    const periodCoverageComplete = coversInterval(periods, input.startsOn, input.endsOn);
    const sourceControlsComplete = periodCoverageComplete;
    const independentSourceControlsComplete = false;

    const recordedCutoff = (yield* isoNow(transaction)).slice(0, 19);

    // The leaf classifies each row once and owns the bridge arithmetic. It
    // reports complete only when nothing is unclassified, no internal
    // counterpart is missing, the difference is zero and the tiled ledger
    // population holds. That is ledger-scope completeness, not independently
    // reconciled cash.
    const computed = calculateCashFlow({
      periodStartsOn: input.startsOn,
      periodEndsOn: input.endsOn,
      recordedCutoff,
      openingCashMinor: opening.toString(),
      actualClosingCashMinor: closing.toString(),
      sourceControlsComplete,
      rows: rows.map((row) => ({
        rowId: row.rowId,
        signedCashMinor: row.signedCashMinor,
        kind: row.kind,
        activity: row.activity,
        originRef: row.originRef,
        transferId: row.transferId,
        witnessRef: row.witnessRef,
      })),
    });

    if (Result.isFailure(computed)) return yield* failure("InvalidJournal");

    const statement = computed.success;

    const report = {
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      openingCashMinor: opening.toString(),
      totals: {
        operatingNetMinor: statement.operatingNetMinor,
        investingNetMinor: statement.investingNetMinor,
        financingNetMinor: statement.financingNetMinor,
        exchangeEffectsMinor: statement.exchangeEffectsMinor,
        perimeterChangesMinor: statement.perimeterChangesMinor,
        expectedClosingMinor: statement.expectedClosingMinor,
        actualClosingMinor: statement.actualClosingMinor,
        reconciliationDifferenceMinor: statement.reconciliationDifferenceMinor,
      },
      lines: rows.map((row) => ({
        ...row,
        reason: statement.unclassifiedRowIds.includes(row.rowId)
          ? (row.reason ?? "unresolved")
          : null,
      })),
      unclassifiedRowIds: statement.unclassifiedRowIds,
      complete: statement.complete,
      sourceControlsComplete,
      periodCoverageComplete,
      independentSourceControlsComplete,
      recordedCutoff,
      basisDigest: yield* digestOf({
        accounts: accounts.map((row) => ({ id: row.id, version: row.version })),
        roles: mapping.accountRoleRules,
        perimeter: mapping.perimeterAccountIds,
        exchangeEffect: mapping.exchangeEffectAccountIds,
        ledgerBoundary: boundary.toString(),
        recordedCutoff,
      }),
      ledgerBoundary: boundary,
    };

    return yield* decode(ReportSchema, yield* toJsonObject(report));
  });
});
