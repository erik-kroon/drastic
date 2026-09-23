import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import { RecordHeading, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { formatMinorAmount } from "@/lib/workspace-api";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { bankCandidateCopy } from "./copy";

export interface BankCandidateSelection {
  readonly accountId: string;
  readonly statementId: string;
  readonly rowOrdinal: number;
  readonly voucherId: string;
  readonly lineId: string;
  readonly discoveryDigest: string;
}

export function BankCandidateResults({
  book,
  locale,
  source,
  onSelect,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  source: typeof Candidates.BankCandidateSource.Type;
  onSelect?: (selection: BankCandidateSelection) => void;
}) {
  const copy = bankCandidateCopy(locale);
  const client = useQueryClient();
  const queryKey = [
    ...bookKey(book),
    "bank-match-candidates",
    source.statementId,
    source.rowOrdinal,
  ];
  const [selected, setSelected] = useState<BankCandidateSelection | null>(null);
  const comparison = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const previousDigest =
        client.getQueryData<typeof Candidates.BankMatchCandidates.Type>(queryKey)?.digest;
      const input = previousDigest ? { ...source, previousDigest } : source;
      const result = await readAccounting(
        `${bookPath(book)}/bank-match-candidates`,
        Candidates.BankMatchCandidates,
        {
          method: "POST",
          body: JSON.stringify(input),
          signal,
        },
      );
      if (
        result.scope.entityId !== book.entityId ||
        result.scope.bookId !== book.id ||
        result.source.statementId !== source.statementId ||
        result.source.rowOrdinal !== source.rowOrdinal
      ) {
        throw new Error(copy.responseError);
      }
      return result;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
  });
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    retry: false,
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
  });
  const result = comparison.data;
  const account = setup.data?.accounts.find((entry) => entry.id === result?.window.accountId);
  const money = (value: string) =>
    result ? `${formatMinorAmount(value, result.currencyScale, locale)} ${result.currency}` : "—";
  const selectionAvailable = !comparison.isFetching && !comparison.isPaused && !comparison.isError;
  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={locale === "sv" ? "Möjliga matchningar" : "Possible matches"}
        subtitle={result ? `${result.source.observedOn} · ${result.source.description}` : undefined}
        action={
          <Button
            type="button"
            variant="outline"
            disabled={comparison.isFetching}
            onClick={() => {
              setSelected(null);
              void comparison.refetch();
            }}
          >
            {copy.refresh}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={comparison.isFetching} error={comparison.error} />
      {result ? (
        <>
          <RecordSummary>
            <RecordFact label={locale === "sv" ? "Konto" : "Account"}>
              {account ? `${account.code} · ${account.name}` : result.window.accountId}
            </RecordFact>
            <RecordFact label={copy.amount}>{money(result.source.amountMinor)}</RecordFact>
            <RecordFact label={copy.used}>{money(result.source.allocatedMinor)}</RecordFact>
            <RecordFact label={copy.remaining}>{money(result.source.remainingMinor)}</RecordFact>
          </RecordSummary>
          {result.previousDigestMatches === false ? (
            <Text role="status">{copy.changed}</Text>
          ) : null}
          {result.source.blockedReasons.map((reason) => (
            <Text key={reason}>{copy.blocks[reason]}</Text>
          ))}
          <PageCaption>
            {locale === "sv"
              ? "Jämför med bokföringen innan du väljer en matchning. Inga poster ändras här."
              : "Compare the transaction with the ledger before choosing a match. No records are changed here."}
          </PageCaption>
          <Box display="grid" gap="md" minWidth="zero">
            <Heading>
              {copy.candidates}: {result.candidates.length}
            </Heading>
            <Text>
              {copy.eligible}: {result.eligibleCount} · {copy.equal}:{" "}
              {result.equalAmountEligibleCount}
            </Text>
            {result.multipleEligibleCandidates ? <Text>{copy.ambiguous}</Text> : null}
            {result.candidates.length === 0 ? (
              <PageEmpty
                title={
                  locale === "sv" ? "Ingen bokförd rad att matcha" : "No posted entry to match"
                }
                detail={copy.empty}
              />
            ) : null}
            {result.candidates.map((candidate) => (
              <details key={`${candidate.voucherId}:${candidate.lineId}`}>
                <summary>
                  {candidate.postedOn} · {candidate.description} · {copy.remaining}:{" "}
                  {money(candidate.remainingMinor)} ·{" "}
                  {candidate.eligible ? copy.allowed : copy.blocked}
                </summary>
                <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
                  <InputField label={copy.voucher} value={candidate.voucherId} readOnly />
                  <InputField label={copy.line} value={candidate.lineId} readOnly />
                  <Text>
                    {copy.date}: {candidate.postedOn}
                  </Text>
                  <Text>
                    {copy.amount}: {money(candidate.amountMinor)} · {copy.used}:{" "}
                    {money(candidate.allocatedMinor)} · {copy.remaining}:{" "}
                    {money(candidate.remainingMinor)}
                  </Text>
                  <Text>
                    {copy.sameAccount}: {copy.yes} · {copy.sameCurrency}:{" "}
                    {candidate.sameCurrency ? copy.yes : copy.no} · {copy.sameSign}:{" "}
                    {candidate.sameSign ? copy.yes : copy.no}
                  </Text>
                  <Text>
                    {locale === "sv" ? "Beloppsskillnad / dagar" : "Amount difference / days"}:{" "}
                    {money(candidate.amountDistanceMinor)} / {candidate.dayDistance}
                  </Text>
                  {candidate.rankingReasons.map((reason) => (
                    <Text key={reason}>{copy.reasons[reason]}</Text>
                  ))}
                  {candidate.blockedReasons.map((reason) => (
                    <Text key={reason}>{copy.blocks[reason]}</Text>
                  ))}
                  <Box>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!candidate.eligible || !selectionAvailable}
                      onClick={() => {
                        const selection = {
                          ...source,
                          accountId: result.window.accountId,
                          voucherId: candidate.voucherId,
                          lineId: candidate.lineId,
                          discoveryDigest: result.digest,
                        };
                        setSelected(selection);
                        onSelect?.(selection);
                      }}
                    >
                      {copy.select}
                    </Button>
                  </Box>
                </Box>
              </details>
            ))}
          </Box>
          <Disclosure
            title={
              locale === "sv"
                ? "Jämförelsens underlag och avgränsning"
                : "Comparison basis and scope"
            }
          >
            <Text>
              {copy.source}: {source.statementId} / {source.rowOrdinal}
            </Text>
            <Text>
              {copy.window}: {result.window.startsOn} — {result.window.endsOn}
            </Text>
            <Text>{copy.scope}</Text>
            <Text>{copy.noIdentity}</Text>
            <Text>{copy.ranking}</Text>
            <Text>{copy.provider}</Text>
            <Text>
              {copy.evidence}: {result.source.evidenceId}
            </Text>
            <Text>
              {copy.sourceAccount}: {result.source.sourceBankAccountId}
            </Text>
            <Text>
              {copy.providerReference}: {result.source.providerId ?? copy.unavailable}
            </Text>
            <Text>
              {copy.cutoff}: {result.cutoff.committedSequence} · {copy.revision}:{" "}
              {result.cutoff.sourceRevision}
            </Text>
            <Text>{copy.snapshot}</Text>
            <InputField label={copy.digest} value={result.digest} readOnly />
          </Disclosure>
          {selected && selectionAvailable && selected.discoveryDigest === result.digest ? (
            <Box display="grid" gap="md" minWidth="zero">
              <Heading>{copy.selection}</Heading>
              <Text role="status">{onSelect ? copy.queued : copy.manual}</Text>
              <InputField label={copy.account} value={selected.accountId} readOnly />
              <InputField label={copy.statement} value={selected.statementId} readOnly />
              <InputField label={copy.ordinal} value={String(selected.rowOrdinal)} readOnly />
              <InputField label={copy.voucher} value={selected.voucherId} readOnly />
              <InputField label={copy.line} value={selected.lineId} readOnly />
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
