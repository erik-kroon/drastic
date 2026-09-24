import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DataTable } from "@open-erp/ui/components/data-table";
import { formatMinorAmount } from "@/lib/workspace-api";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Reports from "@open-erp/contracts/reports";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { TrialBalance } from "@/components/trial-balance";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function InternalReports({
  book,
  locale,
  open = false,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  open?: boolean;
}) {
  const copy = accountingCopy(locale);
  const [reportId, setReportId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  return (
    <details open={open} id="internal-reports" tabIndex={-1}>
      <summary>{copy.report_title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.report_title}</Heading>
        <Text>{copy.report_warning}</Text>
        <PrepareSnapshot book={book} locale={locale} onCreated={setReportId} />
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("reportId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setLoadError(copy.journal_invalid);
              return;
            }
            setLoadError("");
            setReportId(id);
          }}
        >
          <InputField
            label={copy.report_id}
            name="reportId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.report_load}
            </Button>
          </Box>
          <Text role="status">{loadError}</Text>
        </Box>
        {reportId ? <SavedComparison book={book} locale={locale} reportId={reportId} /> : null}
        {reportId ? (
          <TrialBalance key={reportId} book={book} id={reportId} locale={locale} />
        ) : null}
      </Box>
    </details>
  );
}

function PrepareSnapshot({
  book,
  locale,
  onCreated,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onCreated: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const snapshot = useMutation({
    mutationFn: (payload: typeof Reports.PrepareReport.Type) => {
      const path = `${bookPath(book)}/report-snapshots`;
      return readAccounting(
        path,
        Reports.ReportSnapshot,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (report) => {
      client.setQueryData([...bookKey(book), "report-snapshot", report.id], report);
      onCreated(report.id);
    },
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Reports.PrepareReport)({
          kind: "trial_balance_v1",
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        setInputError("");
        snapshot.mutate(decoded.value);
      }}
    >
      <Heading>{copy.report_prepare}</Heading>
      <Text tone="muted">{copy.report_prepare_help}</Text>
      <Box
        as="fieldset"
        disabled={snapshot.isPending || snapshot.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <InputField label={copy.bank_starts} name="startsOn" type="date" required />
          <InputField label={copy.bank_ends} name="endsOn" type="date" required />
        </Box>
        <Box>
          <Button type="submit" size="xl">
            {copy.report_prepare}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={snapshot.isPending} error={snapshot.error} />
      {snapshot.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>{copy.report_created}</Text>
          <Text>
            {copy.report_id}: {snapshot.data.id}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                snapshot.reset();
                keys.current.clear();
              }}
            >
              {copy.report_new}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function SavedComparison({ book, locale, reportId }: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  reportId: string;
}) {
  const [otherId, setOtherId] = useState("");
  const [selected, setSelected] = useState("");
  const [accountId, setAccountId] = useState("");
  const comparison = useInfiniteQuery({
    queryKey: [...bookKey(book), "report-comparison", reportId, selected],
    enabled: selected !== "",
    initialPageParam: "",
    queryFn: async ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/report-snapshots/${encodeURIComponent(reportId)}/compare/${encodeURIComponent(selected)}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Reports.ReportComparisonPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next,
    retry: false,
  });
  const sv = locale === "sv";
  const first = comparison.data?.pages[0];
  const amount = (minor: string) => first
    ? `${formatMinorAmount(minor, first.currencyScale, locale)} ${first.currency}`
    : minor;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{sv ? "Jämför sparade saldobalanser" : "Compare saved trial balances"}</Heading>
      <Box as="form" display="grid" gap="md" onSubmit={(event) => {
        event.preventDefault();
        if (Schema.is(Accounting.Identifier)(otherId) && otherId !== reportId) {
          setSelected(otherId);
          setAccountId("");
        }
      }}>
        <InputField label={sv ? "Andra rapportens id" : "Other report ID"} value={otherId}
          onChange={(event) => setOtherId(event.target.value)} required />
        <Box><Button type="submit" variant="outline">{sv ? "Jämför" : "Compare"}</Button></Box>
      </Box>
      <AccountingStatus locale={locale} pending={comparison.isPending && selected !== ""} error={comparison.error} />
      {first ? <>
        <Text>{first.left.report.startsOn} – {first.left.report.endsOn} → {first.right.report.startsOn} – {first.right.report.endsOn}</Text>
        <Text>{sv ? "Differens = höger − vänster. Diagnostik, inte fastställda årsredovisningsjämförelsetal." : "Difference = right − left. Diagnostic only, not reviewed statutory comparatives."}</Text>
        <Text>{sv ? "Samtliga konton" : "All accounts"}: {first.totalAccounts}. {sv ? "Inlästa" : "Loaded"}: {comparison.data?.pages.flatMap((page) => page.items).length}.</Text>
        <DataTable title={sv ? "Kontoskillnader" : "Account differences"} narrow="stack"
          columns={[{ id: "account", label: sv ? "Konto" : "Account" },
            { id: "left", label: sv ? "Vänster saldo" : "Left closing", numeric: true },
            { id: "right", label: sv ? "Höger saldo" : "Right closing", numeric: true },
            { id: "difference", label: sv ? "Förändring" : "Difference", numeric: true }]}
          rows={comparison.data!.pages.flatMap((page) => page.items).map((line) => ({
            id: line.accountId,
            cells: [<Button key={line.accountId} type="button" variant="outline" onClick={() => setAccountId(line.accountId)}>
              {line.right?.code ?? line.left?.code} · {line.right?.name ?? line.left?.name}
            </Button>, line.left ? amount(line.left.closingMinor) : "—",
            line.right ? amount(line.right.closingMinor) : "—",
            line.difference ? amount(line.difference.closingMinor) : "—"],
          }))} />
        {comparison.hasNextPage ? <Box><Button type="button" variant="outline"
          disabled={comparison.isFetching} onClick={() => { void comparison.fetchNextPage(); }}>
          {sv ? "Fler konton" : "More accounts"}
        </Button></Box> : null}
        {accountId ? <Box display="grid" gap="lg">
          <Heading>{sv ? "Bidragande verifikat" : "Contributing entries"}</Heading>
          <TrialBalance key={`${reportId}:${accountId}`} book={book} id={reportId} locale={locale} accountId={accountId} onSelectAccount={setAccountId} />
          <TrialBalance key={`${selected}:${accountId}`} book={book} id={selected} locale={locale} accountId={accountId} onSelectAccount={setAccountId} />
        </Box> : null}
      </> : null}
    </Box>
  );
}

