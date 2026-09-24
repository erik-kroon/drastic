import { useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, defaultStringifySearch } from "@tanstack/react-router";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Sales from "@open-erp/contracts/sales-register";
import { Plus, ArrowLeft, ArrowRight, Search } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { SelectControl } from "@open-erp/ui/components/select";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import {
  PageContent,
  PageCaption,
  PageEmpty,
  RegisterFilters,
  RegisterSearch,
  RegisterFilter,
} from "@open-erp/ui/components/accounting-page";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { readAccounting } from "@/lib/accounting-api";
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
  const sv = locale === "sv";
  const labels = sv ? swedish : english;
  const base = `${workspacePath(book)}/sales`;
  const contacts = search.view === "parties";
  const status = search.status ?? (search.view === "drafts" && !search.record ? "draft" : "all");
  const sort = search.sort ?? "newest";
  const pageNumber = Number(search.page ?? "1");
  const [searchText, setSearchText] = useState({ applied: search.q ?? "", text: search.q ?? "" });
  if (searchText.applied !== (search.q ?? ""))
    setSearchText({ applied: search.q ?? "", text: search.q ?? "" });
  const query = new URLSearchParams({ status, sort, page: String(pageNumber), q: search.q ?? "" });
  const register = useQuery({
    ...salesRegisterOptions(book, query),
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
  const close = () =>
    change({
      ...search,
      view: contacts ? "parties" : undefined,
      record: undefined,
      kind: undefined,
      stage: undefined,
      review: undefined,
      allocation: undefined,
      release: undefined,
      paymentPage: undefined,
      paymentHistoryPage: undefined,
    });
  const open = (id: string, kind: "draft" | "invoice") =>
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
  const rowUrl = (row: typeof Sales.SalesRow.Type) => {
    return `${base}${defaultStringifySearch({
      status,
      sort,
      page: pageNumber,
      q: search.q || undefined,
      record: row.id,
      kind: row.kind,
    })}`;
  };
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
  return (
    <>
      <WorkspaceHeader
        title={labels.invoicing}
        action={
          !contacts ? (
            <Button disabled={book.role !== "operator"} onClick={() => open("new", "draft")}>
              <Plus size={14} />
              {labels.newInvoice}
            </Button>
          ) : undefined
        }
      />
      <PageContent>
        <PageTabs label={labels.invoicing}>
          <PageTab
            href={base}
            active={!contacts}
            onPointerEnter={preloadInvoices}
            onFocus={preloadInvoices}
          >
            {labels.invoices}
          </PageTab>
          <PageTab
            href={`${base}?view=parties`}
            active={contacts}
            onPointerEnter={preloadCustomers}
            onFocus={preloadCustomers}
          >
            {labels.customers}
          </PageTab>
        </PageTabs>
        {contacts ? (
          <Counterparties
            defaultRole="customer"
            book={book}
            locale={locale}
            recordId={search.record ?? ""}
            onOpen={(id) => change({ view: "parties", record: id || undefined })}
          />
        ) : (
          <>
            <Box
              display="flex"
              justifyContent="between"
              alignItems="center"
              flexWrap="wrap"
              gap="lg"
            >
              <RegisterFilters>
                {statuses.map((item) => (
                  <Button
                    key={item.value}
                    size="sm"
                    variant={status === item.value ? "secondary" : "ghost"}
                    static
                    onClick={() =>
                      change({
                        ...search,
                        view: undefined,
                        status: item.value,
                        page: undefined,
                        record: undefined,
                      })
                    }
                  >
                    {item.label}
                    {register.isSuccess ? ` ${register.data.counts[item.value]}` : ""}
                  </Button>
                ))}
              </RegisterFilters>
              <RegisterFilter>
                <SelectControl
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
              </RegisterFilter>
            </Box>
            <Box
              as="form"
              display="flex"
              gap="sm"
              alignItems="center"
              onSubmit={(event) => {
                event.preventDefault();
                change({ ...search, q: searchText.text.trim() || undefined, page: undefined });
              }}
            >
              <RegisterSearch
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
            <AccountingStatus locale={locale} pending={register.isPending} error={register.error} />
            {register.isError ? (
              <Box>
                <Button
                  variant="outline"
                  onClick={() => {
                    void register.refetch();
                  }}
                >
                  {labels.retry}
                </Button>
              </Box>
            ) : null}
            {register.data && !register.isError ? (
              <>
                <SalesPagination
                  data={register.data}
                  page={pageNumber}
                  locale={locale}
                  searching={!!search.q}
                  onPage={(page) => change({ ...search, page: String(page) })}
                />
                {register.data.items.length ? (
                  <DataTable
                    title={labels.invoices}
                    minWidth="wide"
                    columns={[
                      { id: "invoice", label: labels.invoice },
                      { id: "customer", label: labels.customer },
                      { id: "status", label: labels.status },
                      { id: "date", label: labels.date },
                      { id: "due", label: labels.dueDate },
                      { id: "amount", label: labels.amount, numeric: true },
                    ]}
                    rows={register.data.items.map((row) => ({
                      id: row.id,
                      cells: [
                        <Box key="invoice" display="grid" gap="xs">
                          <Link href={rowUrl(row)}>{row.number ?? row.title}</Link>
                          {row.number ? <Text tone="muted">{row.title}</Text> : null}
                        </Box>,
                        row.customer,
                        <Badge
                          key="status"
                          variant={
                            row.overdue || row.needsDetails
                              ? "warning"
                              : row.status === "allocated"
                                ? "success"
                                : "secondary"
                          }
                        >
                          {rowStatus(row)}
                        </Badge>,
                        <Box key="date" display="grid" gap="xs">
                          <Text>
                            {new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            }).format(new Date(row.date))}
                          </Text>
                          <Text tone="muted">
                            {row.kind === "draft" ? labels.updated : labels.issued}
                          </Text>
                        </Box>,
                        row.dueOn
                          ? new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            }).format(new Date(row.dueOn))
                          : "—",
                        <Box key="amount" display="grid" gap="xs">
                          <Text>
                            {row.amountMinor === null
                              ? "—"
                              : `${formatMinorAmount(row.amountMinor, row.currencyScale, locale)} ${row.currency}`}
                          </Text>
                          {row.status === "partially_allocated" && row.outstandingMinor !== null ? (
                            <Text tone="muted">
                              {formatMinorAmount(row.outstandingMinor, row.currencyScale, locale)}{" "}
                              {row.currency} {labels.remaining}
                            </Text>
                          ) : null}
                        </Box>,
                      ],
                    }))}
                  />
                ) : register.data.total > 0 ? (
                  <Box display="grid" gap="md">
                    <PageEmpty title={labels.noPage} detail={labels.returnToFirst} />
                    <Box>
                      <Button
                        variant="outline"
                        onClick={() => change({ ...search, page: undefined })}
                      >
                        {labels.firstPage}
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <PageEmpty
                    title={search.q || status !== "all" ? labels.noMatches : labels.firstInvoice}
                    detail={
                      search.q || status !== "all" ? labels.changeFilters : labels.startInvoice
                    }
                  />
                )}
                {register.data.items.length > 10 ? (
                  <SalesPagination
                    data={register.data}
                    page={pageNumber}
                    locale={locale}
                    searching={!!search.q}
                    onPage={(page) => change({ ...search, page: String(page) })}
                  />
                ) : null}
              </>
            ) : null}
            <SalesRecord search={search} close={close} open={open} change={change} />
          </>
        )}
      </PageContent>
    </>
  );
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
                change({ ...search, stage: "payments", allocation: undefined, release: undefined, paymentPage: undefined, paymentHistoryPage: undefined })
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
  invoicing: "Invoicing",
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
  invoicing: "Fakturering",
  invoices: "Fakturor",
  invoice: "Faktura",
  customers: "Kunder och kontakter",
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
