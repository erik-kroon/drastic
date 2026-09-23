import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
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

export function BankCandidateResults({ book, locale, source, onSelect }: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  source: typeof Candidates.BankCandidateSource.Type;
  onSelect?: (selection: BankCandidateSelection) => void;
}) {
  const copy = bankCandidateCopy(locale);
  const client = useQueryClient();
  const queryKey = [...bookKey(book), "bank-match-candidates", source.statementId, source.rowOrdinal];
  const [selected, setSelected] = useState<BankCandidateSelection | null>(null);
  const comparison = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const previousDigest = client.getQueryData<typeof Candidates.BankMatchCandidates.Type>(queryKey)?.digest;
      const input = previousDigest ? { ...source, previousDigest } : source;
      const result = await readAccounting(`${bookPath(book)}/bank-match-candidates`, Candidates.BankMatchCandidates, {
        method: "POST", body: JSON.stringify(input), signal,
      });
      if (result.scope.entityId !== book.entityId || result.scope.bookId !== book.id
        || result.source.statementId !== source.statementId || result.source.rowOrdinal !== source.rowOrdinal) {
        throw new Error(copy.responseError);
      }
      return result;
    },
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: "always",
  });
  const result = comparison.data;
  const selectionAvailable = !comparison.isFetching && !comparison.isPaused && !comparison.isError;
  return <Box display="grid" gap="xl" minWidth="zero">
    <Text>{copy.source}: {source.statementId} / {source.rowOrdinal}</Text>
    <Box><Button type="button" variant="outline" disabled={comparison.isFetching} onClick={() => {
      setSelected(null);
      void comparison.refetch();
    }}>{copy.refresh}</Button></Box>
    <AccountingStatus locale={locale} pending={comparison.isFetching} error={comparison.error} />
    {result ? <>
      <Box display="grid" gap="sm" minWidth="zero">
        <Text>{copy.account}: {result.window.accountId}</Text>
        <Text>{copy.window}: {result.window.startsOn} — {result.window.endsOn}</Text>
        <Text>{copy.scope}</Text>
        <Text>{copy.units}: {result.currency} / {result.currencyScale}</Text>
        <Text>{result.source.observedOn} · {result.source.description}</Text>
        <Text>{copy.amount}: {result.source.amountMinor} · {copy.used}: {result.source.allocatedMinor} · {copy.remaining}: {result.source.remainingMinor}</Text>
        <Text>{copy.evidence}: {result.source.evidenceId}</Text>
        <Text>{copy.sourceAccount}: {result.source.sourceBankAccountId}</Text>
        <Text>{copy.providerReference}: {result.source.providerId ?? copy.unavailable}</Text>
        <Text>{copy.cutoff}: {result.cutoff.committedSequence} · {copy.revision}: {result.cutoff.sourceRevision}</Text>
        <Text>{copy.snapshot}</Text>
        <InputField label={copy.digest} value={result.digest} readOnly />
        {result.previousDigestMatches !== null ? <Text role="status">{result.previousDigestMatches ? copy.unchanged : copy.changed}</Text> : null}
        {result.source.blockedReasons.map((reason) => <Text key={reason}>{copy.blocks[reason]}</Text>)}
      </Box>
      <Box display="grid" gap="md" minWidth="zero">
        <Heading>{copy.candidates}: {result.candidates.length}</Heading>
        <Text>{copy.eligible}: {result.eligibleCount} · {copy.equal}: {result.equalAmountEligibleCount}</Text>
        {result.multipleEligibleCandidates ? <Text>{copy.ambiguous}</Text> : null}
        <Text>{copy.noIdentity}</Text>
        <Text>{copy.ranking}</Text>
        <Text>{copy.provider}</Text>
        {result.candidates.length === 0 ? <Text>{copy.empty}</Text> : null}
        {result.candidates.map((candidate) => <details key={`${candidate.voucherId}:${candidate.lineId}`}>
          <summary>{candidate.postedOn} · {candidate.description} · {copy.remaining}: {candidate.remainingMinor} · {candidate.eligible ? copy.allowed : copy.blocked}</summary>
          <Box display="grid" gap="md" paddingBlock="lg" minWidth="zero">
            <InputField label={copy.voucher} value={candidate.voucherId} readOnly />
            <InputField label={copy.line} value={candidate.lineId} readOnly />
            <Text>{copy.date}: {candidate.postedOn}</Text>
            <Text>{copy.amount}: {candidate.amountMinor} · {copy.used}: {candidate.allocatedMinor} · {copy.remaining}: {candidate.remainingMinor}</Text>
            <Text>{copy.sameAccount}: {copy.yes} · {copy.sameCurrency}: {candidate.sameCurrency ? copy.yes : copy.no} · {copy.sameSign}: {candidate.sameSign ? copy.yes : copy.no}</Text>
            <Text>{copy.distance}: {candidate.amountDistanceMinor} / {candidate.dayDistance}</Text>
            {candidate.rankingReasons.map((reason) => <Text key={reason}>{copy.reasons[reason]}</Text>)}
            {candidate.blockedReasons.map((reason) => <Text key={reason}>{copy.blocks[reason]}</Text>)}
            <Box><Button type="button" variant="outline" disabled={!candidate.eligible || !selectionAvailable} onClick={() => {
              const selection = {
                ...source, accountId: result.window.accountId, voucherId: candidate.voucherId,
                lineId: candidate.lineId, discoveryDigest: result.digest,
              };
              setSelected(selection);
              onSelect?.(selection);
            }}>{copy.select}</Button></Box>
          </Box>
        </details>)}
      </Box>
      {selected && selectionAvailable && selected.discoveryDigest === result.digest ? <Box display="grid" gap="md" minWidth="zero">
        <Heading>{copy.selection}</Heading>
        <Text role="status">{copy.manual}</Text>
        <InputField label={copy.account} value={selected.accountId} readOnly />
        <InputField label={copy.statement} value={selected.statementId} readOnly />
        <InputField label={copy.ordinal} value={String(selected.rowOrdinal)} readOnly />
        <InputField label={copy.voucher} value={selected.voucherId} readOnly />
        <InputField label={copy.line} value={selected.lineId} readOnly />
      </Box> : null}
    </> : null}
  </Box>;
}
