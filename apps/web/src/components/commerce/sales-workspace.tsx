import { useRef, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, defaultStringifySearch } from "@tanstack/react-router";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Sales from "@open-erp/contracts/sales-register";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { SelectControl } from "@open-erp/ui/components/select";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import {
  PageContent,
  PageCaption,
  PageEmpty,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import {
  RegisterWorkspace,
  RegisterNavigation,
  RegisterGroup,
  RegisterRow,
  RegisterDetailHeading,
  RegisterDetailActions,
  type RegisterStatus,
} from "@open-erp/ui/components/register-workspace";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { readAccounting } from "@/lib/accounting-api";
import { decodeWorkReturn, encodeWorkReturn } from "@/lib/work-return";
import { WorkReturnAction } from "@/components/work-return-action";
import { commerceKey, commercePath, checkScope } from "./shared";
import { InvoiceDraftIssueOverlay } from "./invoice-draft-issue-overlay";
import { NewInvoiceDraft } from "./invoice-drafts";
import { InvoiceIssuance } from "./invoice-issuance";
import { Invoices } from "./invoices";
import { Counterparties, counterpartyRegisterOptions } from "./counterparties";

export type SalesSearch = typeof Sales.SalesQuery.Type & {
  view?: string;
  record?: string;
  kind?: "draft" | "invoice";
  stage?: "review" | "payments";
  review?: string;
  allocation?: string;
  release?: string;
  paymentPage?: string;
  paymentHistoryPage?: string;
  work?: string;
  returnTo?: string;
};

export function salesRegisterOptions(book: typeof Accounting.Book.Type, query: URLSearchParams) {
  return queryOptions({
    queryKey: [...commerceKey(book), "sales-register", query.toString()],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${commercePath(book)}/sales-register?${query}`,
        Sales.SalesPage,
        { signal },
      );

      checkScope(book, result.scope);

      return result;
    },
    retry: false,
  });
}

export function SalesWorkspace({ search }: { search: SalesSearch }) {
  const { book, locale } = useBookWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const base = `${workspacePath(book)}/sales`;
  const opener = useRef<{ base: string; id: string } | undefined>(undefined);
  const pendingFocus = useRef(false);
  const work = decodeWorkReturn(search.work);
  const contacts = search.view === "parties";
  const status = search.status ?? (search.view === "drafts" && !search.record ? "draft" : "all");
  const sort = search.sort ?? "newest";
  const pageNumber = Number(search.page ?? "1");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState({ applied: search.q ?? "", text: search.q ?? "" });

  if (searchText.applied !== (search.q ?? ""))
    setSearchText({ applied: search.q ?? "", text: search.q ?? "" });
  const query = new URLSearchParams({ status, sort, page: String(pageNumber), q: search.q ?? "" });

  const registerOptions = salesRegisterOptions(book, query);

  const register = useQuery({
    ...registerOptions,
    enabled: !contacts,
  });

  const preloadInvoices = () => {
    if (contacts)
      void client.prefetchQuery(
        salesRegisterOptions(
          book,
          new URLSearchParams({ status: "all", sort: "newest", page: "1", q: "" }),
        ),
      );
  };

  const preloadCustomers = () => {
    if (!contacts) void client.prefetchInfiniteQuery(counterpartyRegisterOptions(book));
  };

  const change = (next: SalesSearch, replace = false) => {
    void navigate({ to: base, search: next, replace, resetScroll: false });
  };

  const registerSearch = {
    ...search,
    record: undefined,
    kind: undefined,
    stage: undefined,
    review: undefined,
    allocation: undefined,
    release: undefined,
    paymentPage: undefined,
    paymentHistoryPage: undefined,
  };

  const focusRegister = () => {
    if (
      !pendingFocus.current ||
      router.state.location.pathname !== base ||
      router.state.location.search.record ||
      client.isFetching({ queryKey: registerOptions.queryKey, exact: true })
    )
      return;

    const row =
      opener.current?.base === base
        ? document.querySelector<HTMLElement>(`[data-sales-id="${CSS.escape(opener.current.id)}"]`)
        : null;

    const target = row ?? document.querySelector<HTMLHeadingElement>("main h1");

    if (target) {
      if (!row) target.tabIndex = -1;
      target.focus();
      pendingFocus.current = false;
    }
  };

  const close = () => {
    pendingFocus.current = false;
    void navigate({
      to: base,
      search: { ...registerSearch, view: contacts ? "parties" : undefined },
      resetScroll: false,
    }).then(() => {
      pendingFocus.current = true;
      focusRegister();
    });
  };

  const open = (id: string, kind: "draft" | "invoice") => {
    pendingFocus.current = false;
    change({
      ...search,
      view: undefined,
      record: id || undefined,
      kind,
      stage: undefined,
      review: undefined,
      allocation: undefined,
      release: undefined,
      paymentPage: undefined,
      paymentHistoryPage: undefined,
    });
  };

  const rowUrl = (row: typeof Sales.SalesRow.Type) => {
    return `${base}${defaultStringifySearch({
      status,
      sort,
      page: pageNumber,
      q: search.q || undefined,
      record: row.id,
      kind: row.kind,
      work: encodeWorkReturn(work),
      returnTo: search.returnTo,
    })}`;
  };

  const tabHref = (view: string) => `${base}${defaultStringifySearch({ ...registerSearch, view })}`;

  const statuses: Array<{ value: typeof Sales.SalesStatus.Type; label: string }> = [
    { value: "all", label: labels.all },
    { value: "draft", label: labels.drafts },
    { value: "open", label: labels.open },
    { value: "overdue", label: labels.overdue },
    { value: "settled", label: labels.settled },
    { value: "cancelled", label: labels.cancelled },
  ];

  const rowStatus = (row: typeof Sales.SalesRow.Type) => {
    if (row.overdue) return labels.overdueInvoice;

    if (row.status === "cancelled") return labels.cancelledInvoice;

    if (row.status === "draft") return row.needsDetails ? labels.needsDetails : labels.draft;

    return labels[row.status];
  };

  const tabs = [
    {
      label: labels.invoices,
      href: `${base}${defaultStringifySearch({ ...registerSearch, view: undefined })}`,
      active: !contacts,
      preload: preloadInvoices,
    },
    {
      label: labels.customers,
      href: tabHref("parties"),
      active: contacts,
      preload: preloadCustomers,
    },
    { label: labels.articleCatalog, href: tabHref("articles"), active: false },
    { label: sv ? "Offerter" : "Quotes", href: tabHref("orders"), active: false },
    { label: sv ? "Krav" : "Collections", href: tabHref("collections"), active: false },
  ];

  if (contacts)
    return (
      <>
        <WorkspaceHeader title={labels.invoicing} />
        <PageContent>
          <PageTabs label={labels.invoicing}>
            {tabs.map((tab) => (
              <PageTab
                key={tab.href}
                href={tab.href}
                active={tab.active}
                onPointerEnter={tab.preload}
                onFocus={tab.preload}
              >
                {tab.label}
              </PageTab>
            ))}
          </PageTabs>
          <Counterparties
            defaultRole="customer"
            book={book}
            locale={locale}
            recordId={search.record ?? ""}
            onOpen={(id) => change({ ...search, view: "parties", record: id || undefined })}
          />
        </PageContent>
      </>
    );

  const data = register.isError ? undefined : register.data;

  return (
    <>
      <RegisterWorkspace
        title={labels.invoicing}
        tabs={<RegisterNavigation label={labels.invoicing} options={tabs} />}
        action={
          <Box display="flex" gap="sm" alignItems="center">
            <WorkReturnAction work={work} />
            <Button
              size="sm"
              disabled={book.role !== "operator"}
              onClick={() => open("new", "draft")}
            >
              {labels.newInvoice}
            </Button>
          </Box>
        }
        filters={
          <Box
            as="form"
            display="flex"
            gap="sm"
            alignItems="center"
            flexWrap="wrap"
            ref={(node) => {
              if (node && !search.record) focusRegister();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              change({ ...search, q: searchText.text.trim() || undefined, page: undefined });
            }}
          >
            <SelectControl
              size="compact"
              aria-label={labels.status}
              value={status}
              options={statuses.map((item) => ({
                value: item.value,
                label: `${item.label}${data ? ` ${data.counts[item.value]}` : ""}`,
              }))}
              onValueChange={(value) => {
                const selectedStatus = statuses.find((item) => item.value === value);

                if (selectedStatus)
                  change({
                    ...search,
                    status: selectedStatus.value,
                    page: undefined,
                    record: undefined,
                  });
              }}
            />
            <SelectControl
              size="compact"
              aria-label={labels.sort}
              value={sort}
              options={[
                { value: "newest", label: labels.newest },
                { value: "oldest", label: labels.oldest },
                { value: "customer", label: labels.customer },
                { value: "due", label: labels.dueDate },
              ]}
              onValueChange={(value) => {
                if (
                  value === "newest" ||
                  value === "oldest" ||
                  value === "customer" ||
                  value === "due"
                )
                  change({ ...search, sort: value, page: undefined });
              }}
            />
            <RegisterSearch
              compact
              aria-label={labels.search}
              placeholder={labels.search}
              value={searchText.text}
              onChange={(event) => setSearchText({ ...searchText, text: event.target.value })}
              maxLength={200}
            />
            <Button type="submit" variant="ghost" size="sm">
              <Search size={14} />
              {labels.searchAction}
            </Button>
            {search.q ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchText({ applied: "", text: "" });
                  change({ ...search, q: undefined, page: undefined });
                }}
              >
                {labels.clear}
              </Button>
            ) : null}
          </Box>
        }
        detail={
          <SalesPreview
            data={data}
            selectedId={previewId}
            locale={locale}
            rowStatus={rowStatus}
            rowUrl={rowUrl}
            onOpen={(id) => {
              opener.current = { base, id };
            }}
          />
        }
      >
        {register.isPending || register.isError ? (
          <Box padding="lg">
            <AccountingStatus locale={locale} pending={register.isPending} error={register.error} />
            {register.isError ? (
              <Button
                variant="outline"
                onClick={() => {
                  void register.refetch();
                }}
              >
                {labels.retry}
              </Button>
            ) : null}
          </Box>
        ) : null}
        <SalesRows
          data={data}
          selectedId={previewId}
          locale={locale}
          onSelect={setPreviewId}
          rowStatus={rowStatus}
        />
        {data && !data.items.length ? (
          <Box padding="lg">
            <PageEmpty
              title={search.q || status !== "all" ? labels.noMatches : labels.firstInvoice}
              detail={search.q || status !== "all" ? labels.changeFilters : labels.startInvoice}
            />
          </Box>
        ) : null}
        {data ? (
          <Box padding="lg">
            <SalesPagination
              data={data}
              page={pageNumber}
              locale={locale}
              searching={!!search.q}
              onPage={(page) => change({ ...search, page: String(page) })}
            />
          </Box>
        ) : null}
      </RegisterWorkspace>
      <SalesRecord search={search} close={close} open={open} change={change} />
    </>
  );
}

function SalesRows(props: {
  data: typeof Sales.SalesPage.Type | undefined;
  selectedId: string | null;
  locale: "sv" | "en";
  onSelect: (id: string) => void;
  rowStatus: (row: typeof Sales.SalesRow.Type) => string;
}) {
  const { data, selectedId, locale, rowStatus } = props;
  const labels = locale === "sv" ? swedish : english;
  const groups = [...new Set(data?.items.map((item) => salesGroup(item)) ?? [])];
  const selected = data?.items.find((item) => item.id === selectedId) ?? data?.items[0];

  return (
    <>
      {groups.map((group) => {
        const items = data?.items.filter((row) => salesGroup(row) === group) ?? [];

        return (
          <Box key={group}>
            <RegisterGroup title={labels[group]} count={items.length} />
            {items.map((row) => (
              <RegisterRow
                key={row.id}
                id={row.id}
                prefix={row.number ?? undefined}
                title={row.customer}
                status={salesSymbol(row)}
                state={rowStatus(row)}
                amount={salesAmount(row, locale)}
                selected={row.id === selected?.id}
                onSelect={() => props.onSelect(row.id)}
              />
            ))}
          </Box>
        );
      })}
    </>
  );
}

function salesAmount(row: typeof Sales.SalesRow.Type, locale: "en" | "sv") {
  return row.amountMinor === null
    ? "—"
    : formatMinorAmount(row.amountMinor, row.currencyScale, locale);
}

function SalesPreview(props: {
  data: typeof Sales.SalesPage.Type | undefined;
  selectedId: string | null;
  locale: "en" | "sv";
  rowStatus: (row: typeof Sales.SalesRow.Type) => string;
  rowUrl: (row: typeof Sales.SalesRow.Type) => string;
  onOpen: (id: string) => void;
}) {
  const { data, selectedId, locale, rowStatus } = props;
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const selected = data?.items.find((item) => item.id === selectedId) ?? data?.items[0];

  if (!selected)
    return (
      <PageCaption>
        {sv ? "Välj en faktura för att se detaljer." : "Select an invoice to see details."}
      </PageCaption>
    );

  return (
    <>
      <RegisterDetailHeading
        title={selected.customer}
        amount={salesAmount(selected, locale)}
        caption={selected.number ?? selected.title}
      />
      <PageCaption>
        {rowStatus(selected)} · {selected.currency}
      </PageCaption>
      <PageCaption>
        {labels.date}: {selected.date.slice(0, 10)}
        {selected.dueOn ? ` · ${labels.dueDate}: ${selected.dueOn}` : ""}
      </PageCaption>
      {selected.outstandingMinor !== null ? (
        <PageCaption>
          {formatMinorAmount(selected.outstandingMinor, selected.currencyScale, locale)}{" "}
          {selected.currency} {labels.remaining}
        </PageCaption>
      ) : null}
      <RegisterDetailActions>
        <PageAction href={props.rowUrl(selected)} onClick={() => props.onOpen(selected.id)}>
          {sv ? "Öppna faktura" : "Open invoice"}
        </PageAction>
      </RegisterDetailActions>
    </>
  );
}

function salesGroup(
  row: typeof Sales.SalesRow.Type,
): "overdue" | "drafts" | "open" | "settled" | "cancelled" {
  if (row.overdue) return "overdue";

  if (row.status === "draft") return "drafts";

  if (row.status === "allocated") return "settled";

  if (row.status === "cancelled") return "cancelled";

  return "open";
}

function salesSymbol(row: typeof Sales.SalesRow.Type): RegisterStatus {
  if (row.overdue || row.needsDetails || row.status === "blocked") return "warning";

  if (row.status === "allocated") return "completed";

  if (row.status === "draft") return "draft";

  return "open";
}

function SalesPagination(props: {
  data: typeof Sales.SalesPage.Type;
  page: number;
  locale: "en" | "sv";
  searching: boolean;
  onPage: (page: number) => void;
}) {
  const { data, page, locale } = props;
  const labels = locale === "sv" ? swedish : english;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const first = (page - 1) * data.pageSize + 1;
  const last = first + data.items.length - 1;

  return (
    <Box display="flex" justifyContent="between" alignItems="center" gap="lg">
      <PageCaption>
        {data.items.length > 0 && pages > 1 ? `${first}–${last} ${labels.of} ` : ""}
        {data.total}{" "}
        {(data.total === 1 ? labels.invoice : labels.invoices).toLocaleLowerCase(locale)}
        {props.searching ? ` · ${labels.matchingSearch}` : ""}
      </PageCaption>
      {page <= pages && (page > 1 || pages > 1) ? (
        <Box display="flex" gap="sm" alignItems="center">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => props.onPage(Math.min(page - 1, pages))}
          >
            <ArrowLeft size={14} />
            {labels.previous}
          </Button>
          <PageCaption>
            {page} / {pages}
          </PageCaption>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pages}
            onClick={() => props.onPage(page + 1)}
          >
            {labels.next}
            <ArrowRight size={14} />
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function SalesRecord({
  search,
  close,
  open,
  change,
}: {
  search: SalesSearch;
  close: () => void;
  open: (id: string, kind: "draft" | "invoice") => void;
  change: (next: SalesSearch) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const labels = locale === "sv" ? swedish : english;
  const selectedKind = search.kind ?? (search.view === "invoices" ? "invoice" : "draft");
  const reviewing = search.stage === "review" || search.view === "issue";

  return (
    <>
      {search.record === "new" ? (
        <NewInvoiceDraft
          book={book}
          locale={locale}
          onSaved={(id) => open(id, "draft")}
          onClose={close}
        />
      ) : null}
      {(search.record && search.record !== "new") || reviewing ? (
        <RecordSheet
          title={reviewing ? labels.reviewInvoice : labels.invoice}
          closeLabel={labels.close}
          dismissible={!reviewing && selectedKind === "draft"}
          invoice={!reviewing}
          onClose={close}
        >
          {reviewing ? (
            <InvoiceIssuance
              book={book}
              locale={locale}
              recordId={search.record}
              reviewId={search.review}
              onReviewOpen={(id) => change({ ...search, review: id })}
              onIssued={(id) => open(id, "invoice")}
              onBack={() =>
                change({ ...search, view: undefined, stage: undefined, review: undefined })
              }
            />
          ) : selectedKind === "draft" ? (
            <InvoiceDraftIssueOverlay
              book={book}
              locale={locale}
              recordId={search.record}
              onOpen={(id) => (id ? open(id, "draft") : close())}
              onReview={() => change({ ...search, view: undefined, stage: "review" })}
            />
          ) : (
            <Invoices
              contextual
              book={book}
              locale={locale}
              direction="customer"
              onPayments={() =>
                change({
                  ...search,
                  stage: "payments",
                  allocation: undefined,
                  release: undefined,
                  paymentPage: undefined,
                  paymentHistoryPage: undefined,
                })
              }
              paymentView={
                search.stage === "payments"
                  ? {
                      planId: search.allocation,
                      releaseId: search.release,
                      page: Number(search.paymentPage ?? "1"),
                      historyPage: Number(search.paymentHistoryPage ?? "1"),
                      onPage: (page) => change({ ...search, paymentPage: String(page) }),
                      onHistoryPage: (page) =>
                        change({ ...search, paymentHistoryPage: String(page) }),
                      onPlan: (id) => change({ ...search, allocation: id, release: undefined }),
                      onRelease: (id) => change({ ...search, release: id }),
                      onBack: () =>
                        change({
                          ...search,
                          stage: undefined,
                          allocation: undefined,
                          release: undefined,
                          paymentPage: undefined,
                          paymentHistoryPage: undefined,
                        }),
                    }
                  : undefined
              }
              recordId={search.record}
              onOpen={(id) => (id ? open(id, "invoice") : close())}
            />
          )}
        </RecordSheet>
      ) : null}
    </>
  );
}

const english = {
  invoicing: "Sales",
  articleCatalog: "Article catalog",
  invoices: "Invoices",
  invoice: "Invoice",
  customers: "Customers & contacts",
  newInvoice: "New invoice",
  all: "All",
  drafts: "Drafts",
  draft: "Draft",
  open: "Outstanding",
  overdue: "Overdue",
  overdueInvoice: "Overdue",
  settled: "Settled",
  cancelled: "Cancelled",
  cancelledInvoice: "Cancelled",
  partially_allocated: "Partly settled",
  allocated: "Settled",
  blocked: "Needs review",
  needsDetails: "Needs details",
  sort: "Sort invoices",
  newest: "Newest first",
  oldest: "Oldest first",
  customer: "Customer",
  dueDate: "Due date",
  date: "Date",
  updated: "Last saved",
  issued: "Invoice date",
  remaining: "remaining",
  of: "of",
  noPage: "This page has no invoices",
  returnToFirst: "The register has changed. Return to the first page of this view.",
  firstPage: "Go to first page",
  amount: "Amount",
  status: "Status",
  search: "Search customer, invoice or description…",
  searchAction: "Search",
  clear: "Clear",
  retry: "Try again",
  noMatches: "No invoices match this view",
  changeFilters: "Choose another status or clear your search.",
  firstInvoice: "Your first invoice starts here",
  startInvoice: "Choose New invoice to add a customer and your line items.",
  matchingSearch: "matching your search",
  previous: "Previous",
  next: "Next",
  reviewInvoice: "Review invoice",
  close: "Close invoice",
};

const swedish: typeof english = {
  invoicing: "Försäljning",
  articleCatalog: "Artiklar",
  invoices: "Fakturor",
  invoice: "Faktura",
  customers: "Kunder",
  newInvoice: "Ny faktura",
  all: "Alla",
  drafts: "Utkast",
  draft: "Utkast",
  open: "Utestående",
  overdue: "Förfallna",
  overdueInvoice: "Förfallen",
  settled: "Reglerade",
  cancelled: "Makulerade",
  cancelledInvoice: "Makulerad",
  partially_allocated: "Delvis reglerad",
  allocated: "Reglerad",
  blocked: "Behöver granskas",
  needsDetails: "Behöver kompletteras",
  sort: "Sortera fakturor",
  newest: "Nyaste först",
  oldest: "Äldsta först",
  customer: "Kund",
  dueDate: "Förfallodatum",
  date: "Datum",
  updated: "Senast sparad",
  issued: "Fakturadatum",
  remaining: "kvar",
  of: "av",
  noPage: "Den här sidan saknar fakturor",
  returnToFirst: "Registret har ändrats. Gå till första sidan i den här vyn.",
  firstPage: "Gå till första sidan",
  amount: "Belopp",
  status: "Status",
  search: "Sök kund, faktura eller beskrivning…",
  searchAction: "Sök",
  clear: "Rensa",
  retry: "Försök igen",
  noMatches: "Inga fakturor matchar vyn",
  changeFilters: "Välj en annan status eller rensa sökningen.",
  firstInvoice: "Din första faktura börjar här",
  startInvoice: "Välj Ny faktura för att lägga till kund och fakturarader.",
  matchingSearch: "matchar din sökning",
  previous: "Föregående",
  next: "Nästa",
  reviewInvoice: "Granska faktura",
  close: "Stäng faktura",
};
