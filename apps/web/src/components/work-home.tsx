import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { PageAction, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import {
  RegisterWorkspace,
  RegisterGroup,
  RegisterRow,
  RegisterTabs,
  RegisterDetailHeading,
  RegisterDetailActions,
  type RegisterStatus,
} from "@open-erp/ui/components/register-workspace";
import { useCompanyWork, type CompanyWork } from "@/lib/company-work";
import { attentionQueryOptions, attentionPath, attentionCopy } from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import { workQueueHref, type WorkReturn } from "@/lib/work-return";
import { AccountingStatus } from "./accounting-status";
import { OriginalDocument } from "./original-document";

export function WorkHome() {
  const work = useCompanyWork();
  const { book, locale, base } = work;
  const sv = locale === "sv";
  const copy = attentionCopy(locale);
  const [status, setStatus] = useState<"open" | "completed" | "watch">("open");

  const [kind, setKind] = useState<typeof Workspace.WorkKind.Type | "all">("all");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const filters: WorkReturn = {
    status: status === "watch" ? "open" : status,
    kind,
    sort: "oldest",
  };

  const query = useQuery(attentionQueryOptions(book, filters));
  const page = query.isError ? undefined : query.data;
  const kinds = ["supplier", "document", "journal", "expense", "invoice"] as const;

  const rows = homeRows(work, page?.items ?? [], status, kind, filters);

  const selected = rows.find((item) => item.key === selectedKey) ?? rows[0];
  const groups = [...new Set(rows.map((item) => item.group))];
  const activeQuery = status === "watch" ? work.sales : query;

  return (
    <RegisterWorkspace
      title={sv ? "Att göra" : "To do"}
      tabs={
        <RegisterTabs
          label={sv ? "Arbetsstatus" : "Work status"}
          value={status}
          options={[
            {
              value: "open",
              label: `${sv ? "Väntar på dig" : "Waiting for you"}${page ? ` ${page.counts.open}` : ""}`,
            },
            { value: "watch", label: sv ? "Bevakas" : "Watching" },
            { value: "completed", label: sv ? "Klart" : "Completed" },
          ]}
          onChange={(value) => {
            if (value === "open" || value === "completed" || value === "watch") {
              setStatus(value);
              setSelectedKey(null);
            }
          }}
        />
      }
      action={
        <PageAction compact quiet href={workQueueHref(base, filters)}>
          {sv ? "Granska alla" : "Review all"}
        </PageAction>
      }
      filters={
        <>
          <SelectControl
            size="compact"
            aria-label={copy.type}
            value={kind}
            options={[
              { value: "all", label: sv ? "Alla typer" : "All types" },
              ...kinds.map((value) => ({ value, label: copy[value] })),
            ]}
            onValueChange={(value) => {
              const selectedKind = kinds.find((item) => item === value);
              setKind(selectedKind ?? "all");
              setSelectedKey(null);
            }}
          />
          <Button
            static
            variant="ghost"
            disabled={activeQuery.isFetching}
            onClick={() => {
              void activeQuery.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        </>
      }
      detail={
        selected ? (
          <>
            <RegisterDetailHeading
              title={selected.title}
              amount={selected.amount}
              caption={selected.state}
            />
            <PageCaption>{selected.caption}</PageCaption>
            {selected.documentId ? (
              <OriginalDocument
                key={selected.documentId}
                book={book}
                locale={locale}
                id={selected.documentId}
              />
            ) : null}
            <RegisterDetailActions>
              <PageAction href={selected.href}>{selected.action}</PageAction>
              <PageAction quiet href={workQueueHref(base, filters)}>
                {sv ? "Visa i arbetslistan" : "Show in work queue"}
              </PageAction>
            </RegisterDetailActions>
          </>
        ) : (
          <PageCaption>
            {sv ? "Välj en rad för att se nästa steg." : "Select a row to see the next step."}
          </PageCaption>
        )
      }
    >
      {activeQuery.isPending || activeQuery.isError ? (
        <Box padding="lg">
          <AccountingStatus
            locale={locale}
            pending={activeQuery.isPending}
            error={activeQuery.error}
          />
        </Box>
      ) : null}
      <HomeBankStatus work={work} status={status} kind={kind} />
      {groups.map((group) => {
        const items = rows.filter((item) => item.group === group);

        if (!items.length) return null;

        return (
          <Box key={group}>
            <RegisterGroup title={group} count={items.length} />
            {items.map((item) => (
              <RegisterRow
                key={item.key}
                title={item.title}
                status={item.status}
                state={item.state}
                amount={item.amount}
                selected={selected?.key === item.key}
                onSelect={() => setSelectedKey(item.key)}
              />
            ))}
          </Box>
        );
      })}
      {activeQuery.isSuccess && rows.length === 0 ? (
        <Box padding="lg">
          <PageEmpty title={copy.empty} detail={copy.emptyDetail} />
        </Box>
      ) : null}
      {status !== "watch" && page?.next ? (
        <Box padding="lg">
          <PageAction quiet href={workQueueHref(base, { ...filters, after: page.next })}>
            {copy.next}
          </PageAction>
        </Box>
      ) : null}
      <Box padding="lg" display="flex" gap="sm" flexWrap="wrap">
        <PageAction quiet href={`${base}/purchases?view=documents&record=new`}>
          {sv ? "Ladda upp underlag" : "Upload document"}
        </PageAction>
        <PageAction quiet href={`${base}/sales?record=new&kind=draft`}>
          {sv ? "Ny faktura" : "New invoice"}
        </PageAction>
        <PageAction quiet href={`${base}/books?view=journal`}>
          {sv ? "Ny verifikation" : "New entry"}
        </PageAction>
        <PageAction quiet href={`${base}/purchases?view=expenses&record=new`}>
          {sv ? "Lägg till utgift" : "Add expense"}
        </PageAction>
      </Box>
    </RegisterWorkspace>
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

function rowStatus(item: typeof Workspace.AttentionItem.Type): RegisterStatus {
  if (item.state === "completed") return "completed";

  if (item.reason === "document_reading_failed") return "warning";

  if (item.reason === "invoice_draft" || item.reason === "supplier_draft") return "draft";

  return "pending";
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
      ? (work.sales.isSuccess ? work.sales.data.items.filter((item) => item.overdue) : []).map(
          (item) => ({
            key: `invoice:${item.id}`,
            group: sv ? "Förfallna kundfakturor" : "Overdue customer invoices",
            title: `${item.customer} · ${item.number ?? item.title}`,
            state: sv ? "Förfallen" : "Overdue",
            status: "warning" as const,
            amount:
              item.outstandingMinor === null
                ? "—"
                : formatMinorAmount(item.outstandingMinor, item.currencyScale, locale),
            caption: `${item.currency}${item.dueOn ? ` · ${item.dueOn}` : ""}`,
            action: sv ? "Visa faktura" : "View invoice",
            href: `${base}/sales?status=overdue&sort=due&kind=invoice&record=${encodeURIComponent(item.id)}`,
            documentId: null,
          }),
        )
      : items.map((item) => ({
          key: item.key,
          group: copy[item.kind],
          title: item.title,
          state: copy[item.reason],
          status: rowStatus(item),
          amount: amount(item),
          caption: `${item.currency ?? book.currency}${item.date ? ` · ${item.date}` : ""}`,
          action: copy[item.reason],
          href: attentionPath(book, item, filters),
          documentId: item.kind === "document" ? item.id : null,
        }));

  if (status === "open" && kind === "all" && work.bank.isSuccess) {
    for (const account of work.bank.data.accounts.filter((item) => item.unmatchedCount > 0)) {
      rows.push({
        key: `bank:${account.id}`,
        group: sv ? "Bankhändelser" : "Bank events",
        title: account.name,
        state: `${account.unmatchedCount} ${sv ? "att matcha" : "to match"}`,
        status: "pending",
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
