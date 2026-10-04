import { useState, type ReactNode } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { VoucherRegister } from "@open-erp/ui/components/voucher-register";
import {
  RegisterWorkspace,
  RegisterFilter,
  RegisterDetailHeading,
  RegisterDetailLines,
  RegisterDetailLink,
} from "@open-erp/ui/components/register-workspace";
import { RegisterSearch, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import {
  WorkFilter,
  WorkReviewAction,
  WorkReviewFooter,
} from "@open-erp/ui/components/work-controls";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { JournalCorrection } from "@/components/journal-correction";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount, workQueryOptions } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

type Props = {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  navigation: ReactNode;
  action: ReactNode;
  query: string;
  period: string;
  onQuery: (value: string) => void;
  onPeriod: (value: string) => void;
  onPrepared: (id: string) => void;
};

export function VoucherWorkspace(props: Props) {
  const sv = props.locale === "sv";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [series, setSeries] = useState("");
  const metadata = useQuery(workQueryOptions(props.book, {}));
  const scale = metadata.isError ? undefined : metadata.data?.currencyScale;

  const page = useInfiniteQuery({
    queryKey: [...bookKey(props.book), "vouchers"],
    initialPageParam: "0",
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${bookPath(props.book)}/vouchers?after=${encodeURIComponent(pageParam)}`,
        Accounting.VoucherPage,
        { signal },
      );

      if (
        result.items.some(
          (voucher) =>
            !props.setup.periods.some((period) => period.id === voucher.action.accountingPeriodId),
        )
      )
        throw new Error("Voucher period mismatch");

      return result;
    },
    getNextPageParam: (result) => result.next ?? undefined,
    retry: false,
  });

  const loaded = page.isError ? [] : (page.data?.pages.flatMap((batch) => batch.items) ?? []);

  const matching = loaded
    .filter(
      (voucher) =>
        (!props.period || voucher.action.accountingPeriodId === props.period) &&
        (!series || voucher.action.series === series) &&
        `${voucher.action.series}${voucher.number} ${voucher.action.description} ${voucher.action.postingDate}`
          .toLocaleLowerCase(props.locale)
          .includes(props.query.toLocaleLowerCase(props.locale)),
    )
    .sort((left, right) =>
      BigInt(left.sequence) < BigInt(right.sequence)
        ? 1
        : BigInt(left.sequence) > BigInt(right.sequence)
          ? -1
          : 0,
    );

  const selected = matching.find((voucher) => voucher.id === selectedId) ?? matching[0];

  return (
    <RegisterWorkspace
      title={sv ? "Bokföring" : "Bookkeeping"}
      headingSpacing="work"
      tabs={props.navigation}
      action={props.action}
      filters={
        <VoucherFilters
          {...props}
          series={series}
          onSeries={setSeries}
          seriesOptions={[...new Set(loaded.map((voucher) => voucher.action.series))]}
        />
      }
      detail={
        selected ? (
          <VoucherPreview key={selected.id} {...props} voucher={selected} scale={scale} />
        ) : (
          <PageCaption>{sv ? "Välj ett verifikat." : "Select a voucher."}</PageCaption>
        )
      }
    >
      <AccountingStatus locale={props.locale} pending={page.isPending} error={page.error} />
      {page.isError ? (
        <Box padding="lg">
          <Button
            disabled={page.isFetching}
            onClick={() => {
              void page.refetch();
            }}
          >
            {sv ? "Försök igen" : "Try again"}
          </Button>
        </Box>
      ) : null}
      {metadata.isError ? (
        <PageCaption role="alert">
          {sv ? "Valutans precision kunde inte läsas." : "Currency precision could not be read."}
        </PageCaption>
      ) : null}
      <VoucherRegister
        labels={{
          number: sv ? "Nr" : "No.",
          date: sv ? "Datum" : "Date",
          description: sv ? "Text" : "Description",
          amount: sv ? "Belopp" : "Amount",
        }}
        selected={selected?.id}
        onSelect={setSelectedId}
        rows={matching.map((voucher) => ({
          id: voucher.id,
          number: `${voucher.action.series}${voucher.number}`,
          date: shortDate(voucher.action.postingDate, props.locale),
          description: voucher.action.description,
          amount:
            scale === undefined
              ? "—"
              : formatMinorAmount(
                  voucher.action.lines
                    .reduce((sum, line) => sum + BigInt(line.debitMinor), 0n)
                    .toString(),
                  scale,
                  props.locale,
                ),
        }))}
      />
      {page.isSuccess && !matching.length ? (
        <Box padding="lg">
          <PageEmpty title={sv ? "Inga matchande verifikat" : "No matching vouchers"} />
        </Box>
      ) : null}
      {page.hasNextPage ? (
        <Box padding="lg" display="grid" gap="sm">
          <PageCaption>
            {sv
              ? "Filtren söker bland inlästa verifikat. Läs in fler för att utöka sökningen."
              : "Filters search loaded vouchers. Load more to extend the search."}
          </PageCaption>
          <Button
            disabled={page.isFetchingNextPage}
            variant="outline"
            onClick={() => {
              void page.fetchNextPage();
            }}
          >
            {sv ? "Läs in fler" : "Load more"}
          </Button>
        </Box>
      ) : null}
    </RegisterWorkspace>
  );
}

function shortDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function VoucherFilters(
  props: Props & {
    series: string;
    onSeries: (value: string) => void;
    seriesOptions: readonly string[];
  },
) {
  const sv = props.locale === "sv";

  return (
    <>
      <RegisterFilter
        label={sv ? "Period" : "Period"}
        value={props.period}
        onValueChange={props.onPeriod}
        options={[
          { value: "", label: sv ? "Alla perioder" : "All periods" },
          ...props.setup.periods.map((period) => ({
            value: period.id,
            label: `${period.startsOn} – ${period.endsOn}`,
          })),
        ]}
      />
      <RegisterFilter
        label={sv ? "Serie" : "Series"}
        value={props.series}
        onValueChange={props.onSeries}
        options={[
          { value: "", label: sv ? "Alla serier" : "All series" },
          ...props.seriesOptions.map((value) => ({ value, label: value })),
        ]}
      />
      <WorkFilter label={sv ? "Sök" : "Search"}>
        <RegisterSearch
          compact
          aria-label={sv ? "Sök verifikat" : "Search vouchers"}
          value={props.query}
          onChange={(event) => props.onQuery(event.target.value)}
        />
      </WorkFilter>
    </>
  );
}

function VoucherPreview(
  props: Props & { voucher: typeof Accounting.Voucher.Type; scale: number | undefined },
) {
  const sv = props.locale === "sv";
  const [correcting, setCorrecting] = useState(false);
  const voucher = props.voucher;
  const search = new URLSearchParams({ view: "vouchers", record: voucher.id });

  if (props.query) search.set("q", props.query);

  if (props.period) search.set("period", props.period);

  return (
    <>
      <RegisterDetailHeading
        title={voucher.action.description}
        caption={`${sv ? "Verifikat" : "Voucher"} ${voucher.action.series}${voucher.number}, ${shortDate(voucher.action.postingDate, props.locale)}`}
      />
      <RegisterDetailLines
        hideHeading
        title={sv ? "Bokföring" : "Posting"}
        lines={voucher.action.lines.flatMap((line) => {
          const account = props.setup.accounts.find((item) => item.id === line.accountId);
          const amounts = [];

          if (BigInt(line.debitMinor) > 0n) amounts.push({ side: "debit", value: line.debitMinor });

          if (BigInt(line.creditMinor) > 0n)
            amounts.push({ side: "credit", value: `-${line.creditMinor}` });

          if (!amounts.length) amounts.push({ side: "zero", value: "0" });

          return amounts.map((amount) => ({
            id: `${line.lineId}:${amount.side}`,
            description: account ? `${account.code} ${account.name}` : line.description,
            amount:
              props.scale === undefined
                ? "—"
                : formatMinorAmount(amount.value, props.scale, props.locale),
          }));
        })}
      />
      <RegisterDetailLink href={`${workspacePath(props.book)}/books?${search}`}>
        {sv ? "Öppna verifikatet" : "Open voucher"}
      </RegisterDetailLink>
      {voucher.action.evidenceRefs.map((reference) => (
        <EvidenceInspector
          key={`${reference.evidenceId}/${reference.locator}`}
          compact
          book={props.book}
          locale={props.locale}
          reference={reference}
        />
      ))}
      <WorkReviewFooter>
        <Box display="grid" gap="sm">
          <WorkReviewAction
            variant="outline"
            disabled={props.setup.blockers.length > 0}
            onClick={() => setCorrecting(true)}
          >
            {sv ? "Rätta verifikatet" : "Correct voucher"}
          </WorkReviewAction>
          <PageCaption>
            {sv
              ? "Ett bokfört verifikat ändras aldrig. Rättelsen blir ett nytt verifikat."
              : "A posted voucher never changes. Its correction becomes a new voucher."}
          </PageCaption>
        </Box>
      </WorkReviewFooter>
      {correcting ? (
        <FormDialog
          title={sv ? "Rätta verifikatet" : "Correct voucher"}
          closeLabel={sv ? "Stäng" : "Close"}
          onClose={() => setCorrecting(false)}
        >
          <JournalCorrection
            book={props.book}
            voucherId={voucher.id}
            periods={props.setup.periods}
            locale={props.locale}
            onPrepared={props.onPrepared}
          />
        </FormDialog>
      ) : null}
    </>
  );
}
