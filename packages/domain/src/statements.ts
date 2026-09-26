import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AccountingDate, Description, Digest, Identifier, Scope } from "./values";
import { MinorUnits, SignedMinorUnits } from "./money";

export const StatementRole = Schema.Literals([
  "income",
  "expense",
  "asset",
  "liability",
  "equity",
  "excluded",
]);

export type StatementRole = typeof StatementRole.Type;

export const StatementKind = Schema.Literals(["profit_and_loss", "balance_sheet"]);

export type StatementKind = typeof StatementKind.Type;

export const BalanceClass = Schema.Literals(["asset", "liability", "equity"]);

export type BalanceClass = typeof BalanceClass.Type;

export const PresentationSign = Schema.Literals([1, -1]);

export type PresentationSign = typeof PresentationSign.Type;

export const StatementSide = Schema.Literals(["debit", "credit"]);

export type StatementSide = typeof StatementSide.Type;

export const VirtualResultRowId = "virtual_untransferred_result";

const virtualResultRow: string = VirtualResultRowId;

const profitAndLossRoles: ReadonlySet<StatementRole> = new Set(["income", "expense"]);

const balanceSheetRoles: ReadonlySet<StatementRole> = new Set(["asset", "liability", "equity"]);

const presentationSigns = {
  income: -1,
  expense: 1,
  asset: 1,
  liability: -1,
  equity: -1,
  excluded: 1,
} as const satisfies Record<StatementRole, PresentationSign>;

// A balance-sheet role carries its own balance class, so the reviewed mapping
// never needs a second vocabulary for asset, liability and equity.
function balanceClassFor(role: StatementRole): BalanceClass | null {
  return role === "asset" || role === "liability" || role === "equity" ? role : null;
}

const statementForRole = {
  income: "profit_and_loss",
  expense: "profit_and_loss",
  asset: "balance_sheet",
  liability: "balance_sheet",
  equity: "balance_sheet",
  excluded: null,
} as const satisfies Record<StatementRole, StatementKind | null>;

export const StatementInterval = Schema.Struct({
  startsOn: AccountingDate,
  endsOn: AccountingDate,
});

export type StatementInterval = typeof StatementInterval.Type;

export const StatementFiscalYear = Schema.Struct({
  id: Identifier,
  startsOn: AccountingDate,
  endsOn: AccountingDate,
});

export type StatementFiscalYear = typeof StatementFiscalYear.Type;

export const StatementLeafRow = Schema.Struct({
  rowId: Identifier,
  label: Description,
  statement: StatementKind,
  side: StatementSide,
  contributionRoles: Schema.Array(StatementRole).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(3),
    Schema.isUnique(),
  ),
});

export type StatementLeafRow = typeof StatementLeafRow.Type;

export const StatementSubtotalMember = Schema.Struct({
  rowId: Identifier,
  sign: PresentationSign,
});

export type StatementSubtotalMember = typeof StatementSubtotalMember.Type;

export const StatementSubtotal = Schema.Struct({
  nodeId: Identifier,
  label: Description,
  members: Schema.Array(StatementSubtotalMember).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(200),
  ),
});

export type StatementSubtotal = typeof StatementSubtotal.Type;

export const StatementMapping = Schema.Struct({
  version: Schema.Literal("semantic_statement_mapping_v1"),
  reviewed: Schema.Literal(true),
  framework: Description,
  effectiveFiscalRules: Schema.Struct({
    status: Schema.Literal("pending_company_profile"),
    owner: Schema.Literal("company_profile_contract"),
  }),
  accountRoleRules: Schema.Array(
    Schema.Struct({ accountId: Identifier, role: StatementRole }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  leafRows: Schema.Array(StatementLeafRow).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  subtotalDAG: Schema.Array(StatementSubtotal).check(Schema.isMaxLength(200)),
  mechanicalTransferRoles: Schema.Array(StatementRole).check(
    Schema.isMaxLength(2),
    Schema.isUnique(),
  ),
  comparativePolicy: Schema.Literal("own_mapping_with_classification_change_display"),
});

export type StatementMapping = typeof StatementMapping.Type;

export const SealedStatementMapping = Schema.Struct({
  ...StatementMapping.fields,
  checksum: Digest,
});

export type SealedStatementMapping = typeof SealedStatementMapping.Type;

export const StatementAccount = Schema.Struct({
  accountId: Identifier,
  code: Schema.String,
  name: Schema.String,
  role: StatementRole,
  version: Schema.String,
});

export type StatementAccount = typeof StatementAccount.Type;

export const StatementOpeningLine = Schema.Struct({
  accountId: Identifier,
  minor: SignedMinorUnits,
});

export type StatementOpeningLine = typeof StatementOpeningLine.Type;

export const StatementOpeningBasis = Schema.Struct({
  representation: Schema.Literals(["opening_set_voucher", "prior_native_balance"]),
  basisId: Identifier,
  openingVoucherId: Schema.NullOr(Identifier),
  reviewed: Schema.Literal(false),
});

export type StatementOpeningBasis = typeof StatementOpeningBasis.Type;

export const StatementComponent = Schema.Struct({
  componentId: Identifier,
  voucherId: Identifier,
  lineId: Identifier,
  sequence: MinorUnits,
  ordinal: Schema.Int,
  postingDate: AccountingDate,
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  description: Description,
  ownedTransfer: Schema.Boolean,
});

export type StatementComponent = typeof StatementComponent.Type;

export const StatementFactRevisions = Schema.Struct({
  bookProfileVersion: Schema.String,
  bookSequence: MinorUnits,
  fiscalYearId: Identifier,
  accountsDigest: Digest,
  movementCount: Schema.Int,
});

export type StatementFactRevisions = typeof StatementFactRevisions.Type;

export const StatementBasis = Schema.Struct({
  scope: Scope,
  fiscalYear: StatementFiscalYear,
  asOf: AccountingDate,
  plInterval: StatementInterval,
  ledgerBoundary: MinorUnits,
  recordedCutoff: Schema.String,
  openingBasis: StatementOpeningBasis,
  factRevisions: StatementFactRevisions,
  accounts: Schema.Array(StatementAccount).check(Schema.isMaxLength(500)),
  opening: Schema.Array(StatementOpeningLine).check(Schema.isMaxLength(500)),
  components: Schema.Array(StatementComponent).check(Schema.isMaxLength(20000)),
  completeMembership: Schema.Boolean,
});

export type StatementBasis = typeof StatementBasis.Type;

export const StatementContribution = Schema.Struct({
  rowId: Identifier,
  componentId: Identifier,
  voucherId: Identifier,
  lineId: Identifier,
  sequence: MinorUnits,
  ordinal: Schema.Int,
  postingDate: AccountingDate,
  accountId: Identifier,
  debitMinor: MinorUnits,
  creditMinor: MinorUnits,
  signedMinor: SignedMinorUnits,
  presentedMinor: SignedMinorUnits,
  description: Description,
});

export type StatementContribution = typeof StatementContribution.Type;

export const StatementModelRow = Schema.Struct({
  ordinal: Schema.Int,
  rowId: Identifier,
  kind: Schema.Literals(["leaf", "computed", "subtotal"]),
  label: Description,
  statement: StatementKind,
  side: Schema.NullOr(StatementSide),
  balanceClass: Schema.NullOr(BalanceClass),
  contributionRoles: Schema.Array(StatementRole).check(Schema.isMaxLength(3)),
  openingMinor: SignedMinorUnits,
  movementMinor: SignedMinorUnits,
  closingMinor: SignedMinorUnits,
  amountMinor: SignedMinorUnits,
});

export type StatementModelRow = typeof StatementModelRow.Type;

export const StatementCalculationNode = Schema.Struct({
  nodeId: Identifier,
  label: Description,
  memberRowIds: Schema.Array(Identifier).check(Schema.isMaxLength(200)),
  amountMinor: SignedMinorUnits,
});

export type StatementCalculationNode = typeof StatementCalculationNode.Type;

export const StatementDiagnosticCode = Schema.Literals([
  "unassigned_account",
  "uncovered_account_role",
  "excluded_account_balance",
  "unexplained_transfer_entry",
  "unreviewed_opening",
  "balance_identity_not_holding",
]);

export type StatementDiagnosticCode = typeof StatementDiagnosticCode.Type;

export const StatementDiagnostic = Schema.Struct({
  code: StatementDiagnosticCode,
  detail: Description,
  accountIds: Schema.Array(Identifier).check(Schema.isMaxLength(500)),
  amountMinor: SignedMinorUnits,
});

export type StatementDiagnostic = typeof StatementDiagnostic.Type;

export const StatementOutcome = Schema.Struct({
  profitForIntervalMinor: SignedMinorUnits,
  fiscalYtdProfitMinor: SignedMinorUnits,
  transferredYtdMinor: SignedMinorUnits,
  virtualUntransferredResultMinor: SignedMinorUnits,
  noFinancialEffect: Schema.Boolean,
});

export type StatementOutcome = typeof StatementOutcome.Type;

export const StatementBalance = Schema.Struct({
  assetMinor: SignedMinorUnits,
  liabilityMinor: SignedMinorUnits,
  equityMinor: SignedMinorUnits,
  virtualUntransferredResultMinor: SignedMinorUnits,
  residualMinor: SignedMinorUnits,
  balances: Schema.Boolean,
});

export type StatementBalance = typeof StatementBalance.Type;

export const StatementCoverage = Schema.Struct({
  arithmetic: Schema.Literals(["pass", "fail"]),
  external: Schema.Literal("not_established"),
  companyProfile: Schema.Literal("pending"),
  statutory: Schema.Literal(false),
  financialClose: Schema.Literal(false),
});

export type StatementCoverage = typeof StatementCoverage.Type;

export const StatementModel = Schema.Struct({
  rows: Schema.Array(StatementModelRow).check(Schema.isMaxLength(400)),
  calculationNodes: Schema.Array(StatementCalculationNode).check(Schema.isMaxLength(200)),
  contributions: Schema.Array(StatementContribution).check(Schema.isMaxLength(20000)),
  diagnostics: Schema.Array(StatementDiagnostic).check(Schema.isMaxLength(1000)),
  outcome: StatementOutcome,
  balance: StatementBalance,
  coverage: StatementCoverage,
});

export type StatementModel = typeof StatementModel.Type;

export const StatementFailureCode = Schema.Literals([
  "DuplicateAccountRole",
  "DuplicateRowId",
  "DuplicateNodeId",
  "ReservedRowId",
  "UnknownMember",
  "MemberCycle",
  "MixedStatementNode",
  "RoleStatementMismatch",
  "MixedBalanceClass",
  "RepeatedRoleDestination",
  "FiscalInterval",
  "ComponentAccountUnmapped",
  "IncompleteMembership",
]);

export type StatementFailureCode = typeof StatementFailureCode.Type;

export const StatementFailure = Schema.Struct({
  code: StatementFailureCode,
  message: Description,
});

export type StatementFailure = typeof StatementFailure.Type;

export type Checked<A> = Result.Result<A, StatementFailure>;

export type StatementResult = Checked<StatementModel>;

function fail(code: StatementFailureCode, message: string): Checked<never> {
  return Result.fail({ code, message });
}

function refuse<A>(result: Checked<A>): Checked<never> {
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : fail("ComponentAccountUnmapped", "A checked stage unexpectedly succeeded.");
}

function signed(debitMinor: string, creditMinor: string) {
  return BigInt(debitMinor) - BigInt(creditMinor);
}

function scale(value: bigint, sign: number) {
  return value * BigInt(sign);
}

function amount(value: bigint) {
  return value.toString();
}

function isMechanicalTransfer(
  component: StatementComponent,
  roles: ReadonlyMap<string, StatementRole>,
  transfers: ReadonlySet<StatementRole>,
) {
  const role = roles.get(component.accountId);

  return role !== undefined && transfers.has(role) && component.ownedTransfer;
}

function roleIndex(mapping: StatementMapping): Checked<ReadonlyMap<string, StatementRole>> {
  const roles = new Map<string, StatementRole>();

  for (const rule of mapping.accountRoleRules) {
    if (roles.has(rule.accountId)) {
      return fail(
        "DuplicateAccountRole",
        `A reviewed mapping assigns at most one role per account: ${rule.accountId}.`,
      );
    }

    roles.set(rule.accountId, rule.role);
  }

  return Result.succeed(roles);
}

function leafIndex(mapping: StatementMapping): Checked<ReadonlyMap<string, StatementLeafRow>> {
  const rows = new Map<string, StatementLeafRow>();
  const destination = new Map<StatementRole, string>();
  const nodeIds = new Set(mapping.subtotalDAG.map((node) => node.nodeId));

  for (const row of mapping.leafRows) {
    if (row.rowId === virtualResultRow) {
      return fail("ReservedRowId", `${VirtualResultRowId} is reserved for the computed result.`);
    }

    if (rows.has(row.rowId) || nodeIds.has(row.rowId)) {
      return fail("DuplicateRowId", `Statement row identifiers must be unique: ${row.rowId}.`);
    }

    if (row.statement === "balance_sheet") {
      const classes = new Set(row.contributionRoles.map(balanceClassFor));

      if (classes.size !== 1) {
        return fail(
          "MixedBalanceClass",
          `Balance-sheet row ${row.rowId} must hold exactly one asset, liability or equity class.`,
        );
      }
    }

    for (const role of row.contributionRoles) {
      if (statementForRole[role] !== row.statement) {
        return fail(
          "RoleStatementMismatch",
          `Role ${role} cannot contribute to the ${row.statement} row ${row.rowId}.`,
        );
      }

      const existing = destination.get(role);

      if (existing !== undefined) {
        return fail(
          "RepeatedRoleDestination",
          `Role ${role} already contributes to row ${existing}.`,
        );
      }

      destination.set(role, row.rowId);
    }

    rows.set(row.rowId, row);
  }

  for (const role of mapping.mechanicalTransferRoles) {
    if (!profitAndLossRoles.has(role)) {
      return fail(
        "RoleStatementMismatch",
        `Mechanical transfer role ${role} must be a nominal profit-and-loss role.`,
      );
    }
  }

  return Result.succeed(rows);
}

function nodeIndex(mapping: StatementMapping): Checked<ReadonlyMap<string, StatementSubtotal>> {
  const nodes = new Map<string, StatementSubtotal>();

  for (const node of mapping.subtotalDAG) {
    if (node.nodeId === virtualResultRow) {
      return fail("ReservedRowId", `${VirtualResultRowId} is reserved for the computed result.`);
    }

    if (nodes.has(node.nodeId)) {
      return fail(
        "DuplicateNodeId",
        `Calculation node identifiers must be unique: ${node.nodeId}.`,
      );
    }

    nodes.set(node.nodeId, node);
  }

  return Result.succeed(nodes);
}

function nodeOrder(
  nodes: ReadonlyMap<string, StatementSubtotal>,
): Checked<ReadonlyArray<StatementSubtotal>> {
  const remaining = new Map<string, number>();
  const dependents = new Map<string, Array<string>>();

  for (const node of nodes.values()) {
    remaining.set(node.nodeId, node.members.filter((member) => nodes.has(member.rowId)).length);

    for (const member of node.members) {
      if (!nodes.has(member.rowId)) continue;

      dependents.set(member.rowId, [...(dependents.get(member.rowId) ?? []), node.nodeId]);
    }
  }

  const ready = [...nodes.values()].filter((node) => remaining.get(node.nodeId) === 0);
  const ordered: Array<StatementSubtotal> = [];

  while (ready.length > 0) {
    const node = ready.shift();

    if (node === undefined) break;

    ordered.push(node);

    for (const dependentId of dependents.get(node.nodeId) ?? []) {
      const left = (remaining.get(dependentId) ?? 0) - 1;

      remaining.set(dependentId, left);

      if (left === 0) {
        const dependent = nodes.get(dependentId);

        if (dependent !== undefined) ready.push(dependent);
      }
    }
  }

  if (ordered.length !== nodes.size) {
    return fail("MemberCycle", "Calculation node members must form an acyclic graph.");
  }

  return Result.succeed(ordered);
}

function validateBasis(basis: StatementBasis): Checked<true> {
  const year = basis.fiscalYear;

  if (basis.asOf < year.startsOn || basis.asOf > year.endsOn) {
    return fail("FiscalInterval", "The as-of date must fall inside the selected fiscal year.");
  }

  const interval = basis.plInterval;

  if (
    interval.startsOn > interval.endsOn ||
    interval.startsOn < year.startsOn ||
    interval.endsOn > basis.asOf
  ) {
    return fail(
      "FiscalInterval",
      "The profit-and-loss interval must fall inside the fiscal year up to the as-of date.",
    );
  }

  if (!basis.completeMembership) {
    return fail(
      "IncompleteMembership",
      "A statement snapshot requires the complete captured account and movement membership.",
    );
  }

  for (const component of basis.components) {
    if (!basis.accounts.some((account) => account.accountId === component.accountId)) {
      return fail(
        "ComponentAccountUnmapped",
        `Captured component ${component.componentId} names an account outside the capture.`,
      );
    }
  }

  return Result.succeed(true);
}

type AccountActivity = {
  readonly opening: bigint;
  readonly year: bigint;
  readonly interval: bigint;
};

function accountActivity(
  basis: StatementBasis,
  roles: ReadonlyMap<string, StatementRole>,
  transfers: ReadonlySet<StatementRole>,
) {
  const activity = new Map<string, AccountActivity>();

  for (const account of basis.accounts) {
    activity.set(account.accountId, { opening: 0n, year: 0n, interval: 0n });
  }

  for (const line of basis.opening) {
    const current = activity.get(line.accountId);

    if (current === undefined) continue;

    activity.set(line.accountId, { ...current, opening: current.opening + BigInt(line.minor) });
  }

  for (const component of basis.components) {
    const current = activity.get(component.accountId);

    if (current === undefined) continue;

    if (isMechanicalTransfer(component, roles, transfers)) continue;

    const value = signed(component.debitMinor, component.creditMinor);

    const inInterval =
      component.postingDate >= basis.plInterval.startsOn &&
      component.postingDate <= basis.plInterval.endsOn;

    activity.set(component.accountId, {
      ...current,
      year: current.year + value,
      interval: current.interval + (inInterval ? value : 0n),
    });
  }

  return activity;
}

type LeafAmounts = {
  readonly row: StatementLeafRow;
  readonly balanceClass: BalanceClass | null;
  opening: bigint;
  movement: bigint;
  closing: bigint;
};

function rowBalanceClass(row: StatementLeafRow) {
  const role = row.contributionRoles[0];

  return row.statement === "balance_sheet" && role !== undefined ? balanceClassFor(role) : null;
}

function leafAmounts(
  rows: ReadonlyMap<string, StatementLeafRow>,
  activity: ReadonlyMap<string, AccountActivity>,
  roles: ReadonlyMap<string, StatementRole>,
) {
  const amounts = new Map<string, LeafAmounts>();

  for (const row of rows.values()) {
    amounts.set(row.rowId, {
      row,
      balanceClass: rowBalanceClass(row),
      opening: 0n,
      movement: 0n,
      closing: 0n,
    });
  }

  for (const [accountId, role] of roles) {
    const totals = activity.get(accountId);

    if (totals === undefined || role === "excluded") continue;

    for (const row of rows.values()) {
      if (!row.contributionRoles.includes(role)) continue;

      const leaf = amounts.get(row.rowId);

      if (leaf === undefined) continue;

      const opening = row.statement === "profit_and_loss" ? 0n : totals.opening;
      const movement = row.statement === "profit_and_loss" ? totals.interval : totals.year;

      amounts.set(row.rowId, {
        ...leaf,
        opening: leaf.opening + opening,
        movement: leaf.movement + movement,
        closing: leaf.closing + opening + movement,
      });
    }
  }

  return amounts;
}

function contributionSet(
  rows: ReadonlyMap<string, StatementLeafRow>,
  roles: ReadonlyMap<string, StatementRole>,
  transfers: ReadonlySet<StatementRole>,
  basis: StatementBasis,
) {
  const retained: Array<StatementContribution> = [];

  for (const component of basis.components) {
    const role = roles.get(component.accountId);
    const destination = role === undefined ? undefined : rowIdFor(rows, role);

    if (role === undefined || destination === undefined) continue;

    if (isMechanicalTransfer(component, roles, transfers)) continue;

    const inInterval =
      component.postingDate >= basis.plInterval.startsOn &&
      component.postingDate <= basis.plInterval.endsOn;

    if (destination.statement === "profit_and_loss" && !inInterval) continue;

    const value = signed(component.debitMinor, component.creditMinor);

    retained.push({
      rowId: destination.rowId,
      componentId: component.componentId,
      voucherId: component.voucherId,
      lineId: component.lineId,
      sequence: component.sequence,
      ordinal: component.ordinal,
      postingDate: component.postingDate,
      accountId: component.accountId,
      debitMinor: component.debitMinor,
      creditMinor: component.creditMinor,
      signedMinor: amount(value),
      presentedMinor: amount(scale(value, presentationSigns[role])),
      description: component.description,
    });
  }

  return retained
    .sort(
      (left, right) =>
        left.rowId.localeCompare(right.rowId) ||
        (BigInt(left.sequence) < BigInt(right.sequence) ? -1 : 1) ||
        left.ordinal - right.ordinal,
    )
    .map((contribution, index) => ({ ...contribution, ordinal: index + 1 }));
}

function rowIdFor(rows: ReadonlyMap<string, StatementLeafRow>, role: StatementRole) {
  for (const row of rows.values()) {
    if (row.contributionRoles.includes(role)) return row;
  }

  return undefined;
}

function transferredResult(basis: StatementBasis, roles: ReadonlyMap<string, StatementRole>) {
  let transferredYtd = 0n;

  for (const component of basis.components) {
    if (!component.ownedTransfer) continue;

    if (roles.get(component.accountId) !== "equity") continue;

    transferredYtd += -signed(component.debitMinor, component.creditMinor);
  }

  return transferredYtd;
}

function profitOutcome(
  activity: ReadonlyMap<string, AccountActivity>,
  roles: ReadonlyMap<string, StatementRole>,
) {
  let interval = 0n;
  let yearToDate = 0n;

  for (const [accountId, role] of roles) {
    if (!profitAndLossRoles.has(role)) continue;

    const totals = activity.get(accountId);

    if (totals === undefined) continue;

    interval += -totals.interval;
    yearToDate += -totals.year;
  }

  return { interval, yearToDate };
}

function leafRow(ordinal: number, entry: LeafAmounts, sign: PresentationSign): StatementModelRow {
  const { row } = entry;

  return {
    ordinal,
    rowId: row.rowId,
    kind: "leaf",
    label: row.label,
    statement: row.statement,
    side: row.side,
    balanceClass: entry.balanceClass,
    contributionRoles: [...row.contributionRoles],
    openingMinor: amount(entry.opening),
    movementMinor: amount(entry.movement),
    closingMinor: amount(entry.closing),
    amountMinor: amount(scale(entry.closing, sign)),
  };
}

function computedRow(ordinal: number, virtualResult: bigint): StatementModelRow {
  return {
    ordinal,
    rowId: virtualResultRow,
    kind: "computed",
    label: "Untransferred result for the fiscal year to date",
    statement: "balance_sheet",
    side: "credit",
    balanceClass: "equity",
    contributionRoles: [],
    openingMinor: "0",
    movementMinor: amount(virtualResult),
    closingMinor: amount(virtualResult),
    amountMinor: amount(virtualResult),
  };
}

function subtotalRow(
  ordinal: number,
  node: StatementSubtotal,
  total: bigint,
  statement: StatementKind,
): StatementModelRow {
  return {
    ordinal,
    rowId: node.nodeId,
    kind: "subtotal",
    label: node.label,
    statement,
    side: node.members.every((member) => member.sign === -1) ? "credit" : "debit",
    balanceClass: null,
    contributionRoles: [],
    openingMinor: "0",
    movementMinor: amount(total),
    closingMinor: amount(total),
    amountMinor: amount(total),
  };
}

type Evaluation = {
  readonly calculated: Array<StatementCalculationNode>;
  readonly statements: ReadonlyMap<string, StatementKind>;
};

function evaluateNodes(
  nodes: ReadonlyArray<StatementSubtotal>,
  totals: Map<string, bigint>,
  statements: Map<string, StatementKind>,
): Checked<Evaluation> {
  const calculated: Array<StatementCalculationNode> = [];

  for (const node of nodes) {
    let total = 0n;
    const kinds = new Set<StatementKind>();

    for (const member of node.members) {
      const value = totals.get(member.rowId);
      const kind = statements.get(member.rowId);

      if (value === undefined || kind === undefined) {
        return fail("UnknownMember", `Node ${node.nodeId} references unknown row ${member.rowId}.`);
      }

      kinds.add(kind);
      total += scale(value, member.sign);
    }

    if (kinds.size !== 1) {
      return fail(
        "MixedStatementNode",
        `Node ${node.nodeId} must calculate over rows of one statement only.`,
      );
    }

    totals.set(node.nodeId, total);
    statements.set(node.nodeId, [...kinds][0] ?? "profit_and_loss");
    calculated.push({
      nodeId: node.nodeId,
      label: node.label,
      memberRowIds: node.members.map((member) => member.rowId),
      amountMinor: amount(total),
    });
  }

  return Result.succeed({ calculated, statements } satisfies Evaluation);
}

function groupTotals(rows: ReadonlyArray<StatementModelRow>) {
  const groups = {
    asset: 0n,
    liability: 0n,
    equity: 0n,
  } satisfies Record<BalanceClass, bigint>;

  for (const row of rows) {
    if (row.balanceClass === null) continue;

    if (row.kind === "computed") continue;

    groups[row.balanceClass] += BigInt(row.amountMinor);
  }

  return groups;
}

function accountDiagnostics(
  basis: StatementBasis,
  rows: ReadonlyMap<string, StatementLeafRow>,
  roles: ReadonlyMap<string, StatementRole>,
  activity: ReadonlyMap<string, AccountActivity>,
) {
  const found: Array<StatementDiagnostic> = [];
  const covered = new Set([...rows.values()].flatMap((row) => row.contributionRoles));

  for (const account of basis.accounts) {
    const totals = activity.get(account.accountId);
    const closing = totals === undefined ? 0n : totals.opening + totals.year;

    if (closing === 0n && totals?.year === 0n) continue;

    const role = roles.get(account.accountId);

    if (role === undefined) {
      found.push({
        code: "unassigned_account",
        detail: `Account ${account.accountId} carries a retained balance without a reviewed role.`,
        accountIds: [account.accountId],
        amountMinor: amount(closing),
      });
      continue;
    }

    if (role === "excluded") {
      found.push({
        code: "excluded_account_balance",
        detail: `Account ${account.accountId} is excluded from the statement but is not zero.`,
        accountIds: [account.accountId],
        amountMinor: amount(closing),
      });
      continue;
    }

    if (!covered.has(role)) {
      found.push({
        code: "uncovered_account_role",
        detail: `No reviewed leaf row accepts role ${role} for account ${account.accountId}.`,
        accountIds: [account.accountId],
        amountMinor: amount(closing),
      });
    }
  }

  return found;
}

function transferDiagnostics(
  basis: StatementBasis,
  roles: ReadonlyMap<string, StatementRole>,
  transfers: ReadonlySet<StatementRole>,
) {
  const found: Array<StatementDiagnostic> = [];

  const ownedVouchers = new Set(
    basis.components
      .filter((component) => component.ownedTransfer)
      .map((component) => component.voucherId),
  );

  for (const component of basis.components) {
    const role = roles.get(component.accountId);

    if (role === undefined || !transfers.has(role) || component.ownedTransfer) continue;

    if (!ownedVouchers.has(component.voucherId)) continue;

    found.push({
      code: "unexplained_transfer_entry",
      detail: `Component ${component.componentId} shares a result-transfer voucher without an owned transfer receipt. It stays in the profit and loss.`,
      accountIds: [component.accountId],
      amountMinor: amount(signed(component.debitMinor, component.creditMinor)),
    });
  }

  return found;
}

export function calculateStatementModel(
  mapping: StatementMapping,
  basis: StatementBasis,
): StatementResult {
  const known = validateBasis(basis);

  if (Result.isFailure(known)) return refuse(known);
  const roles = roleIndex(mapping);

  if (Result.isFailure(roles)) return refuse(roles);
  const leaves = leafIndex(mapping);

  if (Result.isFailure(leaves)) return refuse(leaves);
  const nodes = nodeIndex(mapping);

  if (Result.isFailure(nodes)) return refuse(nodes);
  const ordered = nodeOrder(nodes.success);

  if (Result.isFailure(ordered)) return refuse(ordered);
  const transfers = new Set(mapping.mechanicalTransferRoles);
  const activity = accountActivity(basis, roles.success, transfers);
  const amounts = leafAmounts(leaves.success, activity, roles.success);
  const profit = profitOutcome(activity, roles.success);
  const transferredYtd = transferredResult(basis, roles.success);
  const virtualResult = profit.yearToDate - transferredYtd;
  const rows: Array<StatementModelRow> = [];

  for (const entry of amounts.values()) {
    const role = entry.row.contributionRoles[0];

    if (role === undefined) continue;

    rows.push(leafRow(rows.length + 1, entry, presentationSigns[role]));
  }

  rows.push(computedRow(rows.length + 1, virtualResult));
  const totals = new Map(rows.map((row) => [row.rowId, BigInt(row.amountMinor)]));
  const statements = new Map(rows.map((row) => [row.rowId, row.statement]));
  const evaluated = evaluateNodes(ordered.success, totals, statements);

  if (Result.isFailure(evaluated)) return refuse(evaluated);

  for (const node of ordered.success) {
    rows.push(
      subtotalRow(
        rows.length + 1,
        node,
        totals.get(node.nodeId) ?? 0n,
        evaluated.success.statements.get(node.nodeId) ?? "profit_and_loss",
      ),
    );
  }

  const groups = groupTotals(rows.filter((row) => row.kind !== "subtotal"));
  const residual = groups.asset - groups.liability - groups.equity - virtualResult;

  const balance = {
    assetMinor: amount(groups.asset),
    liabilityMinor: amount(groups.liability),
    equityMinor: amount(groups.equity),
    virtualUntransferredResultMinor: amount(virtualResult),
    residualMinor: amount(residual),
    balances: residual === 0n,
  };

  const found = [
    ...accountDiagnostics(basis, leaves.success, roles.success, activity),
    ...transferDiagnostics(basis, roles.success, transfers),
  ];

  if (basis.openingBasis.representation === "prior_native_balance") {
    found.push({
      code: "unreviewed_opening",
      detail:
        "Opening uses committed prior native balances. No reviewed opening set or opening voucher is retained.",
      accountIds: [],
      amountMinor: "0",
    });
  }

  if (!balance.balances) {
    found.push({
      code: "balance_identity_not_holding",
      detail: `Assets do not equal liabilities plus equity. Residual ${balance.residualMinor}.`,
      accountIds: [],
      amountMinor: balance.residualMinor,
    });
  }

  const decoded = Schema.decodeResult(StatementModel)({
    rows,
    calculationNodes: evaluated.success.calculated,
    contributions: contributionSet(leaves.success, roles.success, transfers, basis),
    diagnostics: found,
    outcome: {
      profitForIntervalMinor: amount(profit.interval),
      fiscalYtdProfitMinor: amount(profit.yearToDate),
      transferredYtdMinor: amount(transferredYtd),
      virtualUntransferredResultMinor: amount(virtualResult),
      noFinancialEffect: profit.yearToDate === 0n && transferredYtd === 0n,
    },
    balance,
    coverage: {
      arithmetic: balance.balances ? ("pass" as const) : ("fail" as const),
      external: "not_established" as const,
      companyProfile: "pending" as const,
      statutory: false as const,
      financialClose: false as const,
    },
  });

  if (Result.isFailure(decoded)) {
    return fail("ComponentAccountUnmapped", decoded.failure.message);
  }

  return Result.succeed(decoded.success);
}

export { balanceSheetRoles, profitAndLossRoles };
