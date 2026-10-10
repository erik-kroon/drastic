import { BankReviewContext } from "@/components/bank-review-context";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, defaultStringifySearch } from "@tanstack/react-router";
import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Bank from "@open-erp/contracts/bank-workspace";
import * as Reconciliation from "@open-erp/contracts/reconciliation";
import { ArrowLeft, ArrowRight, Landmark } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import {
  BankWorkspaceLayout,
  BankBalances,
  BankInset,
  BankToolbar,
  BankTransactionRow,
} from "@open-erp/ui/components/bank-workspace";
import {
  RegisterGroup,
  RegisterNavigation,
  RegisterTabs,
} from "@open-erp/ui/components/register-workspace";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import {
  PageAction,
  PageCaption,
  PageEmpty,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { StatementImports, statementImportsOptions } from "@/components/statement-imports";
import { BankTransactionMatch } from "@/components/bank-transaction-match";
import { BankReport } from "@/components/bank-report";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { bankWorkspaceOptions } from "@/lib/bank-workspace";
import { formatMinorAmount } from "@/lib/workspace-api";
import { encodeOwnerReturn } from "@/lib/work-return";

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

export { bankWorkspaceOptions } from "@/lib/bank-workspace";

export function bankWorkspaceParams(setup: typeof Accounting.BookSetup.Type, search: BankSearch) {
  const period =
    setup.periods.find((item) => item.startsOn <= setup.today && item.endsOn >= setup.today) ??
    setup.periods.at(-1);

  const from = search.from ?? period?.startsOn ?? setup.today;
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

  const query = bankWorkspaceParams(setup, search);
  const from = query.get("startsOn") ?? setup.today;
  const to = query.get("endsOn") ?? from;
  const base = `${workspacePath(book)}/accounts`;

  const change = (next: BankSearch) =>
    void navigate({ to: base, search: next, resetScroll: false });

  const href = (next: BankSearch) => `${base}${defaultStringifySearch(next)}`;

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
    <BankWorkspaceLayout
      title="Bank"
      action={
        account ? (
          <PageCaption>
            {account.name}, {account.code}
          </PageCaption>
        ) : undefined
      }
      tabs={
        <RegisterNavigation
          label="Bank"
          options={[
            {
              label: sv ? "Händelser" : "Events",
              active: search.view !== "imports",
              href: href({ ...clearRecord, view: undefined, record: undefined }),
              preload: preloadBank,
            },
            {
              label: sv ? "Importera kontoutdrag" : "Import statement",
              active: search.view === "imports",
              href: href({ ...clearRecord, view: "imports", record: undefined }),
              preload: preloadStatements,
            },
          ]}
        />
      }
    >
      {search.view === "imports" ? (
        <>
          {search.account ? (
            <Box>
              <PageAction quiet href={href({ ...clearRecord, view: undefined, record: undefined })}>
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
          <AccountingStatus locale={locale} pending={workspace.isPending} error={workspace.error} />
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
          {data && !search.account ? (
            <>
              <PageAction quiet href={`${base}?view=foreign-cash`}>
                Valutakonton
              </PageAction>
              <PageAction quiet href={`${base}?view=processors`}>
                Betalförmedlare
              </PageAction>
            </>
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
          <BankInset>
            <Disclosure
              label={`${sv ? "Period och bankkonto" : "Period and bank account"}, ${from} – ${to}`}
            >
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
            </Disclosure>
          </BankInset>
          <BankInset>
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
            <BankAdditionalTools sv={sv} base={base} search={search} />
          </BankInset>
        </>
      )}
      {(search.statement && search.row) || search.plan ? (
        <RecordSheet
          title={sv ? "Granska matchning" : "Review match"}
          presentation="bank-review"
          context={<BankReviewContext book={book} locale={locale} statementId={search.statement} />}
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
            accountLabel={account ? `${account.code} ${account.name}` : undefined}
            onClose={() => change(clearRecord)}
            onPlan={(plan) => change({ ...search, plan })}
            onReversal={(undo) => change({ ...search, undo })}
          />
        </RecordSheet>
      ) : null}
    </BankWorkspaceLayout>
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
                    {item.code}, {data.currency}
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
      <BankBalances
        facts={[
          {
            label: sv ? "Bokfört saldo" : "Ledger balance",
            amount: money(account.ledgerBalanceMinor),
          },
          {
            label: account.statementDate
              ? `${sv ? "Banksaldo" : "Statement balance"}, ${date(account.statementDate)}`
              : sv
                ? "Kontoutdrag saknas"
                : "No statement",
            amount: money(account.statementBalanceMinor),
          },
          {
            label: `${sv ? "Skillnad vid periodens slut" : "Difference at period end"}, ${date(to)}`,
            amount: money(account.differenceMinor),
            warning: account.differenceMinor !== null && account.differenceMinor !== "0",
          },
        ]}
      />
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
                    {date(review.createdAt)},{" "}
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

function bankEventGroups(data: typeof Bank.BankWorkspace.Type, tab: string, sv: boolean) {
  if (tab === "ledger") return [{ label: sv ? "Bokföring" : "Ledger", rows: data.rows }];

  return [
    {
      label: sv ? "Att matcha" : "To match",
      rows: data.rows.filter((row) => row.remainingMinor !== "0"),
    },
    {
      label: sv ? "Matchade" : "Matched",
      rows: data.rows.filter((row) => row.remainingMinor === "0"),
    },
  ].filter((group) => group.rows.length > 0);
}

function AccountTransactions(props: ActivityProps) {
  const { data, search, sv, change } = props;
  const { money, href } = props;
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
      <BankToolbar>
        <Box display="flex" justifyContent="between" alignItems="center" gap="lg" flexWrap="wrap">
          <RegisterTabs
            label={sv ? "Transaktioner" : "Transactions"}
            value={tab}
            options={(
              [
                ["unmatched", sv ? "Att matcha" : "To match"],
                ["all", sv ? "Alla transaktioner" : "All transactions"],
                ["matched", sv ? "Matchade" : "Matched"],
                ["ledger", sv ? "Bokföring" : "Ledger"],
              ] as const
            ).map(([value, label]) => ({ value, label: `${label} ${data.counts[value]}` }))}
            onChange={(value) => {
              if (
                value === "all" ||
                value === "unmatched" ||
                value === "matched" ||
                value === "ledger"
              )
                change({ ...clearRecord, tab: value, page: undefined });
            }}
          />
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
              compact
              aria-label={sv ? "Sök transaktioner" : "Search transactions"}
              placeholder={sv ? "Sök transaktion…" : "Search transaction…"}
              value={queryText.value}
              onChange={(event) => setQueryText({ ...queryText, value: event.target.value })}
            />
            <Button size="sm" variant="ghost" type="submit">
              {sv ? "Sök" : "Search"}
            </Button>
          </Box>
        </Box>
      </BankToolbar>
      {data.rows.length ? (
        <>
          {bankEventGroups(data, tab, sv).map((group) => (
            <Box key={group.label}>
              <RegisterGroup title={group.label} count={group.rows.length} />
              {group.rows.map((row) => (
                <BankTransactionRow
                  key={row.id}
                  date={new Intl.DateTimeFormat(sv ? "sv" : "en", {
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                  }).format(new Date(row.date))}
                  description={row.description}
                  amount={formatMinorAmount(row.amountMinor, data.currencyScale, sv ? "sv" : "en")}
                  warning={row.remainingMinor !== "0"}
                  caption={
                    row.remainingMinor === "0"
                      ? undefined
                      : `${row.allocatedMinor !== "0" ? (sv ? "Delvis matchad" : "Partly matched") : sv ? "Att matcha" : "To match"}, ${money(row.remainingMinor)} ${sv ? "kvar" : "remaining"}`
                  }
                  href={
                    row.statementId && row.rowOrdinal !== null
                      ? href({
                          ...search,
                          statement: row.statementId,
                          row: String(row.rowOrdinal),
                          plan: undefined,
                          undo: undefined,
                        })
                      : `${props.bookBase}/books${defaultStringifySearch({ view: "vouchers", record: row.voucherId, returnTo: encodeOwnerReturn({ owner: "bank", search }) })}`
                  }
                />
              ))}
            </Box>
          ))}
        </>
      ) : (
        <BankInset>
          <PageEmpty
            title={sv ? "Inga transaktioner i den här vyn" : "No transactions in this view"}
            detail={
              search.q
                ? sv
                  ? "Ändra sökningen eller välj en annan vy."
                  : "Change your search or choose another view."
                : sv
                  ? "Välj en annan period eller importera ett kontoutdrag."
                  : "Choose another period or import a statement."
            }
          />
        </BankInset>
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
      {!props.selected ? (
        <RecordHeading
          title={account?.name ?? (sv ? "Dina bankkonton" : "Your bank accounts")}
          subtitle={
            account
              ? `${account.code}, ${props.currency}`
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
      ) : null}
      <Box
        as="form"
        flexWrap="wrap"
        width="full"
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
          {props.account.name}, {props.from}–{props.to}
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

function BankAdditionalTools({
  sv,
  base,
  search,
}: {
  sv: boolean;
  base: string;
  search: BankSearch;
}) {
  const returnTo = encodeOwnerReturn({ owner: "bank", search });

  const specialist = (view: string) =>
    `${base}${defaultStringifySearch({ ...search, view, record: undefined, returnTo })}`;

  return (
    <Disclosure
      label={sv ? "Avstämningsrapporter och fler verktyg" : "Reconciliation reports and more tools"}
    >
      <Box display="flex" gap="lg" flexWrap="wrap">
        <PageAction
          quiet
          href={`${base.replace(/\/accounts$/, "")}/banking-setup${defaultStringifySearch({ returnTo })}`}
        >
          {sv ? "Samtycken och kontokopplingar" : "Consents and account mappings"}
        </PageAction>
        <PageAction quiet href={specialist("coverage")}>
          {sv ? "Granska underlagstäckning" : "Review statement coverage"}
        </PageAction>
        <PageAction quiet href={specialist("payments")}>
          {sv ? "Betalningsfördelningar" : "Payment allocations"}
        </PageAction>
      </Box>
    </Disclosure>
  );
}
