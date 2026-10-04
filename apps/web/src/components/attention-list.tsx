import { WorkHandoff } from "./work-handoff";
import { useQuery } from "@tanstack/react-query";
import type { WorkReturn } from "@/lib/work-return";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { Badge } from "@open-erp/ui/components/badge";
import { PageEmpty, PageCaption } from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import {
  attentionQueryOptions,
  attentionPath,
  attentionWork,
  attentionCopy,
} from "@/lib/attention";

export function AttentionList(props: {
  filters: WorkReturn;
  onPage: (after: string | undefined) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const query = useQuery(attentionQueryOptions(book, props.filters));
  const page = query.isError ? undefined : query.data;
  const copy = attentionCopy(locale);
  const work = attentionWork(props.filters);
  const kind = props.filters.kind ?? "all";
  const shown = page ? String(page.items.length) : null;

  return (
    <Box display="grid" gap="lg">
      <Box display="flex" flexWrap="wrap" gap="md" justifyContent="between" alignItems="center">
        <Box display="grid" gap="xs">
          <Text role="status" tone="muted">
            {page ? `${copy.total}: ${page.total}` : copy.all}
          </Text>
          {page ? (
            <PageCaption>
              {copy.openCount}: {page.counts.open}, {copy.completedCount}: {page.counts.completed} ,{" "}
              {copy.splitScope}
            </PageCaption>
          ) : null}
        </Box>
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
              title={kind === "all" ? copy.all : copy[kind]}
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
                  <Link key="open" href={attentionPath(book, item, work)}>
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
            <PageEmpty
              title={props.filters.after ? copy.emptyPage : copy.empty}
              detail={props.filters.after ? copy.emptyPageDetail : copy.emptyDetail}
            />
          )}
          <PageCaption>{copy.coverage}</PageCaption>
          {shown !== null && shown !== page.total ? (
            <PageCaption>
              {copy.showing} {shown} {copy.of} {page.total}
            </PageCaption>
          ) : null}
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
