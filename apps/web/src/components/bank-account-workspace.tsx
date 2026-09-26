import { useRef, useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, defaultStringifySearch } from "@tanstack/react-router";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/bank-workspace";
import * as Reconciliation from "@open-erp/contracts/reconciliation";
import { ArrowLeft, ArrowRight, Upload, Landmark } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import {
  PageContent,
  PageAction,
  PageCaption,
  PageEmpty,
  RegisterFilters,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { PageTabs, PageTab } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { StatementImports, statementImportsOptions } from "@/components/statement-imports";
import { BankTransactionMatch } from "@/components/bank-transaction-match";
import { BankReport } from "@/components/bank-report";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { checkScope } from "@/components/commerce/shared";

export type BankSearch = {
  account?: string;
  from?: string;
  to?: string;
  view?: string;
  record?: string;
  tab?: "unmatched" | "all" | "matched" | "ledger";
  q?: string;
  page?: string;
  statement?: string;
  row?: string;
  plan?: string;
  undo?: string;
  report?: string;
};

export function bankWorkspaceOptions(book: typeof Accounting.Book.Type, query: URLSearchParams) {
  return queryOptions({
    queryKey: [...bookKey(book), "bank-workspace", query.toString()],
    queryFn: async ({ signal }) => {
      const data = await readAccounting(
        `${bookPath(book)}/bank-workspace?${query}`,
        Bank.BankWorkspace,
        { signal },
      );

      checkScope(book, data.scope);

      return data;
    },
    retry: false,
  });
}

export function bankWorkspaceParams(setup: typeof Accounting.BookSetup.Type, search: BankSearch) {
  const period = setup.periods.at(-1);
  const from = search.from ?? period?.startsOn ?? new Date().toISOString().slice(0, 10);
  const to = search.to ?? period?.endsOn ?? from;

  const query = new URLSearchParams({
    startsOn: from,
    endsOn: to,
    view: search.tab ?? "unmatched",
    page: search.page ?? "1",
    q: search.q ?? "",
  });

  if (search.account) query.set("accountId", search.account);

  return query;
}

export function BankAccountWorkspace({ search }: { search: BankSearch }) {
  const { book, setup, locale } = useBookWorkspace();
  const client = useQueryClient();
  const navigate = useNavigate();
  const sv = locale === "sv";
  const period = setup.periods.at(-1);
  const from = search.from ?? period?.startsOn ?? new Date().toISOString().slice(0, 10);
  const to = search.to ?? period?.endsOn ?? from;
  const base = `${workspacePath(book)}/accounts`;

  const change = (next: BankSearch) =>
    void navigate({ to: base, search: next, resetScroll: false });

  const href = (next: BankSearch) => `${base}${defaultStringifySearch(next)}`;
  const query = bankWorkspaceParams(setup, search);

  const workspace = useQuery({
    ...bankWorkspaceOptions(book, query),
    enabled: search.view !== "imports",
  });

  const preloadBank = () => {
    if (search.view === "imports") void client.prefetchQuery(bankWorkspaceOptions(book, query));
  };

  const preloadStatements = () => {
    if (search.view !== "imports") void client.prefetchInfiniteQuery(statementImportsOptions(book));
  };

  const data = workspace.isSuccess ? workspace.data : undefined;
  const account = data?.accounts.find((item) => item.id === search.account);

  const money = (value: string | null) =>
    value === null || !data
      ? "—"
      : `${formatMinorAmount(value, data.currencyScale, locale)} ${data.currency}`;

  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
      new Date(value),
    );

  const clearRecord = {
    ...search,
    statement: undefined,
    row: undefined,
    plan: undefined,
    undo: undefined,
    report: undefined,
  };

  return (
    <>
      <WorkspaceHeader
        title={sv ? "Konton" : "Accounts"}
        action={
          <PageAction href={href({ ...clearRecord, view: "imports", record: "new" })}>
            <Upload size={14} />
            {sv ? "Importera kontoutdrag" : "Import statement"}
          </PageAction>
        }
      />
      <PageContent>
        <PageTabs label={sv ? "Konton" : "Accounts"}>
          <PageTab
            active={search.view !== "imports"}
            href={href({ ...clearRecord, view: undefined, record: undefined })}
            onPointerEnter={preloadBank}
            onFocus={preloadBank}
          >
            {sv ? "Bankkonton" : "Bank accounts"}
          </PageTab>
          <PageTab
            active={search.view === "imports"}
            href={href({ ...clearRecord, view: "imports", record: undefined })}
            onPointerEnter={preloadStatements}
            onFocus={preloadStatements}
          >
            {sv ? "Kontoutdrag" : "Statements"}
          </PageTab>
        </PageTabs>
        {search.view === "imports" ? (
          <>
            {search.account ? (
              <Box>
                <PageAction
                  quiet
                  href={href({ ...clearRecord, view: undefined, record: undefined })}
                >
                  <ArrowLeft size={14} />
                  {sv ? "Tillbaka till kontot" : "Back to account"}
                </PageAction>
              </Box>
            ) : null}
            <StatementImports
              recordId={search.record}
              onOpen={(record) => change({ ...clearRecord, record: record || undefined })}
            />
          </>
        ) : (
          <>
            <BankScopeToolbar
              sv={sv}
              from={from}
              to={to}
              currency={book.currency}
              account={account}
              selected={!!search.account}
              href={href}
              fetching={workspace.isFetching}
              refresh={() => void workspace.refetch()}
              onPeriod={(from, to) => change({ ...clearRecord, from, to, page: undefined })}
            />
            <AccountingStatus
              locale={locale}
              pending={workspace.isPending}
              error={workspace.error}
            />
            {data && !search.account ? (
              <BankAccountList
                data={data}
                sv={sv}
                href={href}
                from={from}
                to={to}
                money={money}
                date={date}
              />
            ) : null}
            {data && account ? (
              <AccountActivity
                data={data}
                account={account}
                search={search}
                sv={sv}
                to={to}
                href={href}
                change={change}
                money={money}
                date={date}
                bookBase={workspacePath(book)}
              />
            ) : null}
            {account ? (
              <AccountReport
                key={`${account.id}:${from}:${to}`}
                book={book}
                locale={locale}
                account={account}
                from={from}
                to={to}
                reportId={search.report}
                onReport={(report) => change({ ...clearRecord, report })}
              />
            ) : null}
            <BankAdditionalTools sv={sv} base={base} />
          </>
        )}
        {(search.statement && search.row) || search.plan ? (
          <RecordSheet
            title={sv ? "Matcha transaktion" : "Match transaction"}
            closeLabel={sv ? "Stäng matchning" : "Close matching"}
            onClose={() => change(clearRecord)}
          >
            <BankTransactionMatch
              book={book}
              locale={locale}
              statementId={search.statement}
              rowOrdinal={Number(search.row)}
              planId={search.plan}
              reversalId={search.undo}
              accountId={search.account}
              onPlan={(plan) => change({ ...search, plan })}
              onReversal={(undo) => change({ ...search, undo })}
            />
          </RecordSheet>
        ) : null}
      </PageContent>
    </>
  );
}

type BankPresentation = {
  data: typeof Bank.BankWorkspace.Type;
  sv: boolean;
  href: (search: BankSearch) => string;
  money: (value: string | null) => string;
  date: (value: string) => string;
};

function BankAccountList(props: BankPresentation & { from: string; to: string }) {
  const { data, sv, href, money } = props;
  const { from, to, date } = props;

  return (
    <>
      {data.accounts.length ? (
        <DataTable
          title={sv ? "Bankkonton" : "Bank accounts"}
          columns={[
            { id: "account", label: sv ? "Konto" : "Account" },
            { id: "source", label: sv ? "Senaste kontoutdrag" : "Latest statement" },
            { id: "work", label: sv ? "Att matcha" : "To match" },
            {
              id: "balance",
              label: sv ? "Bokfört saldo" : "Ledger balance",
              numeric: true,
            },
            { id: "difference", label: sv ? "Differens" : "Difference", numeric: true },
            { id: "action", label: "" },
          ]}
          rows={data.accounts.map((item) => ({
            id: item.id,
            cells: [
              <Box key="name" display="flex" gap="md" alignItems="center">
                <Landmark size={18} strokeWidth={1.5} />
                <Box>
                  <Link href={href({ from, to, account: item.id })}>{item.name}</Link>
                  <PageCaption>
                    {item.code} · {data.currency}
                  </PageCaption>
                </Box>
              </Box>,
              item.statementDate ? date(item.statementDate) : "—",
              <Badge key="work" variant={item.unmatchedCount ? "warning" : "secondary"}>
                {item.unmatchedCount} {sv ? "transaktioner" : "transactions"}
              </Badge>,
              money(item.ledgerBalanceMinor),
              money(item.differenceMinor),
              <PageAction key="open" quiet href={href({ from, to, account: item.id })}>
                {sv ? "Stäm av" : "Reconcile"}
                <ArrowRight size={14} />
              </PageAction>,
            ],
          }))}
        />
      ) : (
        <PageEmpty
          title={sv ? "Lägg till ditt första bankkonto" : "Add your first bank account"}
          detail={
            sv
              ? "Importera ett kontoutdrag och välj vilket bokföringskonto det hör till."
              : "Import a statement and choose its ledger account."
          }
        />
      )}
      <PageCaption>
        {sv
          ? "Saldon kommer från importerade kontoutdrag och bokföringen. Differens visas när kontoutdraget täcker periodens slut."
          : "Balances come from imported statements and the ledger. A difference is shown when the statement reaches the period end."}
      </PageCaption>
    </>
  );
}

type ActivityProps = BankPresentation & {
  account: typeof Bank.BankWorkspaceAccount.Type;
  search: BankSearch;
  to: string;
  change: (search: BankSearch) => void;
  bookBase: string;
};

function AccountActivity(props: ActivityProps) {
  const { data, account, sv, money } = props;
  const { date, to, href } = props;

  const clearRecord = {
    ...props.search,
    statement: undefined,
    row: undefined,
    plan: undefined,
    undo: undefined,
  };

  return (
    <>
      <RecordSummary>
        <RecordFact label={sv ? "Kontoutdragets saldo" : "Statement balance"}>
          {money(account.statementBalanceMinor)}
          <PageCaption>
            {account.statementDate
              ? date(account.statementDate)
              : sv
                ? "Kontoutdrag saknas"
                : "No statement"}
          </PageCaption>
        </RecordFact>
        <RecordFact label={sv ? "Bokfört saldo" : "Ledger balance"}>
          {money(account.ledgerBalanceMinor)}
          <PageCaption>{date(to)}</PageCaption>
        </RecordFact>
        <RecordFact label={sv ? "Differens vid periodens slut" : "Difference at period end"}>
          {money(account.differenceMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Banktransaktioner att matcha" : "Bank transactions to match"}>
          {account.unmatchedCount}
        </RecordFact>
      </RecordSummary>
      <AccountTransactions {...props} />
      {data.reviews.length ? (
        <Disclosure label={sv ? "Senaste matchningsgranskningar" : "Recent matching reviews"}>
          <Box display="grid" gap="sm">
            {data.reviews.map((review) => (
              <Box
                key={review.id}
                display="flex"
                alignItems="center"
                justifyContent="between"
                gap="lg"
              >
                <Box>
                  <Text>{review.reason}</Text>
                  <PageCaption>
                    {date(review.createdAt)} ·{" "}
                    {review.completed
                      ? sv
                        ? "Genomförd"
                        : "Completed"
                      : sv
                        ? "Att granska"
                        : "To review"}
                  </PageCaption>
                </Box>
                <PageAction quiet href={href({ ...clearRecord, plan: review.id })}>
                  {sv ? "Öppna" : "Open"}
                </PageAction>
              </Box>
            ))}
          </Box>
        </Disclosure>
      ) : null}
      <PageCaption>
        {sv
          ? `${account.unmatchedLedgerCount} bokförda rader saknar full matchning mot kontoutdraget.`
          : `${account.unmatchedLedgerCount} ledger entries are not fully matched to the statement.`}
      </PageCaption>
    </>
  );
}

function AccountTransactions(props: ActivityProps) {
  const { data, search, sv, change } = props;
  const { money, date, href } = props;
  const tab = search.tab ?? "unmatched";

  const clearRecord = {
    ...search,
    statement: undefined,
    row: undefined,
    plan: undefined,
    undo: undefined,
  };

  const [queryText, setQueryText] = useState({ applied: search.q ?? "", value: search.q ?? "" });

  if (queryText.applied !== (search.q ?? ""))
    setQueryText({ applied: search.q ?? "", value: search.q ?? "" });

  return (
    <>
      <Box display="flex" justifyContent="between" alignItems="center" gap="lg" flexWrap="wrap">
        <RegisterFilters>
          {(["unmatched", "all", "matched", "ledger"] as const).map((value) => (
            <Button
              key={value}
              variant={tab === value ? "secondary" : "ghost"}
              onClick={() => change({ ...clearRecord, tab: value, page: undefined })}
            >
              {
                (sv
                  ? {
                      unmatched: "Att matcha",
                      all: "Alla transaktioner",
                      matched: "Matchade",
                      ledger: "Bokföring",
                    }
                  : {
                      unmatched: "To match",
                      all: "All transactions",
                      matched: "Matched",
                      ledger: "Ledger",
                    })[value]
              }{" "}
              {data.counts[value]}
            </Button>
          ))}
        </RegisterFilters>
        <Box
          as="form"
          display="flex"
          gap="sm"
          onSubmit={(event) => {
            event.preventDefault();
            change({
              ...clearRecord,
              q: queryText.value.trim() || undefined,
              page: undefined,
            });
          }}
        >
          <RegisterSearch
            aria-label={sv ? "Sök transaktioner" : "Search transactions"}
            placeholder={sv ? "Sök transaktion…" : "Search transaction…"}
            value={queryText.value}
            onChange={(event) => setQueryText({ ...queryText, value: event.target.value })}
          />
          <Button variant="ghost" type="submit">
            {sv ? "Sök" : "Search"}
          </Button>
        </Box>
      </Box>
      {data.rows.length ? (
        <DataTable
          title={sv ? "Transaktioner" : "Transactions"}
          columns={[
            { id: "date", label: sv ? "Datum" : "Date" },
            { id: "description", label: sv ? "Transaktion" : "Transaction" },
            { id: "status", label: "Status" },
            { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
            {
              id: "remaining",
              label: sv ? "Kvar att matcha" : "Remaining",
              numeric: true,
            },
            { id: "action", label: "" },
          ]}
          rows={data.rows.map((row) => ({
            id: row.id,
            cells: [
              date(row.date),
              row.description,
              <Badge key="status" variant={row.remainingMinor === "0" ? "secondary" : "warning"}>
                {row.remainingMinor === "0"
                  ? sv
                    ? "Matchad"
                    : "Matched"
                  : row.allocatedMinor !== "0"
                    ? sv
                      ? "Delvis matchad"
                      : "Partly matched"
                    : sv
                      ? "Att matcha"
                      : "To match"}
              </Badge>,
              money(row.amountMinor),
              money(row.remainingMinor),
              row.statementId && row.rowOrdinal ? (
                <PageAction
                  key="open"
                  quiet
                  href={href({
                    ...search,
                    statement: row.statementId,
                    row: String(row.rowOrdinal),
                    plan: undefined,
                    undo: undefined,
                  })}
                >
                  {sv ? "Granska" : "Review"}
                  <ArrowRight size={14} />
                </PageAction>
              ) : (
                <PageAction
                  key="voucher"
                  quiet
                  href={`${props.bookBase}/books?view=vouchers&record=${encodeURIComponent(row.voucherId ?? "")}`}
                >
                  {sv ? "Visa verifikation" : "View voucher"}
                </PageAction>
              ),
            ],
          }))}
        />
      ) : (
        <PageEmpty
          title={sv ? "Inga transaktioner i den här vyn" : "No transactions in this view"}
          detail={
            search.q
              ? sv
                ? "Ändra sökningen eller välj en annan vy."
                : "Change your search or choose another view."
              : tab === "unmatched"
                ? sv
                  ? "Välj Alla transaktioner för att se det importerade kontoutdraget."
                  : "Choose All transactions to see the imported statement."
                : sv
                  ? "Välj en annan period eller importera ett kontoutdrag."
                  : "Choose another period or import a statement."
          }
        />
      )}
      {data.total > 50 || data.page > 1 ? (
        <Box display="flex" justifyContent="between" alignItems="center">
          <PageCaption>
            {data.total} {sv ? "transaktioner" : "transactions"}
          </PageCaption>
          <Box display="flex" gap="sm">
            <Button
              variant="ghost"
              disabled={data.page <= 1}
              onClick={() => change({ ...clearRecord, page: String(data.page - 1) })}
            >
              <ArrowLeft size={14} />
              {sv ? "Föregående" : "Previous"}
            </Button>
            <Button
              variant="ghost"
              disabled={data.page * 50 >= data.total}
              onClick={() => change({ ...clearRecord, page: String(data.page + 1) })}
            >
              {sv ? "Nästa" : "Next"}
              <ArrowRight size={14} />
            </Button>
          </Box>
        </Box>
      ) : null}
    </>
  );
}

function BankScopeToolbar(props: {
  sv: boolean;
  from: string;
  to: string;
  currency: string;
  account?: typeof Bank.BankWorkspaceAccount.Type;
  selected: boolean;
  fetching: boolean;
  href: (search: BankSearch) => string;
  refresh: () => void;
  onPeriod: (from: string, to: string) => void;
}) {
  const { sv, account, from, to } = props;

  return (
    <>
      {props.selected ? (
        <Box>
          <PageAction quiet href={props.href({ from, to })}>
            <ArrowLeft size={14} />
            {sv ? "Alla bankkonton" : "All bank accounts"}
          </PageAction>
        </Box>
      ) : null}
      <RecordHeading
        title={account?.name ?? (sv ? "Dina bankkonton" : "Your bank accounts")}
        subtitle={
          account
            ? `${account.code} · ${props.currency}`
            : sv
              ? "Se vilka konton som behöver stämmas av och fortsätt där arbetet väntar."
              : "See which accounts need attention and continue reconciling."
        }
        action={
          <Button variant="ghost" disabled={props.fetching} onClick={props.refresh}>
            {sv ? "Uppdatera" : "Refresh"}
          </Button>
        }
      />
      <Box
        as="form"
        width="fit"
        display="flex"
        alignItems="end"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const from = fields.get("from");
          const to = fields.get("to");

          if (typeof from === "string" && typeof to === "string") props.onPeriod(from, to);
        }}
      >
        <InputField
          key={`from:${from}`}
          label={sv ? "Från" : "From"}
          name="from"
          type="date"
          required
          defaultValue={from}
        />
        <InputField
          key={`to:${to}`}
          label={sv ? "Till" : "To"}
          name="to"
          type="date"
          required
          defaultValue={to}
        />
        <Button type="submit" variant="outline">
          {sv ? "Visa perioden" : "Show period"}
        </Button>
      </Box>
    </>
  );
}

function AccountReport(props: {
  book: typeof Accounting.Book.Type;
  locale: "sv" | "en";
  account: typeof Bank.BankWorkspaceAccount.Type;
  from: string;
  to: string;
  reportId?: string;
  onReport: (id: string | undefined) => void;
}) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());

  const create = useMutation({
    mutationFn: () => {
      const path = `${bookPath(book)}/bank-reconciliations`;
      const input = { accountId: props.account.id, startsOn: props.from, endsOn: props.to };

      return readAccounting(
        path,
        Reconciliation.BankReconciliation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (report) => {
      keys.current.clear();
      props.onReport(report.id);
    },
  });

  return (
    <Disclosure
      key={props.reportId ?? "new"}
      label={sv ? "Avstämningsrapport" : "Reconciliation report"}
      open={!!props.reportId}
    >
      <Box display="grid" gap="lg">
        <PageCaption>
          {props.account.name} · {props.from}–{props.to}
        </PageCaption>
        <Box>
          <Button
            variant="outline"
            disabled={create.isPending || create.isError}
            onClick={() => create.mutate()}
          >
            {props.reportId
              ? sv
                ? "Spara ny rapport"
                : "Save new report"
              : sv
                ? "Spara rapport för perioden"
                : "Save report for this period"}
          </Button>
        </Box>
        <AccountingStatus locale={locale} pending={create.isPending} error={create.error} write />
        {create.isError ? (
          <Box>
            <Button variant="outline" onClick={() => create.mutate()}>
              {sv ? "Försök igen med samma begäran" : "Retry the same request"}
            </Button>
          </Box>
        ) : null}
        {props.reportId ? (
          <BankReport
            book={book}
            locale={locale}
            id={props.reportId}
            expected={{ accountId: props.account.id, startsOn: props.from, endsOn: props.to }}
          />
        ) : null}
      </Box>
    </Disclosure>
  );
}

function BankAdditionalTools({ sv, base }: { sv: boolean; base: string }) {
  return (
    <Disclosure
      label={sv ? "Avstämningsrapporter och fler verktyg" : "Reconciliation reports and more tools"}
    >
      <Box display="flex" gap="lg" flexWrap="wrap">
        <PageAction quiet href={`${base.replace(/\/accounts$/, "")}/banking-setup`}>
          {sv ? "Samtycken och kontokopplingar" : "Consents and account mappings"}
        </PageAction>
        <PageAction quiet href={`${base}?view=coverage`}>
          {sv ? "Granska underlagstäckning" : "Review statement coverage"}
        </PageAction>
        <PageAction quiet href={`${base}?view=payments`}>
          {sv ? "Betalningsfördelningar" : "Payment allocations"}
        </PageAction>
      </Box>
    </Disclosure>
  );
}
