import type * as Onboarding from "@open-erp/contracts/onboarding";
import { formatDate } from "./data";
import type { Lifecycle, Workspace } from "./lifecycle";

type Category = typeof Onboarding.SourceCategory.Type;

export function originalCoverage(workspace: Workspace, lifecycle: Lifecycle) {
  return lifecycle.controls
    .filter(
      (item) =>
        item.kind === "historical_originals" &&
        item.asOf === workspace.case.configuration.dates.historyEndsOn,
    )
    .toSorted(
      (left, right) =>
        right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
    )[0]?.originalCoverage;
}

export function invoiceInventory(category: Category, workspace: Workspace, lifecycle: Lifecycle) {
  const kind = category === "sales" ? "sales_open_items" : "purchase_open_items";

  return lifecycle.controls
    .filter(
      (item) =>
        item.kind === kind && item.asOf === workspace.case.configuration.dates.historyEndsOn,
    )
    .toSorted(
      (left, right) =>
        right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
    )[0]?.openItemDetails;
}

export function sourceScope(category: Category, workspace: Workspace, lifecycle: Lifecycle) {
  const sources = workspace.sources.filter((item) => item.category === category);
  const dates = workspace.case.configuration.dates;

  if (category === "previous_books") {
    const preview = lifecycle.projection.importPreviews
      .filter((item) => sources.some((source) => source.occurrence.id === item.occurrenceId))
      .toSorted((left, right) => right.ordinal - left.ordinal)[0];

    if (preview)
      return `${sources.find((item) => item.occurrence.id === preview.occurrenceId)?.occurrence.filename}, ${formatDate(dates.historyStartsOn, false)} till ${formatDate(dates.historyEndsOn)}, ${preview.vouchers.length} verifikat`;
  }

  if (category === "bank" && lifecycle.projection.bankStatements.length) {
    const statements = lifecycle.projection.bankStatements;
    const startsOn = statements.map((item) => item.startsOn).toSorted()[0];

    const endsOn = statements
      .map((item) => item.endsOn)
      .toSorted()
      .at(-1);

    const accountIds = new Set(statements.map((item) => item.accountId));

    const codes = lifecycle.projection.accounts
      .filter((item) => accountIds.has(item.id))
      .map((item) => item.code);

    return `Konto ${codes.join(", ")}, ${formatDate(startsOn ?? null, false)} till ${formatDate(endsOn ?? null)}, ${statements.reduce((total, item) => total + item.rows.length, 0)} bankhändelser`;
  }

  if (category === "sales" || category === "purchases") {
    const items = invoiceInventory(category, workspace, lifecycle);

    if (items)
      return `${items.length} st, ${items.filter((item) => item.outstandingMinor !== "0").length} obetalda`;
  }

  if (category === "assets") {
    const register = lifecycle.controls
      .filter(
        (item) => item.kind === "historical_asset_register" && item.asOf === dates.historyEndsOn,
      )
      .toSorted(
        (left, right) =>
          right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
      )[0]?.assetRegister;

    if (register) return `${register.rows.length} st`;
  }

  if (category === "other") {
    const coverage = originalCoverage(workspace, lifecycle);

    if (coverage)
      return `${coverage.rows.filter((item) => item.occurrenceId !== null).length} bevarade original av ${coverage.rows.length} förväntade`;
  }

  if (
    category === "payroll" &&
    lifecycle.controls.some(
      (item) => item.kind === "historical_payroll_handoff" && item.asOf === dates.historyEndsOn,
    )
  )
    return "Tidigare löneperioder finns kvar i tidigare system";

  return sources.map((item) => item.occurrence.filename).join(", ");
}
