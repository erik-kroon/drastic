import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Suppliers from "@open-erp/contracts/supplier-invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import {
  PageAction,
  PageCaption,
  PageEmpty,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { SelectControl } from "@open-erp/ui/components/select";
import {
  RegisterWorkspace,
  RegisterNavigation,
  RegisterGroup,
  RegisterRow,
  RegisterDetailHeading,
  RegisterDetailActions,
  type RegisterStatus,
} from "@open-erp/ui/components/register-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { useOwnerReturn, decodeWorkReturn, workReturnHref } from "@/lib/work-return";
import { checkScope, commerceKey, commercePath } from "./shared";

type PurchaseRow = {
  key: string;
  id: string;
  kind: "draft" | "invoice";
  supplier: string;
  number: string | null;
  amount: string;
  currency: string;
  date: string;
  state: string;
  status: RegisterStatus;
  group: string;
};

export function PurchaseRegister({ workSearch }: { workSearch?: string }) {
  const { book, locale, setup } = useBookWorkspace();
  const sv = locale === "sv";
  const base = `${workspacePath(book)}/purchases`;
  const owner = useOwnerReturn();
  const work = decodeWorkReturn(workSearch);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("open");
  const [selection, setSelection] = useState<string | null>(null);

  const invoices = useInfiniteQuery({
    queryKey: [...commerceKey(book), "invoice-register"],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const page = await readAccounting(
        `${commercePath(book)}/invoices${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Commerce.InvoicePage,
        { signal },
      );

      page.items.forEach((invoice) => checkScope(book, invoice.scope));

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const drafts = useInfiniteQuery({
    queryKey: [...commerceKey(book), "supplier-invoice-drafts", ""],
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) => {
      const query = new URLSearchParams({ q: "" });

      if (pageParam) query.set("after", pageParam);

      const page = await readAccounting(
        `${commercePath(book)}/supplier-invoice-drafts?${query}`,
        Suppliers.SupplierInvoiceDraftList,
        { signal },
      );

      checkScope(book, page.scope);

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const rows = purchaseRows({
    invoices: invoices.isError ? [] : (invoices.data?.pages.flatMap((page) => page.items) ?? []),
    drafts: drafts.isError ? [] : (drafts.data?.pages.flatMap((page) => page.items) ?? []),
    locale,
    today: setup.today,
  }).filter((row) => matchesPurchase(row, status, q, locale));

  const selected = rows.find((row) => row.key === selection) ?? rows[0];
  const groups = [...new Set(rows.map((row) => row.group))];

  const href = (row: PurchaseRow) =>
    `${workReturnHref(base, row.kind === "draft" ? "supplier-drafts" : "invoices", work, owner)}&record=${encodeURIComponent(row.id)}`;

  return (
    <RegisterWorkspace
      title={sv ? "Inköp" : "Purchases"}
      tabs={
        <RegisterNavigation
          label={sv ? "Inköp" : "Purchases"}
          options={[
            {
              label: sv ? "Leverantörsfakturor" : "Supplier invoices",
              href: workReturnHref(base, "register", work, owner),
              active: true,
            },
            {
              label: sv ? "Leverantörer" : "Suppliers",
              href: workReturnHref(base, "parties", work, owner),
              active: false,
            },
            {
              label: sv ? "Utlägg och kvitton" : "Expenses and receipts",
              href: workReturnHref(base, "expenses", work, owner),
              active: false,
            },
            {
              label: sv ? "Betalfil" : "Payment files",
              href: workReturnHref(base, "supplier-payment-files", work, owner),
              active: false,
            },
          ]}
        />
      }
      action={
        <PageAction compact href={`${workReturnHref(base, "documents", work, owner)}&record=new`}>
          {sv ? "Lägg till underlag" : "Add source document"}
        </PageAction>
      }
      filters={
        <>
          <SelectControl
            size="compact"
            aria-label="Status"
            value={status}
            onValueChange={(value) => setStatus(value ?? "open")}
            options={[
              { value: "open", label: sv ? "Utestående" : "Outstanding" },
              { value: "all", label: sv ? "Alla" : "All" },
              { value: "draft", label: sv ? "Utkast" : "Drafts" },
              { value: "completed", label: sv ? "Avslutade" : "Completed" },
            ]}
          />
          <RegisterSearch
            compact
            aria-label={sv ? "Sök leverantörsfakturor" : "Search supplier invoices"}
            placeholder={sv ? "Sök" : "Search"}
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </>
      }
      detail={
        selected ? (
          <>
            <RegisterDetailHeading
              title={selected.supplier}
              amount={selected.amount}
              caption={selected.number ?? selected.state}
            />
            <PageCaption>
              {selected.state}, {selected.currency}
            </PageCaption>
            <PageCaption>{selected.date}</PageCaption>
            <RegisterDetailActions>
              <PageAction href={href(selected)}>{sv ? "Öppna faktura" : "Open invoice"}</PageAction>
            </RegisterDetailActions>
          </>
        ) : (
          <PageCaption>
            {sv
              ? "Välj en faktura för att se nästa steg."
              : "Select an invoice to see the next step."}
          </PageCaption>
        )
      }
    >
      <PurchaseReadStatus locale={locale} invoices={invoices} drafts={drafts} />
      {groups.map((group) => (
        <Box key={group}>
          <RegisterGroup title={group} count={rows.filter((row) => row.group === group).length} />
          {rows
            .filter((row) => row.group === group)
            .map((row) => (
              <RegisterRow
                key={row.key}
                title={row.supplier}
                prefix={row.number ?? undefined}
                state={row.state}
                status={row.status}
                amount={row.amount}
                selected={row.key === selected?.key}
                onSelect={() => setSelection(row.key)}
              />
            ))}
        </Box>
      ))}
      <PurchaseCoverage
        invoices={invoices}
        drafts={drafts}
        locale={locale}
        empty={rows.length === 0}
      />
      <Box padding="lg">
        <PageAction
          quiet
          href={`${workReturnHref(base, "supplier-drafts", work, owner)}&record=new`}
        >
          {sv ? "Ny leverantörsfaktura" : "New supplier invoice"}
        </PageAction>
      </Box>
    </RegisterWorkspace>
  );
}

function matchesPurchase(row: PurchaseRow, status: string, q: string, locale: "sv" | "en") {
  if (status === "open" && (row.status === "completed" || row.kind === "draft")) return false;

  if (status === "completed" && row.status !== "completed") return false;

  if (status === "draft" && row.kind !== "draft") return false;

  return `${row.supplier} ${row.number ?? ""}`
    .toLocaleLowerCase(locale)
    .includes(q.toLocaleLowerCase(locale));
}

function PurchaseReadStatus(props: {
  locale: "sv" | "en";
  invoices: { isPending: boolean; error: Error | null; refetch: () => Promise<unknown> };
  drafts: { isPending: boolean; error: Error | null; refetch: () => Promise<unknown> };
}) {
  const pending = props.invoices.isPending || props.drafts.isPending;
  const error = props.invoices.error ?? props.drafts.error;

  if (!pending && !error) return null;

  return (
    <Box padding="lg" display="grid" gap="sm">
      <AccountingStatus locale={props.locale} pending={pending} error={error} />
      {error ? (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            void props.invoices.refetch();
            void props.drafts.refetch();
          }}
        >
          {props.locale === "sv" ? "Försök igen" : "Try again"}
        </Button>
      ) : null}
    </Box>
  );
}

function purchaseRows(props: {
  invoices: readonly (typeof Commerce.Invoice.Type)[];
  drafts: readonly (typeof Suppliers.SupplierInvoiceDraftSummary.Type)[];
  locale: "sv" | "en";
  today: string;
}): PurchaseRow[] {
  const sv = props.locale === "sv";

  const rows = props.invoices
    .filter((invoice) => invoice.direction === "supplier")
    .map((invoice): PurchaseRow => {
      const completed = ["allocated", "credited", "cancelled"].includes(invoice.status);

      const overdue =
        invoice.currentRevision.dueOn < props.today &&
        invoice.outstandingMinor !== null &&
        BigInt(invoice.outstandingMinor) > 0n;

      const labels = {
        open: sv ? "Utestående" : "Outstanding",
        partially_allocated: sv ? "Delvis avräknad" : "Partly allocated",
        allocated: sv ? "Avräknad" : "Allocated",
        credited: sv ? "Krediterad" : "Credited",
        partially_credited: sv ? "Delvis krediterad" : "Partly credited",
        blocked: sv ? "Behöver granskas" : "Needs review",
        cancelled: sv ? "Makulerad" : "Cancelled",
      };

      return {
        key: `invoice:${invoice.id}`,
        id: invoice.id,
        kind: "invoice",
        supplier: invoice.counterpartyName,
        number: invoice.documentNumber,
        amount:
          invoice.outstandingMinor === null
            ? "—"
            : formatMinorAmount(invoice.outstandingMinor, invoice.currencyScale, props.locale),
        currency: invoice.currency,
        date: invoice.currentRevision.dueOn,
        state: overdue ? (sv ? "Förfallen" : "Overdue") : labels[invoice.status],
        status: completed
          ? "completed"
          : overdue || invoice.status === "blocked"
            ? "warning"
            : "pending",
        group: completed
          ? sv
            ? "Avslutade"
            : "Completed"
          : overdue
            ? sv
              ? "Förfallna"
              : "Overdue"
            : sv
              ? "Kommande"
              : "Upcoming",
      };
    });

  for (const draft of props.drafts)
    rows.push({
      key: `draft:${draft.id}`,
      id: draft.id,
      kind: "draft",
      supplier: draft.supplierName,
      number: draft.supplierDocumentNumber,
      amount:
        draft.grossMinor === null
          ? "—"
          : formatMinorAmount(draft.grossMinor, draft.currencyScale, props.locale),
      currency: draft.currency,
      date: draft.createdAt.slice(0, 10),
      state: sv ? "Sparat utkast" : "Retained draft",
      status: draft.blockerCount > 0 ? "warning" : "draft",
      group: sv ? "Sparade utkast" : "Retained drafts",
    });

  return rows;
}

function PurchaseCoverage(props: {
  invoices: {
    isSuccess: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
  drafts: {
    isSuccess: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
  locale: "sv" | "en";
  empty: boolean;
}) {
  const sv = props.locale === "sv";

  return (
    <Box padding="lg" display="grid" gap="sm">
      {props.empty && props.invoices.isSuccess && props.drafts.isSuccess ? (
        <PageEmpty
          title={sv ? "Inga matchande fakturor" : "No matching invoices"}
          detail={
            sv
              ? "Ändra filtret eller lägg till ett underlag."
              : "Change the filter or add a source document."
          }
        />
      ) : null}
      {props.invoices.hasNextPage || props.drafts.hasNextPage ? (
        <>
          <PageCaption>
            {sv
              ? "Filtren gäller inlästa fakturor och utkast."
              : "Filters cover loaded invoices and drafts."}
          </PageCaption>
          {props.invoices.hasNextPage ? (
            <Button
              variant="outline"
              disabled={props.invoices.isFetchingNextPage}
              onClick={() => {
                void props.invoices.fetchNextPage();
              }}
            >
              {sv ? "Läs in fler fakturor" : "Load more invoices"}
            </Button>
          ) : null}
          {props.drafts.hasNextPage ? (
            <Button
              variant="outline"
              disabled={props.drafts.isFetchingNextPage}
              onClick={() => {
                void props.drafts.fetchNextPage();
              }}
            >
              {sv ? "Läs in fler utkast" : "Load more drafts"}
            </Button>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
