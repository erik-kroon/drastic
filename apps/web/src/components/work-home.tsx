import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type * as Workspace from "@open-erp/contracts/workspace";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { WorkHeaderAction } from "@open-erp/ui/components/work-controls";
import { PageAction, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { RegisterDetailLines } from "@open-erp/ui/components/register-workspace";
import { AreaBar, BarTab, ListDetailPage } from "@open-erp/ui/kanon/layouts";
import { WorkList, WorkGroup, WorkRow } from "@open-erp/ui/kanon/work-list";
import {
  DetailPanelSurface,
  DetailPanelHeader,
  DetailPanelActions,
  PanelSection,
} from "@open-erp/ui/kanon/detail-panel";
import { Action } from "@open-erp/ui/kanon/action";
import type { Status } from "@open-erp/ui/kanon/status";
import { useCompanyWork, type CompanyWork } from "@/lib/company-work";
import {
  attentionQueryOptions,
  attentionPath,
  attentionCopy,
  attentionState,
  expiredSupplierApproval,
} from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";
import {
  workQueueHref,
  type WorkReturn,
  type WorkHomeQuery,
  ownerReturnHref,
} from "@/lib/work-return";
import { AccountingStatus } from "./accounting-status";
import { OriginalDocument } from "./original-document";
import { WorkGroupReview, WorkGroupEntry } from "./work-group-review";
import { WorkSupplierPreview } from "./work-supplier-preview";

export function WorkHome() {
  const work = useCompanyWork();

  const { book, locale, base } = work;

  const sv = locale === "sv";

  const copy = attentionCopy(locale);

  const search = useSearch({ from: "/entities/$entityId/books/$bookId/" });
  const navigate = useNavigate({ from: "/entities/$entityId/books/$bookId/" });
  const status = search.status ?? "open";

  const kind = "all";

  const [groupReview, setGroupReview] = useState(false);

  const sort = "oldest";

  const filters: WorkReturn = {
    status: status === "watch" ? "open" : status,
    kind,
    sort,
    after: status === "watch" ? undefined : search.after,
  };

  const query = useQuery(attentionQueryOptions(book, filters));

  const page = query.isError ? undefined : query.data;

  const rows = homeRows(work, page?.items ?? [], status, kind, filters);

  const { selected, focusKey } = homeSelection(rows, search);

  const groups = [...new Set(rows.map((item) => item.group))];

  const reviewGroup = sv ? "Granska och godkänn" : "Review and approve";

  groups.sort((left, right) => Number(right === reviewGroup) - Number(left === reviewGroup));

  const activeQuery = status === "watch" ? work.sales : query;

  return (
    <>
      {groupReview ? (
        <WorkGroupReview
          key={`${book.entityId}/${book.id}`}
          items={page?.items ?? []}
          onClose={() => setGroupReview(false)}
        />
      ) : null}
      <ListDetailPage
        bar={
          <AreaBar
            title={sv ? "Att göra" : "To do"}
            headingFocusKey={
              !selected && activeQuery.isSuccess && !activeQuery.isFetching ? focusKey : undefined
            }
            tabsLabel={sv ? "Arbetsstatus" : "Work status"}
            tabs={homeStatusOptions(locale, page?.counts.open, work.sales.data?.counts.overdue).map(
              (option) => (
                <BarTab
                  key={option.value}
                  label={option.label}
                  count={option.count}
                  active={status === option.value}
                  onClick={() => {
                    void navigate({ search: { status: option.value }, resetScroll: false });
                  }}
                />
              ),
            )}
            action={
              <Box display="flex" gap="sm">
                <WorkGroupEntry
                  role={book.role}
                  status={status}
                  locale={locale}
                  onOpen={() => setGroupReview(true)}
                />
                <WorkHeaderAction href={workQueueHref(base, filters)}>
                  {sv ? "Granska alla" : "Review all"}
                </WorkHeaderAction>
              </Box>
            }
          />
        }
        panel={
          <DetailPanelSurface label={sv ? "Nästa steg" : "Next step"}>
            {selected ? (
              <WorkHomeDetail work={work} page={page} selected={selected} filters={filters} />
            ) : (
              <PageCaption>
                {sv ? "Välj en rad för att se nästa steg." : "Select a row to see the next step."}
              </PageCaption>
            )}
          </DetailPanelSurface>
        }
        list={
          <>
            {activeQuery.isPending || activeQuery.isError ? (
              <Box padding="lg">
                <AccountingStatus
                  locale={locale}
                  pending={activeQuery.isPending}
                  error={activeQuery.error}
                />
                {activeQuery.isError ? (
                  <Button
                    variant="outline"
                    disabled={activeQuery.isFetching}
                    onClick={() => {
                      void activeQuery.refetch();
                    }}
                  >
                    {copy.refresh}
                  </Button>
                ) : null}
              </Box>
            ) : null}
            <HomeBankStatus work={work} status={status} kind={kind} />
            <WorkList>
              {groups.map((group, index) => {
                const items = rows.filter((item) => item.group === group);

                if (!items.length) return null;

                return (
                  <WorkGroup key={group} title={group} count={items.length} first={index === 0}>
                    {items.map((item) => (
                      <WorkRow
                        key={item.key}
                        title={item.title}
                        status={item.status}
                        state={item.state}
                        amount={item.amount}
                        selected={selected?.key === item.key}
                        autoFocus={Boolean(search.task) && selected?.key === item.key}
                        onSelect={() => {
                          void navigate({
                            search: {
                              status,
                              after: search.after,
                              task: item.selectionKey,
                              stage: status === "completed" ? item.key : undefined,
                            },
                            resetScroll: false,
                          });
                        }}
                      />
                    ))}
                  </WorkGroup>
                );
              })}
            </WorkList>
            {activeQuery.isSuccess && rows.length === 0 ? (
              <Box padding="lg">
                <PageEmpty title={copy.empty} detail={copy.emptyDetail} />
              </Box>
            ) : null}
            {status !== "watch" ? (
              <HomePagination
                base={base}
                status={status}
                after={search.after}
                next={page?.next}
                locale={locale}
              />
            ) : null}
          </>
        }
      />
    </>
  );
}

function HomePagination(props: {
  base: string;
  status: "open" | "completed";
  after: string | undefined;
  next: string | null | undefined;
  locale: CompanyWork["locale"];
}) {
  const copy = attentionCopy(props.locale);

  if (!props.after && !props.next) return null;

  return (
    <Box padding="lg" display="flex" gap="md">
      {props.after ? (
        <PageAction
          quiet
          href={ownerReturnHref(props.base, { owner: "home", search: { status: props.status } })}
        >
          {copy.first}
        </PageAction>
      ) : null}
      {props.next ? (
        <PageAction
          quiet
          href={ownerReturnHref(props.base, {
            owner: "home",
            search: { status: props.status, after: props.next },
          })}
        >
          {copy.next}
        </PageAction>
      ) : null}
    </Box>
  );
}

function homeStatusOptions(
  locale: CompanyWork["locale"],
  open: string | undefined,
  overdue: number | undefined,
) {
  const sv = locale === "sv";

  return [
    {
      value: "open",
      label: sv ? "Väntar på dig" : "Waiting for you",
      count: open,
    },
    {
      value: "watch",
      label: sv ? "Bevakas" : "Watching",
      count: overdue,
    },
    { value: "completed", label: sv ? "Klart" : "Completed", count: undefined },
  ] as const;
}

function WorkHomeDetail({
  work,
  page,
  selected,
  filters,
}: {
  work: CompanyWork;
  page: typeof Workspace.AttentionPage.Type | undefined;
  selected: ReturnType<typeof homeRows>[number];
  filters: WorkReturn;
}) {
  const heading = (
    <>
      <DetailPanelHeader
        kicker={{ status: selected.status, text: selected.state }}
        figure={
          selected.amount === "—" ? (work.locale === "sv" ? "Okänt" : "Unknown") : selected.amount
        }
        subtitle={selected.title}
        subtitleAs="h2"
      />
      {selected.caption ? <PageCaption>{selected.caption}</PageCaption> : null}
    </>
  );

  const actions = (
    <DetailPanelActions
      primary={
        <Action kind="primary" fill render={<Link to={selected.href} />}>
          {selected.action}
        </Action>
      }
      secondary={
        <Action kind="quiet" fill render={<Link to={workQueueHref(work.base, filters)} />}>
          {work.locale === "sv" ? "Visa i arbetslistan" : "Show in work queue"}
        </Action>
      }
    />
  );

  const item = page?.items.find((candidate) => candidate.key === selected.key);

  if (item?.supplierReview)
    return <WorkSupplierPreview key={item.key} item={item} heading={heading} actions={actions} />;

  return (
    <>
      {heading}
      {selected.documentId ? (
        <PanelSection label="Original">
          <OriginalDocument
            compact
            key={selected.documentId}
            book={work.book}
            locale={work.locale}
            id={selected.documentId}
          />
        </PanelSection>
      ) : null}
      <WorkProposalPreview work={work} page={page} selected={selected} />
      {actions}
    </>
  );
}

function WorkProposalPreview({
  work,
  page,
  selected,
}: {
  work: CompanyWork;
  page: typeof Workspace.AttentionPage.Type | undefined;
  selected: ReturnType<typeof homeRows>[number];
}) {
  const item = page?.items.find((candidate) => candidate.key === selected.key);

  if (item?.kind === "journal") return <JournalPreview work={work} item={item} />;

  return null;
}

function JournalPreview({
  work,
  item,
}: {
  work: CompanyWork;
  item: typeof Workspace.AttentionItem.Type;
}) {
  const { book, locale } = work;

  const { setup } = useBookWorkspace();

  const proposal = useQuery({
    queryKey: [...bookKey(book), "change-set", item.id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/change-sets/${encodeURIComponent(item.id)}`,
        Accounting.ChangeSet,
        { signal },
      );

      if (
        result.id !== item.id ||
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId
      )
        throw new Error("Response scope mismatch");

      return result;
    },
    retry: false,
  });

  if (!proposal.data || proposal.isError)
    return <AccountingStatus pending={proposal.isPending} error={proposal.error} locale={locale} />;

  const lines = proposal.data.groups.flatMap((group) =>
    group.actions.flatMap((action) =>
      action.lines.map((line) => {
        const account = setup.accounts.find((candidate) => candidate.id === line.accountId);

        const signed = BigInt(line.debitMinor) > 0n ? line.debitMinor : `-${line.creditMinor}`;

        return {
          id: `${group.id}:${action.occurrenceKey}:${line.lineId}`,
          description: account ? `${account.code} ${account.name}` : line.description,
          amount:
            item.currencyScale === null
              ? "—"
              : formatMinorAmount(signed, item.currencyScale, locale),
        };
      }),
    ),
  );

  return (
    <RegisterDetailLines
      title={locale === "sv" ? "Föreslagen bokföring" : "Proposed posting"}
      lines={lines}
    />
  );
}

function HomeBankStatus({
  work,
  status,
  kind,
}: {
  work: CompanyWork;
  status: string;
  kind: string;
}) {
  const copy = attentionCopy(work.locale);

  if (status !== "open" || kind !== "all" || !work.bank.isError) return null;

  return (
    <Box padding="lg">
      <AccountingStatus locale={work.locale} error={work.bank.error} />
      <Button
        variant="outline"
        disabled={work.bank.isFetching}
        onClick={() => {
          void work.bank.refetch();
        }}
      >
        {copy.refresh}
      </Button>
    </Box>
  );
}

function rowStatus(item: typeof Workspace.AttentionItem.Type): Status {
  if (item.state === "completed") return "done";

  if (expiredSupplierApproval(item) !== null) return "needsYou";

  if (item.reason === "document_reading_failed") return "unknown";

  if (
    item.reason === "invoice_draft" ||
    item.reason === "supplier_draft" ||
    item.reason === "document_review"
  )
    return "proposal";

  return "needsYou";
}

function homeSelection(rows: ReturnType<typeof homeRows>, search: typeof WorkHomeQuery.Type) {
  const requested = search.task ?? search.stage;

  const focusKey = requested
    ? `${search.status ?? "open"}/${search.task ?? ""}/${search.stage ?? ""}`
    : undefined;

  if (!search.task) return { selected: search.stage ? undefined : rows[0], focusKey };

  const stage = search.status === "completed" ? search.stage : undefined;

  return {
    selected: rows.find(
      (item) => item.selectionKey === search.task && (!stage || item.key === stage),
    ),
    focusKey,
  };
}

function homeRows(
  work: CompanyWork,
  items: readonly (typeof Workspace.AttentionItem.Type)[],
  status: "open" | "completed" | "watch",
  kind: typeof Workspace.WorkKind.Type | "all",
  filters: WorkReturn,
) {
  const { book, locale, base } = work;

  const sv = locale === "sv";

  const copy = attentionCopy(locale);

  const amount = (item: typeof Workspace.AttentionItem.Type) =>
    item.amountMinor !== null && item.currencyScale !== null
      ? formatMinorAmount(item.amountMinor, item.currencyScale, locale)
      : "—";

  const rows =
    status === "watch"
      ? (work.sales.isSuccess
          ? work.sales.data.items.filter(
              (item) => item.overdue && (kind === "all" || kind === "invoice"),
            )
          : []
        ).map((item) => ({
          key: `invoice:${item.id}`,
          selectionKey: `invoice:${item.id}`,
          group: sv ? "Förfallna kundfakturor" : "Overdue customer invoices",
          title: `${item.customer}, ${item.number ?? item.title}`,
          state: sv ? "Förfallen" : "Overdue",
          status: "overdue" as const,
          amount:
            item.outstandingMinor === null
              ? "—"
              : formatMinorAmount(item.outstandingMinor, item.currencyScale, locale),
          caption: `${item.currency}${item.dueOn ? `, ${item.dueOn}` : ""}`,
          action: sv ? "Visa faktura" : "View invoice",
          href: `${base}/sales?status=overdue&sort=due&kind=invoice&record=${encodeURIComponent(item.id)}`,
          documentId: null,
        }))
      : items.map((item) => ({
          key: item.key,
          selectionKey: item.questionRoot?.key ?? item.key,
          group: attentionGroup(item, locale),
          title: item.title,
          state: attentionState(item, locale),
          status: rowStatus(item),
          amount: amount(item),
          caption: [item.currency, item.date].filter(Boolean).join(", "),
          action: copy[item.reason],
          href: attentionPath(book, item, filters, {
            owner: "home",
            search: {
              status,
              after: filters.after,
              task: item.questionRoot?.key ?? item.key,
              stage: status === "completed" ? item.key : undefined,
            },
          }),
          documentId: item.kind === "document" ? item.id : null,
        }));

  if (status === "open" && kind === "all" && work.bank.isSuccess) {
    for (const account of work.bank.data.accounts.filter((item) => item.unmatchedCount > 0)) {
      rows.push({
        key: `bank:${account.id}`,
        selectionKey: `bank:${account.id}`,
        group: sv ? "Bankhändelser" : "Bank events",
        title: account.name,
        state: `${account.unmatchedCount} ${sv ? "att matcha" : "to match"}`,
        status: "needsYou",
        amount: "—",
        caption: `${work.from}–${work.to}`,
        action: sv ? "Matcha bankhändelser" : "Match bank events",
        href: `${base}/accounts?account=${encodeURIComponent(account.id)}&from=${work.from}&to=${work.to}`,
        documentId: null,
      });
    }
  }

  return rows;
}

function attentionGroup(item: typeof Workspace.AttentionItem.Type, locale: CompanyWork["locale"]) {
  const reviewReasons: readonly (typeof Workspace.AttentionItem.Type)["reason"][] = [
    "journal_review",
    "expense_review",
    "document_review",
    "document_reading_failed",
    "supplier_review_prepared",
    "supplier_draft",
  ];

  if (item.state === "open" && reviewReasons.includes(item.reason))
    return locale === "sv" ? "Granska och godkänn" : "Review and approve";

  return attentionCopy(locale)[item.kind];
}
