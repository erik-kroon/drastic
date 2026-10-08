import { useState } from "react";
import * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import {
  PageCaption,
  PageEmpty,
  RegisterSearch,
  RegisterChoices,
} from "@open-erp/ui/components/accounting-page";
import { ClientPeriod } from "./client-period";
import { ClientBank } from "./client-bank";
import { ClientClosing } from "./client-closing";
import { ClientDeadline, nextClientDeadline, compareClientDeadlines } from "./client-deadline";
import { ClientDialog } from "./client-dialog";
import { PortfolioPagination, portfolioPageSize } from "./portfolio-pagination";
import { rememberPortfolio } from "./portfolio-return";
import { workspacePath } from "@/lib/book-context";
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
}) {
  const { locale } = props;
  const workspace = props.portfolio.workspace;
  const sv = locale === "sv";
  const search = props.filters.q ?? "";
  const view = props.filters.view ?? "all";
  const page = props.filters.page ?? 0;

  const setFilters = (filters: PortfolioFilters) =>
    props.onFilters({ ...filters, firm: workspace.firm.id });

  const [editing, setEditing] = useState<{ client: typeof Firms.Client.Type | null } | null>(null);
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());

  const deadlines = new Map(
    props.portfolio.clients.map((facts) => [facts.scope.bookId, nextClientDeadline(facts)]),
  );

  const filtered = workspace.clients.filter((client) =>
    matchesPortfolio(client, workspace.actorId, search, view, today, locale),
  );

  const sorted = [...filtered].sort(
    (a, b) =>
      compareClientDeadlines(deadlines.get(a.book.id) ?? null, deadlines.get(b.book.id) ?? null) ||
      a.book.name.localeCompare(b.book.name, locale) ||
      a.book.id.localeCompare(b.book.id),
  );

  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / portfolioPageSize) - 1));

  const visible = sorted.slice(
    currentPage * portfolioPageSize,
    (currentPage + 1) * portfolioPageSize,
  );

  const portfolioHref = portfolioPath(workspace.firm.id, search, view, currentPage);

  const canLink =
    workspace.firm.role === "admin" &&
    props.books.some(
      (book) =>
        book.role === "operator" && !workspace.clients.some((client) => client.book.id === book.id),
    );

  return (
    <Box display="grid" gap="lg">
      <RecordHeading
        title={sv ? "Klienter" : "Clients"}
        subtitle={
          sv
            ? "Planera nästa avstämning och fortsätt arbetet i varje företag."
            : "Plan the next review and continue work in each company."
        }
        action={
          canLink ? (
            <Button onClick={() => setEditing({ client: null })}>
              {sv ? "Lägg till klient" : "Add client"}
            </Button>
          ) : null
        }
      />
      <Box display="flex" flexWrap="wrap" gap="md" alignItems="center">
        <RegisterSearch
          aria-label={sv ? "Sök klienter" : "Search clients"}
          placeholder={sv ? "Sök klienter…" : "Search clients…"}
          value={search}
          onChange={(event) => {
            setFilters({
              ...props.filters,
              q: event.target.value || undefined,
              page: undefined,
            });
          }}
        />
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
      </Box>
      {visible.length ? (
        <DataTable
          title={sv ? "Klientlista" : "Client portfolio"}
          narrow="scroll"
          minWidth="wide"
          columns={[
            { id: "company", label: sv ? "Företag" : "Company" },
            { id: "period", label: sv ? "Senaste period" : "Latest period" },
            { id: "bank", label: sv ? "Bankavstämning" : "Bank reconciliation" },
            { id: "lead", label: sv ? "Klientansvarig" : "Responsible accountant" },
            { id: "review", label: sv ? "Nästa avstämning" : "Next review" },
            { id: "deadline", label: sv ? "Nästa deadline" : "Next deadline" },
            { id: "status", label: "Status" },
            { id: "work", label: sv ? "Att granska" : "To review", numeric: true },
            { id: "details", label: sv ? "Klient" : "Client" },
          ]}
          rows={visible.map((client) => {
            const facts = props.portfolio.clients.find(
              (item) =>
                item.scope.entityId === client.book.entityId &&
                item.scope.bookId === client.book.id,
            );

            if (!facts) throw new Error("The permitted client observation is missing");

            const period = facts.period;

            const lead = workspace.members.find((member) => member.actorId === client.leadId);
            const manage = client.book.role === "operator";

            return {
              id: client.book.id,
              cells: [
                <Box key="company" display="grid" gap="sm">
                  <Link
                    href={`${workspacePath(client.book)}/overview`}
                    onClick={() => rememberPortfolio(client.book, portfolioHref)}
                  >
                    {client.book.name}
                  </Link>
                  <PageCaption>{client.book.currency}</PageCaption>
                </Box>,
                <ClientPeriod
                  key="period"
                  book={client.book}
                  period={period}
                  locale={locale}
                  onOpen={() => rememberPortfolio(client.book, portfolioHref)}
                />,
                <ClientBank key="bank" facts={facts} locale={locale} />,
                client.leadAvailable ? lead?.name : sv ? "Ingen ansvarig" : "Unassigned",
                client.nextReviewOn ? (
                  <Box key="date" display="grid" gap="sm">
                    <span>{client.nextReviewOn}</span>
                    {isReviewDue(client, today) ? (
                      <Badge variant="secondary">{sv ? "Dags för avstämning" : "Review due"}</Badge>
                    ) : null}
                  </Box>
                ) : (
                  "—"
                ),
                <ClientDeadline
                  key="deadline"
                  deadline={deadlines.get(client.book.id) ?? null}
                  locale={locale}
                />,
                <ClientClosing key="status" closing={facts.closing} locale={locale} />,
                period && facts.openTasks !== null ? (
                  <Box key="work" display="grid" gap="sm" alignItems="end">
                    <Link
                      href={`${workspacePath(client.book)}/work?status=open&period=${encodeURIComponent(period.id)}`}
                      onClick={() => rememberPortfolio(client.book, portfolioHref)}
                    >
                      {facts.openTasks}
                    </Link>
                    <PageCaption>
                      {sv ? "Läst" : "Checked"}{" "}
                      {new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(props.portfolio.observedUntil))}
                    </PageCaption>
                  </Box>
                ) : !period ? (
                  sv ? (
                    "Ingen period"
                  ) : (
                    "No period"
                  )
                ) : (
                  "…"
                ),
                manage ? (
                  <Button
                    key="details"
                    static
                    variant="ghost"
                    onClick={() => setEditing({ client })}
                  >
                    {client.leadAvailable
                      ? sv
                        ? "Lämna över"
                        : "Hand off"
                      : sv
                        ? "Tilldela"
                        : "Assign"}
                  </Button>
                ) : client.note ? (
                  <PageCaption key="note">{client.note}</PageCaption>
                ) : (
                  "—"
                ),
              ],
            };
          })}
        />
      ) : (
        <EmptyPortfolio sv={sv} hasClients={workspace.clients.length > 0} />
      )}
      {visible.length ? (
        <PortfolioPagination
          total={sorted.length}
          page={currentPage}
          locale={locale}
          onPage={(next) => setFilters({ ...props.filters, page: next })}
        />
      ) : null}
      <PageCaption>
        {sv
          ? "Här visas klienter vars bokföring du har tillgång till. Att granska omfattar verifikationsförslag, fakturautkast och utläggsgranskningar."
          : "You see clients whose books you can access. To review covers journal proposals, invoice drafts and expense reviews."}
      </PageCaption>
      {editing ? (
        <ClientDialog
          {...props}
          workspace={workspace}
          client={editing.client}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Box>
  );
}

function isReviewDue(client: typeof Firms.Client.Type, today: string) {
  return client.nextReviewOn !== null && client.nextReviewOn <= today;
}

function matchesPortfolio(
  client: typeof Firms.Client.Type,
  actorId: string,
  search: string,
  view: PortfolioFilters["view"],
  today: string,
  locale: Locale,
) {
  return (
    client.book.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)) &&
    (view !== "mine" || (client.leadAvailable && client.leadId === actorId)) &&
    (view !== "due" || isReviewDue(client, today)) &&
    (view !== "unassigned" || !client.leadAvailable)
  );
}

function portfolioPath(firmId: string, search: string, view: string, page: number) {
  const params = new URLSearchParams({ firm: firmId, tab: "clients" });

  if (search) params.set("q", search);

  if (view !== "all") params.set("view", view);

  if (page) params.set("page", String(page));

  return `/firms?${params}`;
}

function EmptyPortfolio({ sv, hasClients }: { sv: boolean; hasClients: boolean }) {
  return (
    <PageEmpty
      title={
        hasClients
          ? sv
            ? "Inga matchande klienter"
            : "No matching clients"
          : sv
            ? "Din klientlista börjar här"
            : "Your client list starts here"
      }
      detail={
        hasClients
          ? sv
            ? "Prova ett annat namn eller en annan vy."
            : "Try another name or client view."
          : sv
            ? "Byråns kopplade företag visas här när du har åtkomst till deras bokföring. En administratör kan koppla befintliga företag."
            : "Your firm's linked companies appear here once you have access to their books. An administrator can link existing companies."
      }
    />
  );
}
