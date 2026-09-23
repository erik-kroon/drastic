import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import { Voucher, VoucherPage } from "@open-erp/contracts/accounting";
import { RecordHeading } from "@open-erp/ui/components/record-layout";
import { RefreshCw } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataGrid } from "@open-erp/ui/components/data-grid";
import { SelectControl } from "@open-erp/ui/components/select";
import {
  PageEmpty,
  PageAction,
  PageCaption,
  RecordToggle,
  RegisterFilters,
  RegisterFilter,
  RegisterSearch,
} from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { JournalCorrection } from "@/components/journal-correction";
import { ReviewEntry } from "@/components/posting-recovery/review-entry";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { accountingCopy } from "@/lib/accounting-copy";
import { frontendCopy } from "@/lib/frontend-copy";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

type PostedRecordsProps = {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  setup: typeof Accounting.BookSetup.Type | undefined;
  onPrepared: (id: string) => void;
};

export function PostedRecords(props: PostedRecordsProps) {
  const { book, locale } = props;
  const copy = frontendCopy(locale);
  const accounting = accountingCopy(locale);
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = metadata.data?.currencyScale;
  const vouchers = useInfiniteQuery({
    queryKey: [...bookKey(book), "vouchers"],
    initialPageParam: "0",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/vouchers?after=${encodeURIComponent(pageParam)}`,
        VoucherPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const loaded = vouchers.isError ? [] : (vouchers.data?.pages.flatMap((page) => page.items) ?? []);
  const matching = loaded.filter(
    (voucher) =>
      (!period || voucher.action.accountingPeriodId === period) &&
      `${voucher.action.series}${voucher.number} ${voucher.action.description} ${voucher.action.postingDate}`
        .toLocaleLowerCase(locale)
        .includes(query.toLocaleLowerCase(locale)),
  );
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <RegisterFilters>
        <RegisterSearch
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <RegisterFilter>
          <SelectControl
            aria-label={accounting.workspace_period}
            value={period}
            options={[
              { value: "", label: copy.allPeriods },
              ...(props.setup?.periods.map((item) => ({
                value: item.id,
                label: `${item.startsOn} – ${item.endsOn}`,
              })) ?? []),
            ]}
            onValueChange={(value) => setPeriod(value ?? "")}
          />
        </RegisterFilter>
        <Button
          static
          variant="ghost"
          aria-label={accounting.journal_refresh}
          disabled={vouchers.isFetching}
          onClick={() => {
            void vouchers.refetch();
            void metadata.refetch();
          }}
        >
          <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </RegisterFilters>
      <AccountingStatus locale={locale} pending={vouchers.isPending} error={vouchers.error} />
      {metadata.isError ? (
        <PageCaption role="alert">{accounting.workspace_currency_unavailable}</PageCaption>
      ) : null}
      {matching.length ? (
        <DataGrid
          title={copy.vouchers}
          narrow="stack"
          rows={matching}
          getRowId={(voucher) => voucher.id}
          columns={[
            {
              id: "number",
              width: "content",
              label: copy.voucher,
              cell: (voucher) => (
                <RecordToggle
                  expanded={expanded === voucher.id}
                  aria-label={`${copy.voucher} ${voucher.action.series}${voucher.number}`}
                  onClick={() => setExpanded(expanded === voucher.id ? null : voucher.id)}
                >
                  {voucher.action.series}
                  {voucher.number}
                </RecordToggle>
              ),
            },
            {
              id: "date",
              width: "content",
              label: copy.date,
              cell: (voucher) => voucher.action.postingDate,
            },
            {
              id: "description",
              width: "fill",
              label: copy.description,
              cell: (voucher) => voucher.action.description,
            },
            {
              id: "amount",
              width: "content",
              label: `${copy.amount} · ${book.currency}`,
              numeric: true,
              cell: (voucher) => {
                const total = voucher.action.lines.reduce(
                  (sum, line) => sum + BigInt(line.debitMinor),
                  0n,
                );
                return scale === undefined
                  ? "—"
                  : formatMinorAmount(total.toString(), scale, locale);
              },
            },
          ]}
          renderDetail={(voucher) =>
            expanded === voucher.id ? <VoucherDetails {...props} voucher={voucher} /> : null
          }
        />
      ) : null}
      {vouchers.isSuccess && !matching.length ? (
        <PageEmpty
          title={loaded.length ? copy.noMatches : copy.noVouchers}
          detail={loaded.length ? undefined : copy.noVouchersDetail}
        >
          {!loaded.length ? (
            <PageAction href={`${workspacePath(book)}/books?view=journal`}>
              {copy.newEntry}
            </PageAction>
          ) : null}
        </PageEmpty>
      ) : null}
      {vouchers.hasNextPage ? (
        <>
          <PageCaption>
            {locale === "sv"
              ? "Filtren söker bland inlästa verifikat. Läs in fler för att utöka sökningen."
              : "Filters search the loaded vouchers. Load more to extend the search."}
          </PageCaption>
          <Box>
            <Button
              static
              variant="outline"
              disabled={vouchers.isFetchingNextPage}
              onClick={() => {
                void vouchers.fetchNextPage();
              }}
            >
              {accounting.journal_more}
            </Button>
          </Box>
        </>
      ) : null}
    </Box>
  );
}

export function PostedRecord(props: PostedRecordsProps & { id: string }) {
  const { book, id, locale } = props;
  const record = useQuery({
    queryKey: [...bookKey(book), "voucher", id],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${bookPath(book)}/vouchers/${encodeURIComponent(id)}`,
        Voucher,
        { signal },
      );
      if (value.id !== id) throw new Error("Voucher identity mismatch");
      return value;
    },
    retry: false,
  });
  const voucher = record.isSuccess ? record.data : undefined;
  return (
    <>
      <AccountingStatus locale={locale} pending={record.isPending} error={record.error} />
      {record.isError ? (
        <Button variant="outline" onClick={() => void record.refetch()}>
          {locale === "sv" ? "Försök igen" : "Try again"}
        </Button>
      ) : null}
      {voucher ? (
        <>
          <RecordHeading
            title={`${voucher.action.series}${voucher.number} · ${voucher.action.description}`}
            subtitle={voucher.action.postingDate}
          />
          <VoucherDetails {...props} voucher={voucher} />
        </>
      ) : null}
    </>
  );
}

function VoucherDetails(props: PostedRecordsProps & { voucher: typeof Accounting.Voucher.Type }) {
  const copy = frontendCopy(props.locale);
  return (
    <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
      <ReviewEntry
        book={props.book}
        action={props.voucher.action}
        locale={props.locale}
        accounts={props.setup?.accounts ?? []}
      />
      <PageCaption>
        {copy.recorded} ·{" "}
        {new Intl.DateTimeFormat(props.locale, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(props.voucher.recordedAt),
        )}
      </PageCaption>
      <Disclosure title={copy.details}>
        <PageCaption>
          {props.voucher.id} · {props.voucher.sequence}
        </PageCaption>
      </Disclosure>
      {props.setup && props.setup.blockers.length === 0 ? (
        <Disclosure title={accountingCopy(props.locale).journal_correction}>
          <JournalCorrection
            book={props.book}
            voucherId={props.voucher.id}
            periods={props.setup.periods}
            locale={props.locale}
            onPrepared={props.onPrepared}
          />
        </Disclosure>
      ) : null}
    </Box>
  );
}
