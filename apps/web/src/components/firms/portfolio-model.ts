import type * as Firms from "@open-erp/contracts/firms";
import { compareClientDeadlines, nextClientDeadline } from "./client-deadline";
import { portfolioPageSize } from "./portfolio-pagination";
import type { PortfolioFilters } from "./portfolio";
import type { Locale } from "@/paraglide/runtime";

type Facts = typeof Firms.PortfolioClientFacts.Type;

export type ActiveRequest = typeof Firms.AccessRequest.Type & { readonly state: "requested" };

export type RequestWorkspace = Pick<typeof Firms.Workspace.Type, "firm" | "actorId" | "members">;

export type ClosingState =
  | { kind: "unknown" }
  | { kind: "locked" }
  | { kind: "blocked"; failed: NonNullable<Facts["closing"]>["checks"] }
  | { kind: "clear" };

export type PortfolioRow =
  | {
      kind: "client";
      key: string;
      name: string;
      client: typeof Firms.Client.Type;
      facts: Facts;
      closing: ClosingState;
      deadline: ReturnType<typeof nextClientDeadline>;
    }
  | { kind: "request"; key: string; name: string; request: ActiveRequest };

export const portfolioGroups = ["blocked", "request", "clear", "locked", "unknown"] as const;

export type PortfolioGroup = (typeof portfolioGroups)[number];

export function classifyClosing(facts: Facts): ClosingState {
  const { closing, period, scope } = facts;

  if (!period) return { kind: "unknown" };

  if (period.locked) return { kind: "locked" };

  if (
    !closing ||
    closing.scope.entityId !== scope.entityId ||
    closing.scope.bookId !== scope.bookId ||
    closing.periodId !== period.id ||
    closing.startsOn !== period.startsOn ||
    closing.endsOn !== period.endsOn ||
    closing.locked !== period.locked
  )
    return { kind: "unknown" };

  const failed = closing.checks.filter((check) => !check.passed);

  if (failed.length) return { kind: "blocked", failed };

  return closing.technicalCloseAllowed ? { kind: "clear" } : { kind: "unknown" };
}

export function rowGroup(row: PortfolioRow): PortfolioGroup {
  return row.kind === "request" ? "request" : row.closing.kind;
}

export function portfolioView(
  portfolio: typeof Firms.Portfolio.Type,
  filters: PortfolioFilters,
  today: string,
  locale: Locale,
) {
  const { workspace } = portfolio;
  const search = (filters.q ?? "").toLocaleLowerCase(locale);
  const view = filters.view ?? "all";
  const rows: PortfolioRow[] = [];

  for (const client of workspace.clients) {
    if (
      !client.book.name.toLocaleLowerCase(locale).includes(search) ||
      (view === "mine" && (!client.leadAvailable || client.leadId !== workspace.actorId)) ||
      (view === "due" && (client.nextReviewOn === null || client.nextReviewOn > today)) ||
      (view === "unassigned" && client.leadAvailable)
    )
      continue;

    const facts = portfolio.clients.find(
      (item) =>
        item.scope.entityId === client.book.entityId && item.scope.bookId === client.book.id,
    );

    if (!facts) throw new Error("The permitted client observation is missing");

    rows.push({
      kind: "client",
      key: `${workspace.firm.id}/client/${client.book.entityId}/${client.book.id}`,
      name: client.book.name,
      client,
      facts,
      closing: classifyClosing(facts),
      deadline: nextClientDeadline(facts),
    });
  }

  for (const request of workspace.accessRequests) {
    if (
      request.state !== "requested" ||
      !request.clientName.toLocaleLowerCase(locale).includes(search) ||
      (view === "mine" && (!request.leadAvailable || request.leadId !== workspace.actorId)) ||
      view === "due" ||
      (view === "unassigned" && request.leadAvailable)
    )
      continue;

    rows.push({
      kind: "request",
      key: `${workspace.firm.id}/request/${request.id}`,
      name: request.clientName,
      request: { ...request, state: "requested" },
    });
  }

  const groups = portfolioGroups.map((kind) => ({
    kind,
    rows: rows
      .filter((row) => rowGroup(row) === kind)
      .sort(
        (a, b) =>
          compareClientDeadlines(
            a.kind === "client" ? a.deadline : null,
            b.kind === "client" ? b.deadline : null,
          ) ||
          a.name.localeCompare(b.name, locale) ||
          a.key.localeCompare(b.key),
      ),
  }));

  const sorted = groups.flatMap((group) => group.rows);

  const page = Math.min(
    filters.page ?? 0,
    Math.max(0, Math.ceil(rows.length / portfolioPageSize) - 1),
  );

  return {
    groups: groups.map((group) => ({ kind: group.kind, total: group.rows.length })),
    total: rows.length,
    page,
    visible: sorted.slice(page * portfolioPageSize, (page + 1) * portfolioPageSize),
  };
}
