import { bookScope, httpQuery } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { useRef, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, defaultStringifySearch } from "@tanstack/react-router";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Sales from "@open-erp/contracts/sales-register";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import {
  RegisterWorkspace,
  RegisterFilter,
  RegisterGroup,
  RegisterRow,
  RegisterDetailHeading,
  RegisterDetailActions,
  RegisterDetailLink,
  RegisterDetailLinks,
  RegisterDetailLines,
  type RegisterStatus,
} from "@open-erp/ui/components/register-workspace";
import { PageAction } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { readAccounting } from "@/lib/accounting-api";
import { decodeWorkReturn, encodeWorkReturn } from "@/lib/work-return";
import { WorkReturnAction } from "@/components/work-return-action";
import { commerceKey, checkScope } from "./shared";
import { InvoiceDraftIssueOverlay } from "./invoice-draft-issue-overlay";
import { NewInvoiceDraft } from "./invoice-drafts";
import { InvoiceIssuance } from "./invoice-issuance";
import { Invoices } from "./invoices";
import { counterpartyRegisterOptions } from "./counterparties";
import { SalesNavigation } from "./sales-navigation";
import { CounterpartyRegister } from "./counterparty-register";

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
        (client) =>
          client.invoiceDrafts.salesRegister({
            params: { ...bookScope(book) },
            query: httpQuery(Api.groups.invoiceDrafts.endpoints.salesRegister, `${query}`),
          }),
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

  const statuses: Array<{ value: typeof Sales.SalesStatus.Type; label: string }> = [
    { value: "all", label: labels.all },
    { value: "draft", label: labels.drafts },
    { value: "open", label: labels.open },
    { value: "overdue", label: labels.overdue },
    { value: "settled", label: labels.settled },
    { value: "cancelled", label: labels.cancelled },
  ];

  const rowStatus = (row: typeof Sales.SalesRow.Type) => {
    if (row.overdue && row.dueOn) return `${labels.overdueSince} ${shortDate(row.dueOn, locale)}`;

    if (row.overdue) return labels.overdueInvoice;

    if (row.status === "cancelled") return labels.cancelledInvoice;

    if (row.status === "draft") return row.needsDetails ? labels.needsDetails : labels.notIssued;

    if (row.status === "open" && row.dueOn)
      return `${labels.dueOn} ${shortDate(row.dueOn, locale)}`;

    return labels[row.status];
  };

  const navigation = (
    <SalesNavigation
      view={contacts ? "parties" : undefined}
      search={registerSearch}
      preloadInvoices={preloadInvoices}
      preloadCustomers={preloadCustomers}
    />
  );

  if (contacts)
    return (
      <CounterpartyRegister
        book={book}
        locale={locale}
        role="customer"
        title={labels.invoicing}
        navigation={navigation}
        recordId={search.record}
        onOpen={(id) => change({ ...search, view: "parties", record: id || undefined })}
      />
    );

  const data = register.isError ? undefined : register.data;

  return (
    <>
      <RegisterWorkspace
        detailSize="invoice"
        title={labels.invoicing}
        tabs={navigation}
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
          <RegisterFilter
            label={labels.status}
            value={status}
            options={statuses}
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
        }
        summary={receivables(data, book.currency, labels.openReceivables, locale)}
        detail={
          <SalesPreview
            data={data}
            selectedId={previewId}
            locale={locale}
            rowStatus={rowStatus}
            rowUrl={rowUrl}
            paymentsUrl={(row) =>
              `${base}${defaultStringifySearch({ record: row.id, kind: "invoice", stage: "payments" })}`
            }
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
        {data && (pageNumber > 1 || data.total > data.pageSize) ? (
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
  const present = new Set(data?.items.map((item) => salesGroup(item)));

  const groups = (["overdue", "open", "drafts", "settled", "cancelled"] as const).filter((group) =>
    present.has(group),
  );

  const selected = data?.items.find((item) => item.id === selectedId) ?? nextInvoice(data?.items);

  return (
    <>
      {groups.map((group) => {
        const items = (data?.items.filter((row) => salesGroup(row) === group) ?? []).sort(
          (left, right) =>
            group === "open" ? (left.dueOn ?? "").localeCompare(right.dueOn ?? "") : 0,
        );

        return (
          <Box key={group}>
            <RegisterGroup title={labels[group]} count={items.length} />
            {items.map((row) => (
              <RegisterRow
                key={row.id}
                id={row.id}
                prefix={row.number ?? (row.kind === "draft" ? labels.draft : undefined)}
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

// The sum is shown only when the page holds every open row, so it never understates a total.
function receivables(
  data: typeof Sales.SalesPage.Type | undefined,
  currency: string,
  label: string,
  locale: "en" | "sv",
) {
  if (!data || data.items.length !== data.total) return undefined;

  const open = data.items.filter(
    (row) => row.kind === "invoice" && row.currency === currency && row.outstandingMinor !== null,
  );

  const total = open.reduce((sum, row) => sum + BigInt(row.outstandingMinor ?? "0"), 0n);
  const scale = open[0]?.currencyScale ?? 2;

  return `${label} ${formatMinorAmount(total.toString(), scale, locale)}`;
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
  paymentsUrl: (row: typeof Sales.SalesRow.Type) => string;
  onOpen: (id: string) => void;
}) {
  const { data, selectedId, locale, rowStatus } = props;
  const sv = locale === "sv";
  const selected = data?.items.find((item) => item.id === selectedId) ?? nextInvoice(data?.items);

  if (!selected)
    return (
      <PageCaption>
        {sv ? "Välj en faktura för att se detaljer." : "Select an invoice to see details."}
      </PageCaption>
    );

  const payable =
    selected.kind === "invoice" &&
    (selected.status === "open" || selected.status === "partially_allocated");

  return (
    <>
      <RegisterDetailHeading
        title={selected.customer}
        amount={salesAmount(selected, locale)}
        caption={previewCaption(selected, locale)}
        note={previewNote(selected, data?.asOf, rowStatus(selected), locale)}
      />
      {selected.draftId ? <DraftPreviewLines id={selected.draftId} locale={locale} /> : null}
      <RegisterDetailActions>
        {payable ? (
          <PageAction href={props.paymentsUrl(selected)}>
            {sv ? "Registrera betalning" : "Register payment"}
          </PageAction>
        ) : null}
        <RegisterDetailLinks>
          <RegisterDetailLink
            href={props.rowUrl(selected)}
            onClick={() => props.onOpen(selected.id)}
          >
            {sv ? "Öppna faktura" : "Open invoice"}
          </RegisterDetailLink>
        </RegisterDetailLinks>
      </RegisterDetailActions>
    </>
  );
}

function shortDate(value: string, locale: "en" | "sv") {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString(locale === "sv" ? "sv-SE" : "en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    })
    .replace(".", "");
}

function previewCaption(row: typeof Sales.SalesRow.Type, locale: "en" | "sv") {
  const number = row.number ?? row.title;

  if (row.kind === "draft") return number;

  return `${number}, ${locale === "sv" ? "utfärdad" : "issued"} ${shortDate(row.date, locale)}`;
}

function previewNote(
  row: typeof Sales.SalesRow.Type,
  asOf: string | undefined,
  status: string,
  locale: "en" | "sv",
) {
  if (
    !row.dueOn ||
    !asOf ||
    (!row.overdue && row.status !== "open" && row.status !== "partially_allocated")
  )
    return status;

  const days = Math.round(
    (Date.parse(`${row.dueOn}T00:00:00Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000,
  );

  const date = shortDate(row.dueOn, locale);

  if (locale === "sv")
    return row.overdue
      ? `Förföll ${date}, ${-days} dagar sedan`
      : `Förfaller ${date}, ${days} dagar kvar`;

  return row.overdue ? `Overdue since ${date}, ${-days} days` : `Due ${date}, ${days} days left`;
}

function DraftPreviewLines({ id, locale }: { id: string; locale: "en" | "sv" }) {
  const { book } = useBookWorkspace();

  const view = useQuery({
    queryKey: [...commerceKey(book), "invoice-draft", id, ""],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.invoiceDrafts.getInvoiceDraft({
            params: { ...bookScope(book), id: id },
            query: httpQuery(Api.groups.invoiceDrafts.endpoints.getInvoiceDraft, ``),
          }),
        Drafts.InvoiceDraftView,
        { signal },
      );

      checkScope(book, result.record.scope);

      if (result.record.id !== id) throw new Error("Invoice draft identity mismatch");

      return result;
    },
    retry: false,
  });

  if (!view.data || view.isError)
    return <AccountingStatus pending={view.isPending} error={view.error} locale={locale} />;
  const { record } = view.data;
  const amount = (minor: string) => formatMinorAmount(minor, record.content.currencyScale, locale);

  const lines = record.calculatedLines.map((line) => ({
    id: line.id,
    description:
      record.content.lines.find((source) => source.id === line.id)?.description ?? line.id,
    amount: amount(line.netMinor),
  }));

  if (record.totals.taxMinor !== null)
    lines.push({
      id: "tax-total",
      description: locale === "sv" ? "Moms" : "VAT",
      amount: amount(record.totals.taxMinor),
    });

  return <RegisterDetailLines title={locale === "sv" ? "Rader" : "Lines"} lines={lines} />;
}

// Without a choice, preview the sent invoice that falls due first, then the overdue one.
function nextInvoice(items: readonly (typeof Sales.SalesRow.Type)[] | undefined) {
  const sent = items
    ?.filter((row) => salesGroup(row) === "open")
    .sort((left, right) => (left.dueOn ?? "").localeCompare(right.dueOn ?? ""));

  return sent?.[0] ?? items?.find((row) => row.overdue) ?? items?.[0];
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
  if (row.overdue) return "overdue";

  if (row.needsDetails || row.status === "blocked") return "warning";

  if (row.status === "allocated") return "completed";

  if (row.status === "draft") return "draft";

  return row.status === "cancelled" ? "open" : "pending";
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
        {props.searching ? `, ${labels.matchingSearch}` : ""}
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
  notIssued: "Not issued",
  overdueSince: "Overdue since",
  dueOn: "Due",
  open: "Sent",
  overdue: "Overdue",
  overdueInvoice: "Overdue",
  settled: "Paid",
  cancelled: "Cancelled",
  cancelledInvoice: "Cancelled",
  partially_allocated: "Partly paid",
  allocated: "Paid",
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
  openReceivables: "Open receivables",
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
  notIssued: "Ej utfärdad",
  overdueSince: "Förföll",
  dueOn: "Förfaller",
  open: "Skickade",
  overdue: "Förfallna",
  overdueInvoice: "Förfallen",
  settled: "Betalda",
  cancelled: "Makulerade",
  cancelledInvoice: "Makulerad",
  partially_allocated: "Delvis betald",
  allocated: "Betald",
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
  openReceivables: "Öppna fordringar",
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
