import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { DataTable } from "@open-erp/ui/components/data-table";
import { SelectControl } from "@open-erp/ui/components/select";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import {
  PageCaption,
  PageEmpty,
  RegisterSearch,
  RegisterFilter,
} from "@open-erp/ui/components/accounting-page";
import { ClientPeriod } from "./client-period";
import { ClientDialog } from "./client-dialog";
import { attentionQueryOptions } from "@/lib/attention";
import { workspacePath } from "@/lib/book-context";
import type { Books } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function FirmPortfolio(props: {
  workspace: typeof Firms.Workspace.Type;
  books: typeof Books.Type;
  locale: Locale;
}) {
  const { workspace, locale } = props;
  const sv = locale === "sv";
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ client: typeof Firms.Client.Type | null } | null>(null);
  const today = new Intl.DateTimeFormat("sv-SE").format(new Date());

  const filtered = workspace.clients.filter(
    (client) =>
      client.book.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)) &&
      (view !== "mine" || (client.leadAvailable && client.leadId === workspace.actorId)) &&
      (view !== "due" || isReviewDue(client, today)) &&
      (view !== "unassigned" || !client.leadAvailable),
  );
  const sorted = [...filtered].sort(
    (a, b) =>
      (a.nextReviewOn ?? "9999").localeCompare(b.nextReviewOn ?? "9999") ||
      a.book.name.localeCompare(b.book.name, locale),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(sorted.length / 10) - 1));
  const visible = sorted.slice(currentPage * 10, (currentPage + 1) * 10);
  const work = useQueries({
    queries: visible.map((client) => attentionQueryOptions(client.book, { status: "open" })),
  });
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
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        <RegisterFilter>
          <SelectControl
            aria-label={sv ? "Visa klienter" : "Client view"}
            value={view}
            onValueChange={(value) => {
              setView(value ?? "all");
              setPage(0);
            }}
            options={[
              { value: "all", label: sv ? "Alla mina klienter" : "All accessible clients" },
              { value: "mine", label: sv ? "Jag är ansvarig" : "Assigned to me" },
              { value: "due", label: sv ? "Dags för avstämning" : "Review due" },
              { value: "unassigned", label: sv ? "Saknar ansvarig" : "Unassigned" },
            ]}
          />
        </RegisterFilter>
      </Box>
      {visible.length ? (
        <DataTable
          title={sv ? "Klientlista" : "Client portfolio"}
          narrow="scroll"
          minWidth="wide"
          columns={[
            { id: "company", label: sv ? "Företag" : "Company" },
            { id: "period", label: sv ? "Senaste period" : "Latest period" },
            { id: "lead", label: sv ? "Klientansvarig" : "Responsible accountant" },
            { id: "review", label: sv ? "Nästa avstämning" : "Next review" },
            { id: "work", label: sv ? "Att granska" : "To review", numeric: true },
            { id: "details", label: sv ? "Klient" : "Client" },
          ]}
          rows={visible.map((client, index) => {
            const tasks = work[index];
            const lead = workspace.members.find((member) => member.actorId === client.leadId);
            const manage = client.book.role === "operator";
            return {
              id: client.book.id,
              cells: [
                <Box key="company" display="grid" gap="sm">
                  <Link href={`${workspacePath(client.book)}/overview`}>{client.book.name}</Link>
                  <PageCaption>{client.book.currency}</PageCaption>
                </Box>,
                <ClientPeriod key="period" book={client.book} locale={locale} />,
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
                tasks?.isSuccess ? (
                  <Box key="work" display="grid" gap="sm" alignItems="end">
                    <Link href={`${workspacePath(client.book)}/work?status=open`}>
                      {tasks.data.counts.open}
                    </Link>
                    <PageCaption>
                      {sv ? "Läst" : "Checked"}{" "}
                      {new Intl.DateTimeFormat(locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                      }).format(new Date(tasks.data.checkedAt))}
                    </PageCaption>
                  </Box>
                ) : tasks?.isError ? (
                  sv ? (
                    "Ej tillgängligt"
                  ) : (
                    "Unavailable"
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
                    {sv ? "Detaljer" : "Details"}
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
      {sorted.length > 10 ? (
        <Box display="flex" gap="md" alignItems="center">
          <Button
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {sv ? "Föregående" : "Previous"}
          </Button>
          <PageCaption>
            {currentPage * 10 + 1}–{Math.min((currentPage + 1) * 10, sorted.length)} /{" "}
            {sorted.length}
          </PageCaption>
          <Button
            variant="outline"
            disabled={(currentPage + 1) * 10 >= sorted.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {sv ? "Nästa" : "Next"}
          </Button>
        </Box>
      ) : null}
      <PageCaption>
        {sv
          ? "Här visas klienter vars bokföring du har tillgång till. Att granska omfattar verifikationsförslag, fakturautkast och utläggsgranskningar."
          : "You see clients whose books you can access. To review covers journal proposals, invoice drafts and expense reviews."}
      </PageCaption>
      {editing ? (
        <ClientDialog {...props} client={editing.client} onClose={() => setEditing(null)} />
      ) : null}
    </Box>
  );
}

function isReviewDue(client: typeof Firms.Client.Type, today: string) {
  return client.nextReviewOn !== null && client.nextReviewOn <= today;
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
