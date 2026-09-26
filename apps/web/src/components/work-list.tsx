import { defaultStringifySearch } from "@tanstack/react-router";
import { Inbox } from "lucide-react";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@open-erp/ui/components/empty";
import { useQuery } from "@tanstack/react-query";
import type * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, reviewPath, workspacePath } from "@/lib/book-context";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import { accountingCopy } from "@/lib/accounting-copy";

export function WorkList(props: {
  filters: typeof Workspace.WorkQuery.Type;
  compact?: boolean;
  onPage?: (after: string | undefined) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const copy = accountingCopy(locale);
  const work = useQuery(workQueryOptions(book, props.filters));
  const page = work.isError ? undefined : work.data;

  const states = {
    unposted: copy.workspace_unposted,
    posted: copy.workspace_posted,
    posted_elsewhere: copy.workspace_posted_elsewhere,
  };

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Box display="flex" flexWrap="wrap" gap="lg" alignItems="center" justifyContent="between">
        {page ? (
          <Text role="status">
            {copy.workspace_results}: {page.total}
          </Text>
        ) : null}
        <Button
          static
          size="xl"
          variant="outline"
          disabled={work.isFetching}
          onClick={() => {
            void work.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={work.isPending} error={work.error} />
      {page ? (
        <>
          {page.items.length > 0 ? (
            <DataTable
              title={copy.workspace_proposals}
              narrow="stack"
              columns={[
                { id: "record", label: copy.journal_description },
                { id: "date", label: copy.journal_date },
                { id: "amount", label: copy.workspace_amount, numeric: true },
                { id: "status", label: copy.workspace_status },
              ]}
              rows={(props.compact ? page.items.slice(0, 5) : page.items).map((item) => ({
                id: item.id,
                cells: [
                  <Link
                    href={`${reviewPath(book, item.id, item.revision)}${defaultStringifySearch(props.filters)}`}
                  >
                    {item.description}
                  </Link>,
                  item.postingDate,
                  `${formatMinorAmount(item.amountMinor, page.currencyScale, locale)} ${item.currency}`,
                  states[item.state],
                ],
              }))}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia>
                  <Inbox size={28} strokeWidth={1.5} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>{copy.workspace_empty_title}</EmptyTitle>
                <EmptyDescription>{copy.workspace_empty}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <Text tone="muted">
            {copy.workspace_checked}:{" "}
            {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(page.checkedAt),
            )}
          </Text>
          {props.compact ? (
            <Link href={`${workspacePath(book)}/work`}>{copy.workspace_all_work}</Link>
          ) : (
            <Box display="flex" flexWrap="wrap" gap="md">
              {props.filters.after ? (
                <Button
                  static
                  size="xl"
                  variant="outline"
                  onClick={() => props.onPage?.(undefined)}
                >
                  {copy.workspace_first_page}
                </Button>
              ) : null}
              {page.next ? (
                <Button
                  static
                  size="xl"
                  variant="outline"
                  onClick={() => props.onPage?.(page.next ?? undefined)}
                >
                  {copy.workspace_next_page}
                </Button>
              ) : null}
            </Box>
          )}
        </>
      ) : null}
      <Text tone="muted">{copy.workspace_coverage_note}</Text>
    </Box>
  );
}
