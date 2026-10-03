import { CreateCompany } from "@/components/company-setup/create-company";
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { CompanyChooser, CompanyChoice } from "@open-erp/ui/components/company-chooser";
import { RegisterSearch, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { SignOut } from "@/components/accounting-access";
import { LanguagePreference } from "@/components/book-workspace";
import type { Books } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { attentionQueryOptions } from "@/lib/attention";
import type { Locale } from "@/paraglide/runtime";

export function CompanyDirectory({ books, locale }: { books: typeof Books.Type; locale: Locale }) {
  const sv = locale === "sv";
  const copy = sv ? swedish : english;
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = books.filter((book) =>
    book.name.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)),
  );

  const visible = filtered.slice(page * 10, (page + 1) * 10);

  const work = useQueries({
    queries: visible.map((book) => attentionQueryOptions(book, { status: "open" })),
  });

  return (
    <CompanyChooser
      title={sv ? "Välj företag" : "Choose company"}
      subtitle={
        sv
          ? `Du har tillgång till ${books.length} företag.`
          : `You have access to ${books.length} companies.`
      }
      headerActions={<SignOut locale={locale} />}
      footer={
        <>
          <Box>
            <Button variant="ghost" onClick={() => setCreating(true)}>
              {sv ? "Skapa nytt företag" : "Create company"}
            </Button>
          </Box>
          <Box display="flex" gap="md" alignItems="center" flexWrap="wrap">
            <Link href="/firms">{sv ? "Klientlista" : "Client portfolio"}</Link>
            <LanguagePreference locale={locale} />
          </Box>
          <PageCaption>{copy.coverage}</PageCaption>
        </>
      }
    >
      {creating ? <CreateCompany locale={locale} onClose={() => setCreating(false)} /> : null}
      {books.length > 10 ? (
        <RegisterSearch
          aria-label={copy.search}
          placeholder={copy.search}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
        />
      ) : null}
      {visible.length ? (
        <>
          {visible.map((book, index) => {
            const tasks = work[index];
            const role = copy.roles[book.role];
            let detail = role;

            if (tasks?.isSuccess)
              detail += `, ${tasks.data.counts.open} ${sv ? "att göra" : "to do"}`;
            else if (tasks?.isError) detail += `, ${copy.unavailable}`;

            return (
              <CompanyChoice
                key={`${book.entityId}/${book.id}`}
                name={book.name}
                detail={detail}
                href={`${workspacePath(book)}/${book.profile === "company-setup-v1" ? "setup" : ""}`}
                openLabel={sv ? "Öppna" : "Open"}
              />
            );
          })}
        </>
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
    </CompanyChooser>
  );
}

const english = {
  roles: { operator: "Operator", agent: "Assistant" },
  search: "Search companies…",
  unavailable: "Unavailable",
  noMatches: "No matching companies",
  noAccess: "No companies available",
  trySearch: "Try another company name.",
  askAccess:
    "Create a company to get started, or ask your administrator for access to an existing one.",
  previous: "Previous",
  next: "Next",
  coverage:
    "Only companies you can access are shown. Work counts cover journal proposals, invoice drafts and expense reviews; they do not measure every outstanding task.",
};

const swedish: typeof english = {
  roles: { operator: "Operatör", agent: "Assistent" },
  search: "Sök företag…",
  unavailable: "Ej tillgängligt",
  noMatches: "Inga matchande företag",
  noAccess: "Inga företag tillgängliga",
  trySearch: "Prova ett annat företagsnamn.",
  askAccess: "Skapa ett företag eller be administratören om åtkomst till ett befintligt företag.",
  previous: "Föregående",
  next: "Nästa",
  coverage:
    "Endast företag du har åtkomst till visas. Antalet omfattar verifikationsförslag, fakturautkast och utläggsgranskningar, inte allt väntande arbete.",
};
