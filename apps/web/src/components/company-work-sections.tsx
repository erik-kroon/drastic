import { BookOpen, FileText, ReceiptText, Landmark, CalendarClock, ArrowRight } from "lucide-react";
import type * as Workspace from "@open-erp/contracts/workspace";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  PageAction,
  PageCaption,
  PageEmpty,
  TaskSection,
  TaskRow,
  TaskBand,
} from "@open-erp/ui/components/accounting-page";
import { RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "./accounting-status";
import { attentionPath, attentionCopy } from "@/lib/attention";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { CompanyWork } from "@/lib/company-work";
import type { Locale } from "@/paraglide/runtime";

export function CompanyPosition({ work }: { work: CompanyWork }) {
  const { bank, sales, locale, to } = work;
  const sv = locale === "sv";
  const accounts = bank.isSuccess ? bank.data.accounts : undefined;
  const balance = accounts?.length
    ? accounts.reduce((total, account) => total + BigInt(account.ledgerBalanceMinor), 0n).toString()
    : null;
  return (
    <RecordSummary>
      <RecordFact label={sv ? "Bokfört på bankkonton" : "Bank accounts · ledger balance"}>
        {balance !== null && bank.isSuccess
          ? money(balance, bank.data.currencyScale, bank.data.currency, locale)
          : "—"}
        <PageCaption>
          {sv ? "Till och med" : "As of"} {date(to, locale)}
        </PageCaption>
      </RecordFact>
      <RecordFact label={sv ? "Obetalda kundfakturor" : "Unpaid customer invoices"}>
        {sales.isSuccess ? sales.data.counts.open : "—"}
        <PageCaption>
          {sv
            ? "Registrerade fakturor med kvarstående belopp"
            : "Registered invoices with an outstanding amount"}
        </PageCaption>
      </RecordFact>
      <RecordFact label={sv ? "Förfallna kundfakturor" : "Overdue customer invoices"}>
        {sales.isSuccess ? sales.data.counts.overdue : "—"}
        <PageCaption>{sales.isSuccess ? date(sales.data.asOf, locale) : "—"}</PageCaption>
      </RecordFact>
    </RecordSummary>
  );
}

export function CompanyAttention({ work }: { work: CompanyWork }) {
  const { locale, bank, sales, base } = work;
  const sv = locale === "sv";
  const bankAccounts = bank.isSuccess
    ? bank.data.accounts.filter((item) => item.unmatchedCount > 0)
    : [];
  const overdue = sales.isSuccess ? sales.data.counts.overdue : 0;
  const clear =
    bank.isSuccess &&
    sales.isSuccess &&
    work.journals.isSuccess &&
    work.expenses.isSuccess &&
    !bankAccounts.length &&
    !overdue &&
    work.journals.data.total === "0" &&
    work.expenses.data.total === "0";
  return (
    <TaskSection
      title={sv ? "Behöver din uppmärksamhet" : "Needs your attention"}
      action={
        <PageAction quiet href={`${base}/work?status=open`}>
          {sv ? "Arbetslista" : "Work queue"}
          <ArrowRight size={12} />
        </PageAction>
      }
    >
      <AccountingStatus
        locale={locale}
        error={null}
        pending={[bank, sales, work.journals, work.expenses].some((query) => query.isPending)}
      />
      <ReadState work={work} query={sales} showPending={false} />
      {overdue > 0 ? (
        <TaskRow
          href={`${base}/sales?status=overdue&sort=due`}
          icon={<CalendarClock size={16} strokeWidth={1.5} />}
          title={sv ? "Följ upp förfallna fakturor" : "Follow up overdue invoices"}
          detail={
            sv
              ? "Öppna fakturan för att se kvarstående belopp och registrerade betalningar."
              : "Open each invoice to review its outstanding amount and recorded payments."
          }
          value={String(overdue)}
        />
      ) : null}
      <ReadState work={work} query={bank} showPending={false} />
      {bankAccounts.map((account) => (
        <TaskRow
          key={account.id}
          href={accountHref(work, account.id)}
          icon={<Landmark size={16} strokeWidth={1.5} />}
          title={account.name}
          detail={
            sv
              ? "Matcha banktransaktioner med bokföringen."
              : "Match bank transactions to your books."
          }
          value={String(account.unmatchedCount)}
        />
      ))}
      <ReviewTasks work={work} kind="expense" />
      <ReviewTasks work={work} kind="journal" />
      {clear ? (
        <PageEmpty
          title={sv ? "Inget väntar på granskning här" : "No reviews waiting here"}
          detail={
            sv
              ? "Periodens övriga kontroller finns under Bokslut."
              : "Other period checks are available in Year-end."
          }
        />
      ) : null}
      {bank.isSuccess && bank.data.accounts.length === 0 ? (
        <TaskRow
          href={`${base}/accounts?view=imports&record=new`}
          icon={<Landmark size={16} strokeWidth={1.5} />}
          title={sv ? "Lägg till ditt bankunderlag" : "Add your bank statements"}
          detail={
            sv
              ? "Importera ett kontoutdrag för att se transaktioner som behöver matchas."
              : "Import a statement to see transactions that need matching."
          }
        />
      ) : null}
    </TaskSection>
  );
}

function ReviewTasks({ work, kind }: { work: CompanyWork; kind: "journal" | "expense" }) {
  const sv = work.locale === "sv";
  const query = kind === "journal" ? work.journals : work.expenses;
  const page = query.isSuccess ? query.data : undefined;
  return (
    <>
      <ReadState work={work} query={query} showPending={false} />
      {page && page.items.length > 0 ? (
        <>
          <TaskBand>
            {kind === "journal"
              ? sv
                ? "Bokföring att granska"
                : "Bookkeeping to review"
              : sv
                ? "Utgifter att granska"
                : "Expenses to review"}
          </TaskBand>
          {page.items.slice(0, 3).map((item) => (
            <AttentionRow key={item.key} work={work} item={item} />
          ))}
          {BigInt(page.total) > 3n ? (
            <Box paddingBlock="sm">
              <PageAction quiet href={`${work.base}/work?status=open&kind=${kind}`}>
                {sv ? "Visa alla" : "View all"} ({page.total})
              </PageAction>
            </Box>
          ) : null}
        </>
      ) : null}
    </>
  );
}
function AttentionRow({
  work,
  item,
}: {
  work: CompanyWork;
  item: typeof Workspace.AttentionItem.Type;
}) {
  const Icon =
    item.kind === "journal" ? BookOpen : item.kind === "expense" ? ReceiptText : FileText;
  return (
    <TaskRow
      href={attentionPath(work.book, item)}
      icon={<Icon size={16} strokeWidth={1.5} />}
      title={item.title}
      detail={`${attentionCopy(work.locale)[item.reason]} · ${date(item.updatedAt, work.locale)}`}
      value={
        item.amountMinor !== null && item.currencyScale !== null
          ? money(item.amountMinor, item.currencyScale, item.currency ?? "", work.locale)
          : "—"
      }
    />
  );
}

export function ResumeInvoices({ work }: { work: CompanyWork }) {
  const sv = work.locale === "sv";
  const page = work.drafts.isSuccess ? work.drafts.data : undefined;
  return (
    <TaskSection
      title={sv ? "Fortsätt arbeta" : "Continue working"}
      action={
        <PageAction quiet href={`${work.base}/sales?status=draft`}>
          {sv ? "Alla utkast" : "All drafts"}
          {page ? ` (${page.total})` : ""}
        </PageAction>
      }
    >
      <ReadState work={work} query={work.drafts} />
      {page?.items.slice(0, 4).map((item) => (
        <AttentionRow key={item.key} work={work} item={item} />
      ))}
      {page?.items.length === 0 ? (
        <PageEmpty
          title={sv ? "Inga påbörjade fakturor" : "No invoice drafts in progress"}
          detail={
            sv
              ? "Dina sparade fakturautkast visas här."
              : "Your saved invoice drafts will appear here."
          }
        />
      ) : null}
      <Box paddingBlock="md">
        <PageAction quiet href={`${work.base}/sales?record=new&kind=draft`}>
          <FileText size={14} strokeWidth={1.5} />
          {sv ? "Skapa faktura" : "Create invoice"}
        </PageAction>
      </Box>
    </TaskSection>
  );
}

export function CompanyBankAccounts({ work }: { work: CompanyWork }) {
  const { bank, locale, base } = work;
  const sv = locale === "sv";
  return (
    <TaskSection
      title={sv ? "Bankkonton" : "Bank accounts"}
      action={
        <PageAction quiet href={`${base}/accounts`}>
          {sv ? "Visa konton" : "View accounts"}
        </PageAction>
      }
    >
      <ReadState work={work} query={bank} />
      {bank.isSuccess ? (
        <>
          {bank.data.accounts.map((account) => (
            <TaskRow
              key={account.id}
              href={accountHref(work, account.id)}
              icon={<Landmark size={16} strokeWidth={1.5} />}
              title={account.name}
              detail={`${account.code} · ${sv ? "Bokfört till" : "Posted through"} ${date(work.to, locale)}`}
              value={money(
                account.ledgerBalanceMinor,
                bank.data.currencyScale,
                bank.data.currency,
                locale,
              )}
            />
          ))}
          {bank.data.accounts.length === 0 ? (
            <PageEmpty
              title={sv ? "Inga bankkonton att visa ännu" : "No bank accounts to show yet"}
              detail={
                sv
                  ? "Importera kontoutdrag för att koppla ett bankkonto till bokföringen."
                  : "Import a statement to link a bank account to your books."
              }
            />
          ) : (
            <PageCaption>
              {sv
                ? "Bokförda saldon. Bankens saldo och kontoutdragets datum visas inne på kontot."
                : "Ledger balances. Open an account for the statement balance and its date."}
            </PageCaption>
          )}
        </>
      ) : null}
    </TaskSection>
  );
}

export function CompanyOpenInvoices({ work }: { work: CompanyWork }) {
  const { sales, locale, base } = work;
  const sv = locale === "sv";
  return (
    <TaskSection
      title={sv ? "Kundfakturor att följa upp" : "Customer invoices to follow up"}
      action={
        <PageAction quiet href={`${base}/sales?status=open&sort=due`}>
          {sv ? "Alla obetalda" : "All unpaid"}
        </PageAction>
      }
    >
      <ReadState work={work} query={sales} />
      {sales.isSuccess && sales.data.items.length > 0 ? (
        <DataTable
          title={sv ? "Obetalda kundfakturor" : "Unpaid customer invoices"}
          columns={[
            { id: "customer", label: sv ? "Kund / faktura" : "Customer / invoice" },
            { id: "due", label: sv ? "Förfallodag" : "Due date" },
            { id: "amount", label: sv ? "Kvar att betala" : "Outstanding", numeric: true },
            { id: "action", label: "" },
          ]}
          rows={sales.data.items.slice(0, 5).map((item) => ({
            id: item.id,
            cells: [
              <Box key="customer">
                <strong>{item.customer}</strong>
                <PageCaption>{item.number}</PageCaption>
              </Box>,
              <Box key="due">
                {item.dueOn ? date(item.dueOn, locale) : "—"}
                {item.overdue ? (
                  <Box>
                    <Badge variant="warning">{sv ? "Förfallen" : "Overdue"}</Badge>
                  </Box>
                ) : null}
              </Box>,
              item.outstandingMinor === null
                ? "—"
                : money(item.outstandingMinor, item.currencyScale, item.currency, locale),
              <PageAction
                quiet
                key="open"
                href={`${base}/sales?status=open&sort=due&kind=invoice&record=${encodeURIComponent(item.id)}`}
              >
                {sv ? "Öppna" : "Open"}
                <ArrowRight size={14} />
              </PageAction>,
            ],
          }))}
        />
      ) : null}
      {sales.isSuccess && sales.data.items.length === 0 ? (
        <PageEmpty
          title={sv ? "Inga obetalda fakturor" : "No unpaid invoices"}
          detail={
            sv
              ? "Registrerade kundfakturor med kvarstående belopp visas här."
              : "Registered customer invoices with outstanding amounts appear here."
          }
        />
      ) : null}
    </TaskSection>
  );
}

type QueryState = {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<unknown>;
};
function ReadState({
  work,
  query,
  showPending = true,
}: {
  work: CompanyWork;
  query: QueryState;
  showPending?: boolean;
}) {
  return (
    <>
      <AccountingStatus
        locale={work.locale}
        pending={showPending && query.isPending}
        error={query.error}
      />
      {query.isError ? (
        <Box>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {work.locale === "sv" ? "Försök igen" : "Try again"}
          </Button>
        </Box>
      ) : null}
    </>
  );
}
function money(value: string, scale: number, currency: string, locale: Locale) {
  return `${formatMinorAmount(value, scale, locale)} ${currency}`;
}
function date(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(value),
  );
}
function accountHref(work: CompanyWork, id: string) {
  return `${work.base}/accounts?account=${encodeURIComponent(id)}&from=${work.from}&to=${work.to}`;
}
