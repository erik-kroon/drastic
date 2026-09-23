import { WorkHandoff } from "./work-handoff";
import { defaultStringifySearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { Badge } from "@open-erp/ui/components/badge";
import { PageEmpty, PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { attentionQueryOptions, attentionPath, attentionCopy } from "@/lib/attention";

export function AttentionList(props: {
  filters: typeof Workspace.AttentionQuery.Type;
  onPage: (after: string | undefined) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const query = useQuery(attentionQueryOptions(book, props.filters));
  const page = query.isError ? undefined : query.data;
  const copy = attentionCopy(locale);
  return (
    <Box display="grid" gap="lg">
      <Box display="flex" justifyContent="between" alignItems="center">
        <PageCaption>{page ? `${copy.total}: ${page.total}` : copy.all}</PageCaption>
        <Button
          static
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => {
            void query.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {page ? (
        <>
          {page.items.length ? (
            <DataTable
              title={copy.all}
              narrow="stack"
              columns={[
                { id: "record", label: copy.title },
                { id: "kind", label: copy.type },
                { id: "date", label: copy.updated },
                { id: "state", label: copy.action },
                { id: "amount", label: copy.amount, numeric: true },
                { id: "assignment", label: locale === "sv" ? "Ansvarig" : "Assigned to" },
              ]}
              rows={page.items.map((item) => ({
                id: item.key,
                cells: [
                  <Link
                    key="open"
                    href={`${attentionPath(book, item)}${item.kind === "journal" ? defaultStringifySearch({ period: props.filters.period, status: props.filters.status, sort: props.filters.sort, q: props.filters.q }) : ""}`}
                  >
                    {item.title}
                  </Link>,
                  copy[item.kind],
                  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                    new Date(item.updatedAt),
                  ),
                  <Badge key="status" variant={item.state === "open" ? "warning" : "secondary"}>
                    {copy[item.reason]}
                  </Badge>,
                  item.amountMinor !== null && item.currencyScale !== null
                    ? `${formatMinorAmount(item.amountMinor, item.currencyScale, locale)} ${item.currency ?? ""}`
                    : "—",
                  <WorkHandoff key="handoff" item={item} />,
                ],
              }))}
            />
          ) : (
            <PageEmpty title={copy.empty} detail={copy.emptyDetail} />
          )}
          <PageCaption>{copy.coverage}</PageCaption>
          <PageCaption>
            {copy.updated}{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(page.checkedAt),
            )}
          </PageCaption>
        </>
      ) : null}
      {props.filters.after || page?.next ? (
        <Box display="flex" gap="md">
          <Button
            static
            variant="outline"
            disabled={!props.filters.after}
            onClick={() => props.onPage(undefined)}
          >
            {copy.first}
          </Button>
          <Button
            static
            variant="outline"
            disabled={!page?.next}
            onClick={() => {
              if (page?.next) props.onPage(page.next);
            }}
          >
            {copy.next}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
