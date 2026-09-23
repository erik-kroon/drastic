import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Sources from "@open-erp/contracts/source-intake";
import { ArrowLeft, Upload } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import {
  PageCaption,
  PageEmpty,
  RegisterSearch,
  RecordToggle,
} from "@open-erp/ui/components/accounting-page";
import { DocumentUpload } from "./document-inbox";
import { SourceWorkspace } from "./source-intake/workspace";
import { AccountingStatus } from "./accounting-status";
import { checkScope } from "./commerce/shared";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";

export function StatementImports(props: { recordId?: string; onOpen: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: [...bookKey(book), "document-inbox"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/source-occurrences${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Sources.SourceInventory,
        { signal },
      );
      page.items.forEach((item) => checkScope(book, item.occurrence.scope));
      return page;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const rows =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (item) =>
          item.occurrence.mediaType === "text/csv" &&
          item.occurrence.filename
            .toLocaleLowerCase(locale)
            .includes(search.toLocaleLowerCase(locale)),
      ) ?? [];
  if (props.recordId && props.recordId !== "new")
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => props.onOpen("")}>
            <ArrowLeft size={14} />
            {sv ? "Alla kontoutdrag" : "All statements"}
          </Button>
        </Box>
        <SourceWorkspace
          key={props.recordId}
          book={book}
          setup={setup}
          locale={locale}
          id={props.recordId}
        />
      </Box>
    );
  return (
    <Box display="grid" gap="xl">
      <RecordHeading
        title={sv ? "Kontoutdrag" : "Statement imports"}
        subtitle={
          sv
            ? "Ladda upp ett kontoutdrag, kontrollera kolumnerna och granska före import."
            : "Upload a statement, map its columns and review before importing."
        }
        action={
          <Button onClick={() => props.onOpen("new")}>
            <Upload size={14} />
            {sv ? "Importera kontoutdrag" : "Import statement"}
          </Button>
        }
      />
      <RegisterSearch
        aria-label={sv ? "Sök kontoutdrag" : "Search statements"}
        placeholder={sv ? "Sök filnamn…" : "Search filename…"}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isSuccess ? (
        rows.length ? (
          <DataTable
            title={sv ? "Kontoutdrag" : "Statements"}
            narrow="stack"
            columns={[
              { id: "name", label: sv ? "Fil" : "File" },
              { id: "date", label: sv ? "Uppladdat" : "Uploaded" },
              { id: "state", label: "Status" },
            ]}
            rows={rows.map((item) => ({
              id: item.occurrence.id,
              cells: [
                <RecordToggle
                  key="open"
                  expanded={false}
                  onClick={() => props.onOpen(item.occurrence.id)}
                >
                  {item.occurrence.filename}
                </RecordToggle>,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                  new Date(item.occurrence.retainedAt),
                ),
                <Badge key="state" variant={item.admission ? "secondary" : "warning"}>
                  {item.admission
                    ? sv
                      ? "Importerat"
                      : "Imported"
                    : sv
                      ? "Att granska"
                      : "Needs review"}
                </Badge>,
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={sv ? "Inga kontoutdrag här än" : "No statements here yet"}
            detail={
              sv
                ? "Exportera CSV från banken och ladda upp filen här."
                : "Export a CSV from your bank and upload it here."
            }
          />
        )
      ) : null}
      {query.hasNextPage ? (
        <Box>
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {sv ? "Läs in fler" : "Load more"}
          </Button>
        </Box>
      ) : null}
      <PageCaption>
        {sv
          ? "Importerade kontoutdrag är sparade observationer. Ingen bankanslutning eller betalning startas."
          : "Imported statements are retained observations. This does not connect to your bank or initiate payments."}
      </PageCaption>
      {props.recordId === "new" ? (
        <FormDialog
          title={sv ? "Importera kontoutdrag" : "Import statement"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => props.onOpen("")}
        >
          <DocumentUpload statement onSaved={props.onOpen} />
        </FormDialog>
      ) : null}
    </Box>
  );
}
