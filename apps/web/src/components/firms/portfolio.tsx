import { useState, type ReactNode } from "react";
import { CircleAlert, Clock3, CircleCheck, LockKeyhole, CircleHelp } from "lucide-react";
import type * as Firms from "@open-erp/contracts/firms";
import { Button } from "@open-erp/ui/components/button";
import {
  PageCaption,
  PageEmpty,
  RegisterSearch,
  RegisterChoices,
} from "@open-erp/ui/components/accounting-page";
import { ClientClosing } from "./client-closing";
import { ClientDialog } from "./client-dialog";
import { PortfolioPagination } from "./portfolio-pagination";
import { PortfolioDetail, leadName } from "./portfolio-detail";
import { AccessRequestDialog, type RequestEditor } from "./access-request-dialog";
import {
  portfolioView,
  rowGroup,
  type PortfolioGroup as PortfolioGroupKind,
  type PortfolioRow,
} from "./portfolio-model";
import {
  PortfolioFrame,
  PortfolioGroup,
  PortfolioRow as PortfolioRowControl,
} from "@open-erp/ui/components/firm-portfolio";
import type { Books } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export type PortfolioFilters = {
  firm?: string;
  q?: string;
  view?: "all" | "mine" | "due" | "unassigned";
  page?: number;
};

export function FirmPortfolio(props: {
  portfolio: typeof Firms.Portfolio.Type;
  books: typeof Books.Type;
  locale: Locale;
  filters: PortfolioFilters;
  onFilters: (filters: PortfolioFilters) => void;
  navigation?: ReactNode;
}) {
  const { locale } = props;
  const workspace = props.portfolio.workspace;
  const sv = locale === "sv";
  const search = props.filters.q ?? "";
  const view = props.filters.view ?? "all";
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());
  const projection = portfolioView(props.portfolio, props.filters, today, locale);
  const context = JSON.stringify([workspace.firm.id, search, view, projection.page]);

  const [selection, setSelection] = useState(() => ({
    context,
    key: projection.visible[0]?.key ?? null,
  }));

  const [editing, setEditing] = useState<{ client: typeof Firms.Client.Type | null } | null>(null);
  const [requestEditor, setRequestEditor] = useState<RequestEditor | null>(null);

  const selected =
    selection.context === context
      ? (projection.visible.find((row) => row.key === selection.key) ?? null)
      : null;

  if (selection.context !== context || (selection.key !== null && selected === null))
    setSelection({ context, key: null });

  const setFilters = (filters: PortfolioFilters) => {
    setSelection({ context, key: null });
    props.onFilters({ ...filters, firm: workspace.firm.id });
  };

  const portfolioHref = portfolioPath(workspace.firm.id, search, view, projection.page);

  const canLink =
    workspace.firm.role === "admin" &&
    props.books.some(
      (book) =>
        book.role === "operator" && !workspace.clients.some((client) => client.book.id === book.id),
    );

  return (
    <>
      <PortfolioFrame
        title={sv ? "Klienter" : "Clients"}
        actions={
          <>
            {props.navigation}
            <Button static variant="outline" onClick={() => setRequestEditor({ kind: "create" })}>
              {sv ? "Begär åtkomst" : "Request access"}
            </Button>
            {canLink ? (
              <Button static onClick={() => setEditing({ client: null })}>
                {sv ? "Lägg till klient" : "Add client"}
              </Button>
            ) : null}
          </>
        }
        search={
          <RegisterSearch
            compact
            aria-label={sv ? "Sök klienter" : "Search clients"}
            placeholder={sv ? "Sök klienter…" : "Search clients…"}
            value={search}
            onChange={(event) =>
              setFilters({ ...props.filters, q: event.target.value || undefined, page: undefined })
            }
          />
        }
        filters={
          <RegisterChoices
            label={sv ? "Visa klienter" : "Client view"}
            value={view}
            onValueChange={(value) => {
              if (value === "all" || value === "mine" || value === "due" || value === "unassigned")
                setFilters({ ...props.filters, view: value, page: undefined });
            }}
            options={[
              { value: "all", label: sv ? "Alla mina klienter" : "All accessible clients" },
              { value: "mine", label: sv ? "Jag är ansvarig" : "Assigned to me" },
              { value: "due", label: sv ? "Dags för avstämning" : "Review due" },
              { value: "unassigned", label: sv ? "Saknar ansvarig" : "Unassigned" },
            ]}
          />
        }
        detail={
          <PortfolioDetail
            row={selected}
            workspace={workspace}
            locale={locale}
            portfolioHref={portfolioHref}
            onClientEdit={(client) => setEditing({ client })}
            onRequestEdit={setRequestEditor}
          />
        }
        footer={
          <>
            {projection.total ? (
              <PortfolioPagination
                total={projection.total}
                page={projection.page}
                locale={locale}
                includesRequests={projection.groups.some(
                  (group) => group.kind === "request" && group.total > 0,
                )}
                onPage={(page) => setFilters({ ...props.filters, page })}
              />
            ) : null}
            <PageCaption>
              {sv
                ? "Här visas klienter vars bokföring du har tillgång till och byråns lokala åtkomstförfrågningar."
                : "Accessible client books and the firm's local access requests appear here."}
            </PageCaption>
            <PageCaption>
              {sv ? "Läst" : "Checked"}{" "}
              {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
                new Date(props.portfolio.observedUntil),
              )}
            </PageCaption>
          </>
        }
      >
        {projection.visible.length ? (
          projection.groups.map((group) => {
            const rows = projection.visible.filter((row) => rowGroup(row) === group.kind);

            return rows.length ? (
              <PortfolioGroup
                key={group.kind}
                first={projection.visible[0] && rowGroup(projection.visible[0]) === group.kind}
                title={groupLabel(group.kind, sv)}
                total={group.total}
              >
                {rows.map((row) => (
                  <PortfolioRowButton
                    key={row.key}
                    row={row}
                    workspace={workspace}
                    locale={locale}
                    selected={selected?.key === row.key}
                    onSelect={() => setSelection({ context, key: row.key })}
                  />
                ))}
              </PortfolioGroup>
            ) : null;
          })
        ) : (
          <PageEmpty
            title={sv ? "Inga matchande klienter" : "No matching clients"}
            detail={
              sv
                ? "Prova ett annat namn eller en annan vy. Kopplade företag visas när du har bokbehörighet."
                : "Try another name or view. Linked companies appear when you have book access."
            }
          />
        )}
      </PortfolioFrame>
      {editing ? (
        <ClientDialog
          workspace={workspace}
          books={props.books}
          locale={locale}
          client={editing.client}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {requestEditor ? (
        <AccessRequestDialog
          workspace={workspace}
          editor={requestEditor}
          locale={locale}
          onClose={() => setRequestEditor(null)}
        />
      ) : null}
    </>
  );
}

const groupTone = {
  blocked: "warning",
  request: "neutral",
  clear: "success",
  locked: "neutral",
  unknown: "neutral",
} satisfies Record<PortfolioGroupKind, "warning" | "success" | "neutral">;

function PortfolioRowButton(props: {
  row: PortfolioRow;
  workspace: typeof Firms.Workspace.Type;
  locale: Locale;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, workspace, locale } = props;
  const sv = locale === "sv";
  const group = rowGroup(row);

  const Icon = {
    blocked: CircleAlert,
    request: Clock3,
    clear: CircleCheck,
    locked: LockKeyhole,
    unknown: CircleHelp,
  }[group];

  const record = row.kind === "client" ? row.client : row.request;
  const lead = leadName(record.leadId, record.leadAvailable, workspace, sv);

  const secondary =
    row.kind === "request"
      ? `${lead}, ${sv ? "åtkomst begärd" : "access requested"}`
      : `${lead}, ${row.facts.openTasks ?? "?"} ${sv ? "att granska" : "to review"}, ${row.facts.period ? (row.facts.period.locked ? (sv ? "period låst" : "period locked") : sv ? "period öppen" : "period open") : sv ? "ingen period" : "no period"}`;

  const deadline = row.kind === "client" ? row.deadline : null;

  return (
    <PortfolioRowControl
      name={row.name}
      secondary={secondary}
      status={
        row.kind === "client" ? (
          <ClientClosing state={row.closing} locale={locale} />
        ) : sv ? (
          "Åtkomst begärd"
        ) : (
          "Access requested"
        )
      }
      date={
        deadline
          ? new Intl.DateTimeFormat(locale, {
              day: "numeric",
              month: "short",
              timeZone: deadline.time_zone,
            }).format(new Date(deadline.due_at))
          : sv
            ? "Okänd"
            : "Unknown"
      }
      icon={<Icon size={14} />}
      tone={groupTone[group]}
      selected={props.selected}
      onSelect={props.onSelect}
    />
  );
}

function groupLabel(group: PortfolioGroupKind, sv: boolean) {
  switch (group) {
    case "blocked":
      return sv ? "Hinder för bokslut" : "Closing blockers";
    case "request":
      return sv ? "Åtkomst att följa upp" : "Access to follow up";
    case "clear":
      return sv ? "Inga tekniska hinder" : "No technical blockers";
    case "locked":
      return sv ? "Låsta perioder" : "Locked periods";
    case "unknown":
      return sv ? "Okänd bokslutsstatus" : "Unknown closing status";
  }
}

function portfolioPath(firmId: string, search: string, view: string, page: number) {
  const params = new URLSearchParams({ firm: firmId, tab: "clients" });

  if (search) params.set("q", search);

  if (view !== "all") params.set("view", view);

  if (page) params.set("page", String(page));

  return `/firms?${params}`;
}
