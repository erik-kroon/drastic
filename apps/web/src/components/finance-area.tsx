import { lazy, Suspense, type ComponentProps } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { Box } from "@open-erp/ui/components/box";
import { PageAction, PageContent } from "@open-erp/ui/components/accounting-page";
import { ArrowLeft } from "lucide-react";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import {
  decodeWorkReturn,
  workReturnHref,
  type WorkReturn,
  type DocumentQuery,
  type BankOwnerQuery,
  useOwnerReturn,
} from "@/lib/work-return";
import { WorkReturnAction } from "@/components/work-return-action";
import { frontendCopy } from "@/lib/frontend-copy";

const DocumentInbox = lazy(() =>
  import("@/components/document-inbox").then((module) => ({ default: module.DocumentInbox })),
);

const PurchaseRegister = lazy(() =>
  import("@/components/commerce/purchase-register").then((module) => ({
    default: module.PurchaseRegister,
  })),
);

const BankingWorkspace = lazy(() =>
  import("@/components/banking-workspace").then((module) => ({ default: module.BankingWorkspace })),
);

const PaymentAllocations = lazy(() =>
  import("@/components/commerce/allocations").then((module) => ({ default: module.Allocations })),
);

const CommerceAllocationReversals = lazy(() =>
  import("@/components/commerce/allocation-reversals").then((module) => ({
    default: module.CommerceAllocationReversals,
  })),
);

const Invoices = lazy(() =>
  import("@/components/commerce/invoices").then((module) => ({ default: module.Invoices })),
);

const SupplierInvoiceDrafts = lazy(() =>
  import("@/components/commerce/supplier-invoice-drafts").then((module) => ({
    default: module.SupplierInvoiceDrafts,
  })),
);

const SupplierPaymentFiles = lazy(() =>
  import("@/components/commerce/supplier-payment-files").then((module) => ({
    default: module.SupplierPaymentFiles,
  })),
);

const InvoiceDrafts = lazy(() =>
  import("@/components/commerce/invoice-draft-issue-overlay").then((module) => ({
    default: module.InvoiceDraftIssueOverlay,
  })),
);

const Counterparties = lazy(() =>
  import("@/components/commerce/counterparties").then((module) => ({
    default: module.Counterparties,
  })),
);

const StatementImports = lazy(() =>
  import("@/components/statement-imports").then((module) => ({ default: module.StatementImports })),
);

const ReportLibrary = lazy(() =>
  import("@/components/report-workspace").then((module) => ({ default: module.ReportLibrary })),
);

const TrialBalanceWorkspace = lazy(() =>
  import("@/components/report-workspace").then((module) => ({
    default: module.TrialBalanceWorkspace,
  })),
);

const ReportFamilyWorkspace = lazy(() =>
  import("@/components/report-workspace").then((module) => ({
    default: module.ReportFamilyWorkspace,
  })),
);

const RegisterReports = lazy(() =>
  import("@/components/commerce/register-reports").then((module) => ({
    default: module.RegisterReports,
  })),
);

const AccountantReviewPanel = lazy(() =>
  import("@/components/accountant-review/panel").then((module) => ({
    default: module.AccountantReviewPanel,
  })),
);

const ClosingWorkspace = lazy(() =>
  import("@/components/closing/workspace").then((module) => ({ default: module.ClosingWorkspace })),
);

const ExpenseTaxPanel = lazy(() =>
  import("@/components/expense-tax/panel").then((module) => ({ default: module.ExpenseTaxPanel })),
);

const VatReturnsPanel = lazy(() =>
  import("@/components/vat-returns/panel").then((module) => ({ default: module.VatReturnsPanel })),
);

const ActualVatReturnsPanel = lazy(() =>
  import("@/components/vat-returns/actual-panel").then((module) => ({
    default: module.ActualVatReturnsPanel,
  })),
);

const VatControlReclassificationPanel = lazy(() =>
  import("@/components/vat-returns/reclassification-panel").then((module) => ({
    default: module.VatControlReclassificationPanel,
  })),
);

const BankSourceCoveragePanel = lazy(() =>
  import("@/components/bank-source-coverage/panel").then((module) => ({
    default: module.BankSourceCoveragePanel,
  })),
);

const BankMatchingWorkspace = lazy(() =>
  import("@/components/bank-match-candidates/workspace").then((module) => ({
    default: module.BankMatchingWorkspace,
  })),
);

const InvoiceIssuance = lazy(() =>
  import("@/components/commerce/invoice-issuance").then((module) => ({
    default: module.InvoiceIssuance,
  })),
);

const AssetWorkspace = lazy(() =>
  import("@/components/subledgers/workspace").then((module) => ({
    default: module.AssetWorkspace,
  })),
);

const ExchangeRateReviewsPanel = lazy(() =>
  import("@/components/exchange-rates/panel").then((module) => ({
    default: module.ExchangeRateReviewsPanel,
  })),
);

const workReturnAreas = new Set(["sales", "purchases", "tax"]);

const trialBalanceModes = new Set(["trial", "ledger"]);

function isTrialBalanceMode(value: string | undefined): value is "trial" | "ledger" {
  return value !== undefined && trialBalanceModes.has(value);
}

export function FinanceArea(props: ComponentProps<typeof OwnedFinanceArea>) {
  const { locale } = useBookWorkspace();

  if (props.area === "purchases" && props.view === "documents") {
    return <DocumentArea {...props} />;
  }

  if (
    props.area === "purchases" &&
    (props.view === undefined || props.view === "register") &&
    !props.record &&
    !props.occurrence
  ) {
    return (
      <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
        <PurchaseRegister workSearch={props.work} />
      </Suspense>
    );
  }

  return <OwnedFinanceArea {...props} />;
}

function DocumentArea(props: ComponentProps<typeof OwnedFinanceArea>) {
  const { book, locale } = useBookWorkspace();
  const navigate = useNavigate();
  const base = `${workspacePath(book)}/purchases`;

  const search = {
    ...props.archive,
    view: "documents",
    work: props.work,
    returnTo: props.returnTo,
  };

  return (
    <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
      <DocumentInbox
        standalone
        recordId={props.record}
        filters={props.archive ?? {}}
        onOpen={(id) =>
          void navigate({
            to: base,
            search: { ...search, record: id || undefined },
            resetScroll: false,
          })
        }
        onFilters={(filters) =>
          void navigate({
            to: base,
            search: { ...search, ...filters, record: undefined },
            resetScroll: false,
          })
        }
      />
    </Suspense>
  );
}

function OwnedFinanceArea(props: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  view?: string;
  record?: string;
  account?: string;
  work?: string;
  archive?: typeof DocumentQuery.Type;
  bankSearch?: typeof BankOwnerQuery.Type;
  returnTo?: string;
  occurrence?: string;
}) {
  const { area, view, record, account } = props;
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();
  const copy = frontendCopy(locale);
  const tabs = areaTabs(area, locale);
  const invoiceDirection = area === "purchases" ? "supplier" : "customer";
  const selected = tabs.find((tab) => tab.key === view)?.key ?? tabs[0]?.key;
  const recordId = record ?? "";
  const base = `${workspacePath(book)}/${area}`;
  const work = workReturnAreas.has(area) ? decodeWorkReturn(props.work) : undefined;

  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id), search: { ...work, returnTo: props.returnTo } });
  };

  const navigateArea = (search: { record?: string; occurrence?: string }) => {
    void navigate({
      to: base,
      search: {
        ...props.archive,
        ...props.bankSearch,
        draftRevision: undefined,
        expenseRevision: undefined,
        expenseReviewId: undefined,
        view: selected,
        work: props.work,
        returnTo: props.returnTo,
        ...search,
      },
      resetScroll: false,
    });
  };

  const onOpen = (id: string) =>
    navigateArea({ record: id || undefined, occurrence: props.occurrence });

  const onOpenOccurrence = (id: string) =>
    navigateArea({ record: record || undefined, occurrence: id || undefined });

  return (
    <>
      <WorkspaceHeader
        title={copy[area]}
        action={
          <AreaActions area={area} base={base} selected={selected} locale={locale} work={work} />
        }
      />
      <PageContent>
        <FinanceNavigation
          area={area}
          selected={selected}
          base={base}
          locale={locale}
          work={work}
        />
        <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
          {selected === "bank" ? <BankingWorkspace recordId={record} onOpen={onOpen} /> : null}
          {selected === "coverage" ? (
            <BankSourceCoveragePanel
              key={`${book.entityId}:${book.id}`}
              book={book}
              locale={locale}
            />
          ) : null}
          {selected === "matching" ? (
            <BankMatchingWorkspace
              key={`${book.entityId}:${book.id}`}
              book={book}
              setup={setup}
              locale={locale}
            />
          ) : null}
          {selected === "payments" ? (
            <>
              <PaymentAllocations
                key={`payments:${book.entityId}:${book.id}`}
                book={book}
                locale={locale}
              />
              <CommerceAllocationReversals book={book} locale={locale} receiptId={record} />
            </>
          ) : null}
          {selected === "issue" ? (
            <InvoiceIssuance book={book} locale={locale} recordId={record} />
          ) : null}
          {selected === "exchange-rates" ? (
            <ExchangeRateReviewsPanel book={book} locale={locale} />
          ) : null}
          {selected === "subledgers" ? <AssetWorkspace recordId={record} onOpen={onOpen} /> : null}
          {selected === "supplier-drafts" ? (
            <SupplierInvoiceDrafts
              book={book}
              locale={locale}
              recordId={recordId}
              occurrenceId={props.occurrence}
              onOpen={onOpen}
              onOpenOccurrence={onOpenOccurrence}
            />
          ) : null}
          <SupplierPaymentFileArea
            selected={selected}
            book={book}
            locale={locale}
            recordId={recordId}
          />
          {selected === "drafts" ? (
            <InvoiceDrafts book={book} locale={locale} recordId={recordId} onOpen={onOpen} />
          ) : null}
          {selected === "invoices" ? (
            <Invoices
              book={book}
              locale={locale}
              direction={invoiceDirection}
              recordId={recordId}
              onOpen={onOpen}
            />
          ) : null}
          {selected === "parties" ? (
            <Counterparties
              defaultRole={invoiceDirection}
              book={book}
              locale={locale}
              recordId={recordId}
              onOpen={onOpen}
            />
          ) : null}
          {selected === "imports" ? <StatementImports recordId={record} onOpen={onOpen} /> : null}
          {selected === "expenses" ? (
            <ExpenseTaxPanel
              book={book}
              locale={locale}
              onPrepared={onPrepared}
              recordId={recordId}
              onOpen={onOpen}
              open
            />
          ) : null}
          {selected === "library" ? <ReportLibrary /> : null}
          {isTrialBalanceMode(selected) ? (
            <TrialBalanceWorkspace
              mode={selected}
              recordId={record}
              onOpen={onOpen}
              accountId={account}
              onSelectAccount={(id) =>
                void navigate({
                  to: base,
                  search: { view: selected, record, account: id || undefined },
                  resetScroll: false,
                })
              }
            />
          ) : null}
          <ReportFamilyArea
            selected={selected}
            book={book}
            locale={locale}
            recordId={recordId}
            onOpen={onOpen}
          />
          {selected === "register" ? (
            <RegisterReports book={book} locale={locale} recordId={recordId} onOpen={onOpen} />
          ) : null}
          {selected === "export" ? (
            <AccountantReviewPanel
              book={book}
              locale={locale}
              recordId={recordId}
              onOpen={onOpen}
              open
            />
          ) : null}
          {selected === "vat" ? (
            <VatReturnsPanel book={book} locale={locale} recordId={recordId} onOpen={onOpen} open />
          ) : null}
          {selected === "actual-vat" ? (
            <ActualVatReturnsPanel recordId={recordId} onOpen={onOpen} />
          ) : null}
          {selected === "reclassify" ? (
            <VatControlReclassificationPanel
              book={book}
              locale={locale}
              recordId={recordId}
              onOpen={onOpen}
            />
          ) : null}
          {selected === "closing" ? <ClosingWorkspace recordId={record} onOpen={onOpen} /> : null}
        </Suspense>
      </PageContent>
    </>
  );
}

function ReportFamilyArea(props: {
  selected: string | undefined;
  book: ReturnType<typeof useBookWorkspace>["book"];
  locale: ReturnType<typeof useBookWorkspace>["locale"];
  recordId: string;
  onOpen: (id: string) => void;
}) {
  if (
    props.selected !== "profit_and_loss" &&
    props.selected !== "balance_sheet" &&
    props.selected !== "cash_flow"
  ) {
    return null;
  }

  return (
    <ReportFamilyWorkspace
      family={props.selected}
      recordId={props.recordId}
      onOpen={props.onOpen}
    />
  );
}

function SupplierPaymentFileArea(
  props: ComponentProps<typeof SupplierPaymentFiles> & { selected?: string },
) {
  if (props.selected !== "supplier-payment-files") return null;

  return <SupplierPaymentFiles book={props.book} locale={props.locale} recordId={props.recordId} />;
}

function AreaActions(props: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  base: string;
  selected: string | undefined;
  locale: "en" | "sv";
  work: WorkReturn | undefined;
}) {
  const reportsRoot = props.area === "reports" && props.selected !== "library";
  const owner = useOwnerReturn();

  if (!reportsRoot && !props.work && !owner) return null;

  return (
    <Box display="flex" alignItems="center" gap="lg" flexWrap="wrap">
      {reportsRoot ? (
        <PageAction quiet href={props.base}>
          <ArrowLeft size={14} />
          {props.locale === "sv" ? "Alla rapporter" : "All reports"}
        </PageAction>
      ) : null}
      <WorkReturnAction work={props.work} />
    </Box>
  );
}

function FinanceNavigation(props: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  selected: string | undefined;
  base: string;
  locale: "en" | "sv";
  work: WorkReturn | undefined;
}) {
  const owner = useOwnerReturn();

  if (props.area === "reports") return null;
  const tabs = areaTabs(props.area, props.locale);

  if (tabs.length < 2) return null;

  return (
    <PageTabs label={frontendCopy(props.locale)[props.area]}>
      {tabs.map((tab) => (
        <PageTab
          key={tab.key}
          href={workReturnHref(props.base, tab.key, props.work, owner)}
          active={props.selected === tab.key}
        >
          {tab.label}
        </PageTab>
      ))}
    </PageTabs>
  );
}

function areaTabs(
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing",
  locale: "en" | "sv",
) {
  const copy = frontendCopy(locale);
  const sv = locale === "sv";

  return {
    accounts: [
      { key: "bank", label: copy.bank },
      { key: "matching", label: sv ? "Matchning" : "Matching" },
      { key: "coverage", label: sv ? "Kontoutdragstäckning" : "Statement coverage" },
      { key: "payments", label: sv ? "Betalningsfördelning" : "Payment allocation" },
      { key: "imports", label: copy.imports },
      { key: "ledger", label: copy.ledger },
    ],
    sales: [
      { key: "drafts", label: copy.drafts },
      { key: "issue", label: sv ? "Syntetisk utställning" : "Synthetic issue" },
      { key: "invoices", label: copy.invoices },
      { key: "parties", label: copy.parties },
    ],
    purchases: [
      { key: "supplier-drafts", label: sv ? "Fakturautkast" : "Invoice drafts" },
      { key: "invoices", label: sv ? "Registrerade" : "Registered" },
      { key: "supplier-payment-files", label: sv ? "Betalningsfiler" : "Payment files" },
      { key: "documents", label: sv ? "Dokument" : "Documents" },
      { key: "expenses", label: copy.expenses },
      { key: "parties", label: copy.parties },
    ],
    reports: [
      { key: "library", label: sv ? "Alla rapporter" : "All reports" },
      { key: "trial", label: sv ? "Saldobalans" : "Trial balance" },
      { key: "ledger", label: copy.ledger },
      { key: "profit_and_loss", label: sv ? "Resultaträkning" : "Profit and loss" },
      { key: "balance_sheet", label: sv ? "Balansräkning" : "Balance sheet" },
      { key: "cash_flow", label: sv ? "Kassaflöde" : "Cash flow" },
      { key: "register", label: sv ? "Fakturaregister" : "Invoice register" },
      { key: "subledgers", label: sv ? "Tillgångskontroller" : "Asset controls" },
      { key: "exchange-rates", label: sv ? "Valutakurser" : "Exchange rates" },
      { key: "export", label: sv ? "Granskningspaket" : "Review pack" },
    ],
    tax: [
      { key: "actual-vat", label: sv ? "Periodens moms" : "Period VAT" },
      { key: "vat", label: sv ? "Momsdeklarationer" : "VAT returns" },
      { key: "reclassify", label: sv ? "Momsomklassning" : "VAT reclassification" },
      { key: "expenses", label: sv ? "Momsgranskning" : "Expense tax review" },
    ],
    closing: [{ key: "closing", label: copy.closing }],
  }[area];
}
