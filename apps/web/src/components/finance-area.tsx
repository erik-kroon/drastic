import { lazy, Suspense } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { AccountBalances } from "@/components/account-register";
import { useBookWorkspace, workspacePath, reviewPath } from "@/lib/book-context";
import { frontendCopy } from "@/lib/frontend-copy";

const BankReconciliation = lazy(() =>
  import("@/components/bank-reconciliation").then((module) => ({
    default: module.BankReconciliation,
  })),
);
const Invoices = lazy(() =>
  import("@/components/commerce/invoices").then((module) => ({ default: module.Invoices })),
);
const Counterparties = lazy(() =>
  import("@/components/commerce/counterparties").then((module) => ({
    default: module.Counterparties,
  })),
);
const SourceIntake = lazy(() =>
  import("@/components/source-intake").then((module) => ({ default: module.SourceIntake })),
);
const InternalReports = lazy(() =>
  import("@/components/internal-reports").then((module) => ({ default: module.InternalReports })),
);
const ClosingPanel = lazy(() =>
  import("@/components/closing/panel").then((module) => ({ default: module.ClosingPanel })),
);
const ExpenseTaxPanel = lazy(() =>
  import("@/components/expense-tax/panel").then((module) => ({ default: module.ExpenseTaxPanel })),
);

export function FinanceArea({
  area,
  view,
}: {
  area: "accounts" | "sales" | "purchases" | "reports" | "tax" | "closing";
  view?: string;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const navigate = useNavigate();
  const copy = frontendCopy(locale);
  const tabs = {
    accounts: [
      { key: "ledger", label: copy.ledger },
      { key: "bank", label: copy.bank },
      { key: "imports", label: copy.imports },
    ],
    sales: [
      { key: "invoices", label: copy.invoices },
      { key: "parties", label: copy.parties },
    ],
    purchases: [{ key: "expenses", label: copy.expenses }],
    reports: [
      { key: "ledger", label: copy.ledger },
      { key: "snapshot", label: copy.snapshot },
    ],
    tax: [{ key: "tax", label: copy.tax }],
    closing: [{ key: "closing", label: copy.closing }],
  }[area];
  const selected = tabs.find((tab) => tab.key === view)?.key ?? tabs[0]?.key;
  const onPrepared = (id: string) => {
    void navigate({ to: reviewPath(book, id) });
  };
  return (
    <>
      <WorkspaceHeader title={copy[area]} />
      <PageContent>
        {tabs.length > 1 ? (
          <PageTabs label={copy[area]}>
            {tabs.map((tab) => (
              <PageTab
                key={tab.key}
                href={`${workspacePath(book)}/${area}?view=${tab.key}`}
                active={selected === tab.key}
              >
                {tab.label}
              </PageTab>
            ))}
          </PageTabs>
        ) : null}
        <Suspense fallback={<AccountingStatus locale={locale} pending error={null} />}>
          {selected === "ledger" ? <AccountBalances /> : null}
          {selected === "bank" ? (
            <BankReconciliation book={book} setup={setup} locale={locale} open />
          ) : null}
          {selected === "invoices" ? <Invoices book={book} locale={locale} /> : null}
          {selected === "parties" ? <Counterparties book={book} locale={locale} /> : null}
          {selected === "imports" ? (
            <SourceIntake book={book} setup={setup} locale={locale} open />
          ) : null}
          {selected === "expenses" ? (
            <ExpenseTaxPanel book={book} locale={locale} onPrepared={onPrepared} open />
          ) : null}
          {selected === "snapshot" ? <InternalReports book={book} locale={locale} open /> : null}
          {selected === "tax" ? (
            <ExpenseTaxPanel book={book} locale={locale} onPrepared={onPrepared} open />
          ) : null}
          {selected === "closing" ? (
            <ClosingPanel book={book} setup={setup} locale={locale} open />
          ) : null}
        </Suspense>
      </PageContent>
    </>
  );
}
