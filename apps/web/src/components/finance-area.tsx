import { lazy, Suspense } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageAction, PageContent } from "@open-erp/ui/components/accounting-page";
import { ArrowLeft } from "lucide-react";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { AccountBalances } from "@/components/account-register";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { frontendCopy } from "@/lib/frontend-copy";

const DocumentInbox = lazy(() =>
  import("@/components/document-inbox").then((module) => ({ default: module.DocumentInbox })),
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
const SubledgersPanel = lazy(() =>
  import("@/components/subledgers/schedules").then((module) => ({
    default: module.SubledgersPanel,
  })),
);
const ExchangeRateReviewsPanel = lazy(() =>
  import("@/components/exchange-rates/panel").then((module) => ({
    default: module.ExchangeRateReviewsPanel,
  })),
);
const SubledgerControlsPanel = lazy(() =>
  import("@/components/subledger-controls/panel").then((module) => ({
    default: module.SubledgerControlsPanel,
  })),
);

export function FinanceArea({
  area,
  view,
  record,
  account,
}: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  view?: string;
  record?: string;
  account?: string;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();
  const copy = frontendCopy(locale);
  const tabs = areaTabs(area, locale);
  const invoiceDirection = area === "purchases" ? "supplier" : "customer";
  const selected = tabs.find((tab) => tab.key === view)?.key ?? tabs[0]?.key;
  const recordId = record ?? "";
  const base = `${workspacePath(book)}/${area}`;
  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id) });
  };
  const onOpen = (id: string) => {
    void navigate({ to: base, search: { view: selected, record: id || undefined } });
  };
  return (
    <>
      <WorkspaceHeader title={copy[area]} action={area === "reports" && selected !== "library" ? <PageAction quiet href={base}><ArrowLeft size={14} />{locale === "sv" ? "Alla rapporter" : "All reports"}</PageAction> : undefined} />
      <PageContent>
        <FinanceNavigation area={area} selected={selected} base={base} locale={locale} />
        <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
          {selected === "documents" ? <DocumentInbox recordId={record} onOpen={onOpen} /> : null}
          {selected === "ledger" ? <AccountBalances /> : null}
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
          {selected === "subledgers" ? (
            <>
              <SubledgersPanel
                key={`schedules:${book.entityId}:${book.id}`}
                open
                book={book}
                setup={setup}
                locale={locale}
                onPrepared={onPrepared}
              />
              <SubledgerControlsPanel
                key={`controls:${book.entityId}:${book.id}`}
                book={book}
                setup={setup}
                locale={locale}
              />
            </>
          ) : null}
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
          {selected === "trial" ? (
            <TrialBalanceWorkspace recordId={record} onOpen={onOpen} accountId={account} onSelectAccount={(id) => void navigate({ to: base, search: { view: selected, record, account: id || undefined }, resetScroll: false })} />
          ) : null}
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
          {selected === "closing" ? <ClosingWorkspace recordId={record} onOpen={onOpen} /> : null}
        </Suspense>
      </PageContent>
    </>
  );
}

function FinanceNavigation(props: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  selected: string | undefined;
  base: string;
  locale: "en" | "sv";
}) {
  if (props.area === "reports")
    return null;
  const tabs = areaTabs(props.area, props.locale);
  if (tabs.length < 2) return null;
  return (
    <PageTabs label={frontendCopy(props.locale)[props.area]}>
      {tabs.map((tab) => (
        <PageTab
          key={tab.key}
          href={`${props.base}?view=${tab.key}`}
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
      { key: "documents", label: sv ? "Dokument" : "Documents" },
      { key: "invoices", label: sv ? "Leverantörsfakturor" : "Supplier invoices" },
      { key: "expenses", label: copy.expenses },
      { key: "parties", label: copy.parties },
    ],
    reports: [
      { key: "library", label: sv ? "Alla rapporter" : "All reports" },
      { key: "trial", label: sv ? "Saldobalans" : "Trial balance" },
      { key: "ledger", label: copy.ledger },
      { key: "register", label: sv ? "Fakturaregister" : "Invoice register" },
      { key: "subledgers", label: sv ? "Tillgångskontroller" : "Asset controls" },
      { key: "exchange-rates", label: sv ? "Valutakurser" : "Exchange rates" },
      { key: "export", label: sv ? "Granskningspaket" : "Review pack" },
    ],
    tax: [
      { key: "vat", label: sv ? "Momsdeklarationer" : "VAT returns" },
      { key: "expenses", label: sv ? "Momsgranskning" : "Expense tax review" },
    ],
    closing: [{ key: "closing", label: copy.closing }],
  }[area];
}
