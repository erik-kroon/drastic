import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Building2, BookOpen, Users } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  Workspace,
  WorkspaceBrand,
  WorkspaceNavLink,
  WorkspaceHeader,
} from "@open-erp/ui/components/workspace";
import {
  PageContent,
  RegisterSearch,
  PageCaption,
  PageEmpty,
} from "@open-erp/ui/components/accounting-page";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { SignOut } from "@/components/accounting-access";
import { LanguagePreference } from "@/components/book-workspace";
import { bookKey, bookPath, readAccounting, type Books } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { attentionQueryOptions } from "@/lib/attention";
import type { Locale } from "@/paraglide/runtime";

export function CompanyDirectory({ books, locale }: { books: typeof Books.Type; locale: Locale }) {
  const sv = locale === "sv";
  const copy = sv ? swedish : english;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = books.filter((book) =>
    book.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)),
  );
  const visible = filtered.slice(page * 10, (page + 1) * 10);
  const work = useQueries({
    queries: visible.map((book) => attentionQueryOptions(book, { status: "open" })),
  });
  const setups = useQueries({
    queries: visible.map((book) => ({
      queryKey: [...bookKey(book), "setup"],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
      retry: false,
    })),
  });
  return (
    <Workspace
      pageKey="companies"
      mobileNavigation={null}
      brand={<WorkspaceBrand icon={<BookOpen size={20} strokeWidth={1.5} />} name="OpenERP" />}
      navigation={
        <>
          <WorkspaceNavLink href="/companies" active>
            <Building2 size={16} />
            {copy.companies}
          </WorkspaceNavLink>
          <WorkspaceNavLink href="/firms">
            <Users size={16} />
            {sv ? "Byrå" : "Firm"}
          </WorkspaceNavLink>
        </>
      }
      footer={
        <Box display="grid" gap="lg" padding="md">
          <LanguagePreference locale={locale} />
          <SignOut locale={locale} />
        </Box>
      }
    >
      <WorkspaceHeader title={copy.companies} />
      <PageContent>
        <RecordHeading title={copy.yourCompanies} subtitle={copy.subtitle} />
        <RegisterSearch
          aria-label={copy.search}
          placeholder={copy.search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
        {visible.length ? (
          <DataTable
            title={copy.companies}
            narrow="stack"
            columns={[
              { id: "company", label: copy.company },
              { id: "period", label: copy.period },
              { id: "review", label: copy.review, numeric: true },
              { id: "updated", label: copy.checked },
              { id: "currency", label: copy.currency },
            ]}
            rows={visible.map((book, index) => {
              const tasks = work[index];
              const setup = setups[index];
              const period = setup?.isSuccess ? setup.data.periods.at(-1) : undefined;
              return {
                id: `${book.entityId}/${book.id}`,
                cells: [
                  <Link key="company" href={`${workspacePath(book)}/overview`}>
                    {book.name}
                  </Link>,
                  setup?.isError ? (
                    copy.unavailable
                  ) : period ? (
                    <Box key="period" display="flex" gap="md" alignItems="center">
                      <Link
                        href={`${workspacePath(book)}/closing?record=${encodeURIComponent(period.id)}`}
                      >
                        {period.startsOn} – {period.endsOn}
                      </Link>
                      <Badge variant="secondary">{period.locked ? copy.locked : copy.open}</Badge>
                    </Box>
                  ) : (
                    "—"
                  ),
                  tasks?.isSuccess ? (
                    <Link key="work" href={`${workspacePath(book)}/work?status=open`}>
                      {tasks.data.counts.open}
                    </Link>
                  ) : tasks?.isError ? (
                    copy.unavailable
                  ) : (
                    "—"
                  ),
                  tasks?.isSuccess
                    ? new Intl.DateTimeFormat(locale, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }).format(new Date(tasks.data.checkedAt))
                    : "—",
                  book.currency,
                ],
              };
            })}
          />
        ) : (
          <PageEmpty
            title={books.length ? copy.noMatches : copy.noAccess}
            detail={books.length ? copy.trySearch : copy.askAccess}
          />
        )}
        {filtered.length > 10 ? (
          <Box display="flex" gap="md">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((current) => current - 1)}
            >
              {copy.previous}
            </Button>
            <Button
              variant="outline"
              disabled={(page + 1) * 10 >= filtered.length}
              onClick={() => setPage((current) => current + 1)}
            >
              {copy.next}
            </Button>
          </Box>
        ) : null}
        <PageCaption>{copy.coverage}</PageCaption>
      </PageContent>
    </Workspace>
  );
}
const english = {
  companies: "Companies",
  yourCompanies: "Your companies",
  subtitle: "Open a company, review its outstanding work or continue with a period.",
  search: "Search companies…",
  company: "Company",
  period: "Latest period",
  review: "To review",
  checked: "Checked",
  currency: "Currency",
  unavailable: "Unavailable",
  locked: "Locked",
  open: "Open",
  noMatches: "No matching companies",
  noAccess: "No companies available",
  trySearch: "Try another company name.",
  askAccess: "Ask your administrator to give you access to a company.",
  previous: "Previous",
  next: "Next",
  coverage:
    "Only companies you can access are shown. Review counts cover journal proposals; they do not measure every outstanding task.",
};
const swedish: typeof english = {
  companies: "Företag",
  yourCompanies: "Dina företag",
  subtitle: "Öppna ett företag, granska väntande arbete eller fortsätt med en period.",
  search: "Sök företag…",
  company: "Företag",
  period: "Senaste period",
  review: "Verifikationer att granska",
  checked: "Kontrollerat",
  currency: "Valuta",
  unavailable: "Ej tillgängligt",
  locked: "Låst",
  open: "Öppen",
  noMatches: "Inga matchande företag",
  noAccess: "Inga företag tillgängliga",
  trySearch: "Prova ett annat företagsnamn.",
  askAccess: "Be administratören ge dig åtkomst till ett företag.",
  previous: "Föregående",
  next: "Nästa",
  coverage:
    "Endast företag du har åtkomst till visas. Antalet att granska omfattar verifikationsförslag, inte allt väntande arbete.",
};
