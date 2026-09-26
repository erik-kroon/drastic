import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Review from "@open-erp/contracts/accountant-review";
import { Download, RefreshCw } from "lucide-react";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import {
  RecordHeading,
  RecordSummary,
  RecordFact,
  RecordColumns,
  RecordSection,
} from "@open-erp/ui/components/record-layout";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { Disclosure, PageTabs } from "@open-erp/ui/components/workflow";
import { formatMinorAmount } from "@/lib/workspace-api";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { reviewCopy } from "./copy";
import { ReviewProviderRows } from "./provider-rows";
import { SiePanel } from "./sie-panel";
import { CoverageRows } from "./coverage-rows";

const sections: ReadonlyArray<typeof Review.ReviewSection.Type> = [
  "coverage",
  "balances",
  "journal",
  "evidence",
  "owner_sources",
  "owner_controls",
  "expense_tax",
];

export function ReviewPackInspector({
  book,
  id,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);
  const [section, setSection] = useState<typeof Review.ReviewSection.Type>("coverage");

  const view = useQuery({
    queryKey: [...bookKey(book), "accountant-review", id],
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/accountant-review-packs/${encodeURIComponent(id)}`,
        Review.ReviewPackView,
        { signal },
      );

      if (
        result.pack.id !== id ||
        result.pack.scope.bookId !== book.id ||
        result.pack.scope.entityId !== book.entityId
      )
        throw new Error("Review pack scope mismatch");

      return result;
    },
  });

  const pack = view.data?.pack;

  return (
    <Box as="section" display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={copy.title}
        subtitle={
          pack
            ? `${pack.report.startsOn} – ${pack.report.endsOn} · ${pack.report.currency}`
            : undefined
        }
        action={
          <Button
            variant="outline"
            disabled={view.isFetching}
            onClick={() => {
              void view.refetch();
            }}
          >
            <RefreshCw size={14} />
            {copy.refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={view.isPending} error={view.error} />
      <Text>
        {view.isSuccess && view.fetchStatus === "idle" && view.isFetchedAfterMount
          ? view.data.dependenciesCurrent
            ? copy.current
            : copy.historical
          : copy.currentnessUnknown}
      </Text>
      {pack ? (
        <>
          <RecordSummary>
            <RecordFact label={locale === "sv" ? "Period" : "Period"}>
              {pack.report.startsOn} – {pack.report.endsOn}
            </RecordFact>
            <RecordFact label={locale === "sv" ? "Valuta" : "Currency"}>
              {pack.report.currency}
            </RecordFact>
            <RecordFact label={copy.balances}>{pack.counts.balances}</RecordFact>
            <RecordFact label={locale === "sv" ? "Bokföringsrader" : "Journal lines"}>
              {pack.counts.journal}
            </RecordFact>
          </RecordSummary>
          <RecordColumns>
            <RecordSection title={copy.notesTitle}>
              <Text>{pack.accountantNotes}</Text>
            </RecordSection>
            <RecordSection title={copy.openingStatus}>
              <Text>{pack.openingBasis.explanation}</Text>
              <PageCaption>{copy.openingWarning}</PageCaption>
            </RecordSection>
          </RecordColumns>
          <Disclosure title={copy.downloads}>
            <PageCaption>{copy.downloadWarning}</PageCaption>
            {view.data?.artifacts.map((descriptor) => (
              <ArtifactDownload
                key={descriptor.format}
                book={book}
                pack={pack}
                descriptor={descriptor}
                locale={locale}
              />
            ))}
          </Disclosure>
          <PageTabs label={copy.title}>
            {sections.map((name) => (
              <Button
                key={name}
                variant={name === section ? "default" : "outline"}
                static
                aria-pressed={section === name}
                onClick={() => setSection(name)}
              >
                {copy[name]}
              </Button>
            ))}
          </PageTabs>
          <ReviewRows
            key={`${pack.id}:${section}`}
            book={book}
            pack={pack}
            section={section}
            locale={locale}
          />
          <SiePanel key={pack.id} book={book} pack={pack} locale={locale} />
          <Disclosure title={copy.basis}>
            <Box display="grid" minWidth="zero">
              <textarea
                aria-label={copy.basis}
                readOnly
                value={JSON.stringify(pack.basis, null, 2)}
                rows={14}
                cols={16}
              />
            </Box>
          </Disclosure>
        </>
      ) : null}
    </Box>
  );
}

function ArtifactDownload({
  book,
  pack,
  descriptor,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  pack: typeof Review.ReviewPack.Type;
  descriptor: typeof Review.ReviewArtifactDescriptor.Type;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);

  const download = useMutation({
    mutationFn: async () => {
      const artifact = await readAccounting(
        `${bookPath(book)}/accountant-review-packs/${encodeURIComponent(pack.id)}/artifacts/${descriptor.format}`,
        Review.ReviewArtifact,
      );

      if (
        artifact.packId !== pack.id ||
        artifact.packDigest !== pack.digest ||
        artifact.descriptor.format !== descriptor.format ||
        artifact.descriptor.sha256 !== descriptor.sha256 ||
        artifact.descriptor.byteLength !== descriptor.byteLength
      )
        throw new Error("Review artifact identity mismatch");
      const bytes = new TextEncoder().encode(artifact.content);
      const digest = await crypto.subtle.digest("SHA-256", bytes);

      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");

      if (bytes.byteLength !== descriptor.byteLength || sha256 !== descriptor.sha256)
        throw new Error("Review artifact bytes differ from the retained hash");

      return bytes;
    },
    onSuccess: (bytes) => {
      const url = URL.createObjectURL(
        new Blob([bytes], { type: `${descriptor.mediaType};charset=utf-8` }),
      );

      const link = document.createElement("a");
      link.href = url;
      link.download = descriptor.filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });

  const names = {
    json: locale === "sv" ? "Hela granskningspaketet" : "Complete review pack",
    balances_csv: copy.balances,
    journal_csv: copy.journal,
    evidence_csv: copy.evidence,
    coverage_csv: copy.coverage,
    owner_sources_csv: copy.owner_sources,
    owner_controls_csv: copy.owner_controls,
    expense_tax_csv: copy.expense_tax,
  };

  return (
    <Box display="grid" gap="sm" paddingBlock="md" minWidth="zero">
      <Box display="flex" justifyContent="between" alignItems="center" gap="lg">
        <Box display="grid" gap="xs" minWidth="zero">
          <Text>{names[descriptor.format]}</Text>
          <PageCaption>
            {descriptor.mediaType === "application/json" ? "JSON" : "CSV"} ·{" "}
            {new Intl.NumberFormat(locale).format(descriptor.byteLength)} {copy.bytes}
          </PageCaption>
        </Box>
        <Button
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
          aria-label={`${copy.save}: ${names[descriptor.format]}`}
        >
          <Download size={14} />
          {copy.save}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={download.isPending} error={download.error} />
      {download.isSuccess ? <PageCaption>{copy.checked}</PageCaption> : null}
      <details>
        <summary>{locale === "sv" ? "Filinformation" : "File details"}</summary>
        <Box display="grid" gap="sm" minWidth="zero">
          <Text>{descriptor.filename}</Text>
          <textarea
            aria-label={`${copy.hash}: ${descriptor.format}`}
            value={descriptor.sha256}
            readOnly
            rows={2}
            cols={16}
          />
        </Box>
      </details>
    </Box>
  );
}

function ReviewRows({
  book,
  pack,
  section,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  pack: typeof Review.ReviewPack.Type;
  section: typeof Review.ReviewSection.Type;
  locale: Locale;
}) {
  const copy = reviewCopy(locale);
  const amount = (value: string) => formatMinorAmount(value, pack.basis.currencyScale, locale);

  const pages = useInfiniteQuery({
    queryKey: [...bookKey(book), "accountant-review-rows", pack.id, pack.digest, section],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/accountant-review-packs/${encodeURIComponent(pack.id)}/rows/${section}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Review.ReviewPage,
        { signal },
      );

      if (
        page.packId !== pack.id ||
        page.packDigest !== pack.digest ||
        page.section !== section ||
        page.total !== pack.counts[section] ||
        page.items.some((row) => row.section !== section)
      )
        throw new Error("Review page basis mismatch");

      return page;
    },
    getNextPageParam: (last) => last.next ?? undefined,
  });

  const items = pages.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy[section]}</Heading>
      <Text>
        {copy.loaded}: {items.length} {copy.of} {pack.counts[section]}
      </Text>
      <PageCaption>{copy.fullFiles}</PageCaption>
      <AccountingStatus locale={locale} pending={pages.isPending} error={pages.error} />
      {pages.isSuccess && items.length === 0 ? <Text>{copy.emptySection}</Text> : null}
      {section === "balances" ? (
        <DataTable
          title={copy.balances}
          narrow="stack"
          columns={[
            { id: "account", label: copy.account },
            { id: "name", label: copy.name },
            { id: "opening", label: copy.recordedOpening, numeric: true },
            { id: "debit", label: copy.debit, numeric: true },
            { id: "credit", label: copy.credit, numeric: true },
            { id: "closing", label: copy.recordedClosing, numeric: true },
          ]}
          rows={items
            .filter((row) => row.section === "balances")
            .map((row) => ({
              id: row.accountId,
              cells: [
                row.code,
                row.name,
                amount(row.recordedOpeningMinor),
                amount(row.movementDebitMinor),
                amount(row.movementCreditMinor),
                amount(row.recordedClosingMinor),
              ],
            }))}
        />
      ) : null}
      {section === "coverage" ? (
        <CoverageRows items={items.filter((row) => row.section === "coverage")} locale={locale} />
      ) : null}
      {section === "journal" ? (
        <DataTable
          title={copy.journal}
          narrow="stack"
          columns={[
            { id: "part", label: copy.part },
            { id: "date", label: copy.date },
            { id: "voucher", label: copy.voucher },
            { id: "account", label: copy.account },
            { id: "description", label: copy.description },
            { id: "debit", label: copy.debit, numeric: true },
            { id: "credit", label: copy.credit, numeric: true },
            { id: "lineage", label: copy.receipt },
          ]}
          rows={items
            .filter((row) => row.section === "journal")
            .map((row) => ({
              id: `${row.voucherId}:${row.lineId}`,
              cells: [
                row.part,
                row.postingDate,
                `${row.series} ${row.voucherNumber}`,
                row.accountCode,
                row.description,
                amount(row.debitMinor),
                amount(row.creditMinor),
                <details key="lineage">
                  <summary>{locale === "sv" ? "Spåra posten" : "Trace entry"}</summary>
                  <Box display="grid" minWidth="zero">
                    <textarea
                      aria-label={`${copy.receipt}: ${row.voucherId}/${row.lineId}`}
                      value={JSON.stringify(row, null, 2)}
                      readOnly
                      rows={12}
                      cols={16}
                    />
                  </Box>
                </details>,
              ],
            }))}
        />
      ) : null}
      {section === "evidence"
        ? items
            .filter((row) => row.section === "evidence")
            .map((row) => (
              <Box
                key={row.id}
                display="grid"
                gap="md"
                padding="lg"
                borderWidth="thin"
                borderColor="default"
                borderRadius="surface"
                minWidth="zero"
              >
                <Text>
                  {row.title} · {row.id}
                </Text>
                <Text>
                  {copy.disposition}: {row.disposition}
                </Text>
                <Text>
                  {copy.origin}: {row.origin}
                </Text>
                <Text>
                  {copy.included}: {row.includedVoucherIds.join(", ") || "—"}
                </Text>
                <Text>
                  {copy.excluded}: {row.excludedVoucherIds.join(", ") || "—"}
                </Text>
                <details>
                  <summary>{copy.inspect}</summary>
                  <Box display="grid" gap="sm" minWidth="zero">
                    <Text>
                      {copy.hash}: {row.sha256}
                    </Text>
                    <textarea
                      aria-label={`${copy.inspect}: ${row.title}`}
                      value={row.content}
                      readOnly
                      rows={10}
                      cols={16}
                    />
                  </Box>
                </details>
              </Box>
            ))
        : null}
      <ReviewProviderRows items={items} section={section} locale={locale} />
      {pages.hasNextPage ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            disabled={pages.isFetchingNextPage}
            onClick={() => {
              void pages.fetchNextPage();
            }}
          >
            {copy.next}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
