import { Api } from "@open-erp/contracts/api";
import { useCommandKeys } from "@/lib/command-keys";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { submitBankWithCitationRefresh } from "@/lib/bank-citation-request";
import { useRef, useState, type ReactNode } from "react";
import { useSearch, defaultStringifySearch } from "@tanstack/react-router";
import { encodeOwnerReturn } from "@/lib/work-return";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
import * as Settlement from "@open-erp/contracts/settlements";
import { Voucher } from "@open-erp/contracts/accounting";
import { BankStatementView } from "@open-erp/contracts/reconciliation";
import {
  BankEvidenceReview,
  BankReviewAmount,
  BankReviewReason,
  BankReviewAcknowledgment,
  BankReviewSection,
  BankReviewFact,
  BankReviewHeading,
  BankReviewLink,
  BankReviewTextAction,
  BankReviewFacts,
  BankReviewPreparedPlan,
  BankReviewFooter,
  BankReviewOriginalPlaceholder,
  BankReviewCandidateCard,
  BankReviewWarning,
  BankReviewCaption,
  BankReviewSubmit,
  BankReviewSectionTitle,
} from "@open-erp/ui/components/bank-evidence-review";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Badge } from "@open-erp/ui/components/badge";
import { InputField } from "@open-erp/ui/components/field";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Text } from "@open-erp/ui/components/typography";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import {
  RecordHeading,
  RecordSummary,
  RecordFact,
  RecordSection,
  RecordColumns,
} from "@open-erp/ui/components/record-layout";
import { PageCaption, PageEmpty, PageAction } from "@open-erp/ui/components/accounting-page";
import { workspacePath } from "@/lib/book-context";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { minorToDecimal, signedDecimalToMinor, formatMinorAmount } from "@/lib/workspace-api";
import { CommandForm, checkScope, type CommerceProps } from "@/components/commerce/shared";
import { bankCandidateCopy } from "@/components/bank-match-candidates/copy";
import { BankUnmatchReview } from "@/components/bank-match-reversals/review";
import { BankAllocationUnmatchNotice } from "@/components/bank-match-reversals/notice";

import { WorkQuestionsEntry } from "./work-questions";
import { accountingCopy } from "@/lib/accounting-copy";
import {
  BankMatchOriginal,
  useBankMatchOriginal,
  useBankMatchDocument,
} from "@/components/bank-match-original";
import { coordinationOptions } from "@/lib/workspace-coordination";

type Props = CommerceProps & {
  statementId?: string;
  rowOrdinal: number;
  planId?: string;
  reversalId?: string;
  accountId?: string;
  accountLabel?: string;
  onClose: () => void;
  onPlan: (id: string) => void;
  onReversal: (id: string) => void;
};

const abs = (amount: bigint) => (amount < 0n ? -amount : amount);

export function BankTransactionMatch(props: Props) {
  if (props.planId) return <MatchingReview {...props} key={props.planId} id={props.planId} />;

  if (!props.statementId) return null;

  return (
    <DiscoverMatch
      {...props}
      key={`${props.statementId}:${props.rowOrdinal}`}
      statementId={props.statementId}
    />
  );
}

function DiscoverMatch(props: Props & { statementId: string }) {
  const { book, locale, statementId, rowOrdinal } = props;
  const sv = locale === "sv";
  const [selection, setSelection] = useState<string | null>(null);

  const [coverSelection, setCoverSelection] = useState<{ digest: string; index: number } | null>(
    null,
  );

  const [visible, setVisible] = useState(25);

  const matches = useQuery({
    queryKey: [...bookKey(book), "bank-match-candidates", statementId, rowOrdinal],
    staleTime: 0,
    refetchOnWindowFocus: "always",
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        (client, requestOptions) =>
          client.bankMatchCandidates.discoverBankMatchCandidates(
            httpRequest(
              Api.groups.bankMatchCandidates.endpoints.discoverBankMatchCandidates,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          ),
        Candidates.BankMatchCandidates,
        { method: "POST", body: JSON.stringify({ statementId, rowOrdinal }), signal },
      );

      checkScope(book, value.scope);

      if (value.source.statementId !== statementId || value.source.rowOrdinal !== rowOrdinal)
        throw new Error("Bank transaction identity mismatch");

      return value;
    },
    retry: false,
  });

  const data = matches.isSuccess ? matches.data : undefined;
  const selected = data?.candidates.find((row) => `${row.voucherId}:${row.lineId}` === selection);

  const selectedCover = selectedBankCover(data, coverSelection);

  if (data && selected) {
    return (
      <MatchChoice
        {...props}
        key={selection}
        data={data}
        candidate={selected}
        current={!matches.isFetching}
        refreshCandidates={async () => {
          const fresh = await matches.refetch();

          if (!fresh.data || fresh.error)
            throw fresh.error ?? new Error("Bank candidates unavailable");

          return fresh.data;
        }}
        onBack={() => setSelection(null)}
      />
    );
  }

  const copy = bankCandidateCopy(locale);

  const money = (value: string) =>
    data ? `${formatMinorAmount(value, data.currencyScale, locale)} ${data.currency}` : "—";

  const standardReview = (
    <Box display="grid" gap="xl" minWidth="zero">
      <AccountingStatus locale={locale} pending={matches.isPending} error={matches.error} />
      {matches.isError ? (
        <Box>
          <Button variant="outline" onClick={() => void matches.refetch()}>
            {sv ? "Försök igen" : "Try again"}
          </Button>
        </Box>
      ) : null}
      {data ? (
        <>
          <RecordHeading title={data.source.description} subtitle={data.source.observedOn} />
          <WorkQuestionsEntry
            book={book}
            locale={locale}
            target={{ kind: "bank", recordId: statementId, rowOrdinal }}
          />
          <RecordSummary>
            <RecordFact label={sv ? "Banktransaktion" : "Bank transaction"}>
              {money(data.source.amountMinor)}
            </RecordFact>
            <RecordFact label={sv ? "Redan matchat" : "Already matched"}>
              {money(data.source.allocatedMinor)}
            </RecordFact>
            <RecordFact label={sv ? "Kvar att matcha" : "Remaining"}>
              {money(data.source.remainingMinor)}
            </RecordFact>
          </RecordSummary>
          <BankSourceStatementLink book={book} locale={locale} statementId={statementId} />
          <Disclosure label={sv ? "Visa kontoutdragets underlag" : "View statement evidence"}>
            <EvidenceInspector
              book={book}
              locale={locale}
              reference={{
                evidenceId: data.source.evidenceId,
                sha256: data.source.evidenceSha256,
                locator: `${statementId}/${rowOrdinal}`,
              }}
            />
          </Disclosure>
          {data.source.blockedReasons.map((reason) => (
            <Text key={reason}>{copy.blocks[reason]}</Text>
          ))}
          {selected || selectedCover ? (
            <MatchChoice
              {...props}
              key={`${selection}:${coverSelection?.digest ?? "manual"}:${coverSelection?.index ?? "manual"}`}
              data={data}
              candidate={selected}
              cover={selectedCover}
              current={!matches.isFetching}
              refreshCandidates={async () => {
                const fresh = await matches.refetch();

                if (!fresh.data || fresh.error)
                  throw fresh.error ?? new Error("Bank candidates unavailable");

                return fresh.data;
              }}
              onBack={() => {
                setSelection(null);
                setCoverSelection(null);
              }}
            />
          ) : (
            <RecordSection title={sv ? "Välj bokförd transaktion" : "Choose a posted transaction"}>
              <ExactCoverChoices
                data={data}
                locale={locale}
                current={!matches.isFetching}
                onChoose={(index) => {
                  setSelection(null);
                  setCoverSelection({ digest: data.digest, index });
                }}
              />
              <PageCaption>
                {sv
                  ? "Välj den bokförda transaktion som hör till bankhändelsen. Du kan matcha hela eller delar av beloppet."
                  : "Choose the posted transaction for this bank entry. You can match all or part of its amount."}
              </PageCaption>
              {data.candidates.length ? (
                <DataTable
                  title={sv ? "Bokförda transaktioner" : "Posted transactions"}
                  columns={[
                    { id: "date", label: sv ? "Datum" : "Date" },
                    { id: "description", label: sv ? "Beskrivning" : "Description" },
                    { id: "amount", label: sv ? "Kvar att matcha" : "Remaining", numeric: true },
                    { id: "action", label: "" },
                  ]}
                  rows={data.candidates.slice(0, visible).map((row) => ({
                    id: `${row.voucherId}:${row.lineId}`,
                    cells: [
                      row.postedOn,
                      <Box key="description">
                        <Text>{row.description}</Text>
                        <PageCaption>
                          {row.eligible
                            ? row.equalRemainingAmount
                              ? sv
                                ? "Samma belopp"
                                : "Same amount"
                              : sv
                                ? "Annat belopp"
                                : "Different amount"
                            : row.blockedReasons.map((reason) => copy.blocks[reason]).join(" ")}
                        </PageCaption>
                      </Box>,
                      money(row.remainingMinor),
                      <Button
                        key="choose"
                        variant="outline"
                        disabled={!row.eligible || matches.isFetching}
                        onClick={() => {
                          setCoverSelection(null);
                          setSelection(`${row.voucherId}:${row.lineId}`);
                        }}
                      >
                        {sv ? "Välj" : "Choose"}
                      </Button>,
                    ],
                  }))}
                />
              ) : (
                <PageEmpty
                  title={
                    sv ? "Ingen bokförd transaktion att matcha" : "No posted transaction to match"
                  }
                  detail={
                    sv
                      ? "Bokför transaktionen och kom tillbaka till kontot för att matcha den."
                      : "Post the transaction, then return to this account to match it."
                  }
                />
              )}
              {data.candidates.length > visible ? (
                <Box>
                  <Button variant="ghost" onClick={() => setVisible(visible + 25)}>
                    {sv ? "Visa fler transaktioner" : "Show more transactions"}
                  </Button>
                </Box>
              ) : null}
            </RecordSection>
          )}
        </>
      ) : null}
    </Box>
  );

  const pair = bankAmbiguousPair(data, !!selectedCover);

  return pair ? (
    <AmbiguousMatch
      {...props}
      {...pair}
      current={!matches.isFetching}
      fallback={standardReview}
      onChoose={(candidate) => setSelection(`${candidate.voucherId}:${candidate.lineId}`)}
    />
  ) : (
    standardReview
  );
}

function bankAmbiguousPair(
  data: typeof Candidates.BankMatchCandidates.Type | undefined,
  coverSelected: boolean,
) {
  if (
    !data ||
    coverSelected ||
    !data.source.eligible ||
    data.eligibleCount !== 2 ||
    data.equalAmountEligibleCount !== 2
  )
    return null;

  const eligible = data.candidates.filter((candidate) => candidate.eligible);
  const [first, second] = eligible;

  if (
    !first ||
    !second ||
    eligible.length !== 2 ||
    eligible.some((candidate) => candidate.referenceComparison !== "unavailable")
  )
    return null;

  return { data, candidates: [first, second] satisfies [typeof first, typeof second] };
}

function AmbiguousMatch(
  props: Props & {
    data: typeof Candidates.BankMatchCandidates.Type;
    candidates: [
      typeof Candidates.BankMatchCandidate.Type,
      typeof Candidates.BankMatchCandidate.Type,
    ];
    current: boolean;
    fallback: React.ReactNode;
    onChoose: (candidate: typeof Candidates.BankMatchCandidate.Type) => void;
  },
) {
  const { book, locale, data, candidates } = props;
  const sv = locale === "sv";
  const first = useBankMatchDocument({ book, locale, selection: candidates[0] });
  const second = useBankMatchDocument({ book, locale, selection: candidates[1] });

  if (
    first.isError ||
    second.isError ||
    (first.isSuccess && !first.data.document?.source) ||
    (second.isSuccess && !second.data.document?.source)
  )
    return props.fallback;

  const documents = [first.data, second.data];
  const amount = `${formatMinorAmount(candidates[0].remainingMinor, data.currencyScale, locale)} ${data.currency}`;

  return (
    <BankEvidenceReview
      bank={<MatchBankSource {...props} data={data} />}
      original={
        <BankReviewOriginalPlaceholder>
          {sv
            ? "Välj Granska vid ett underlag för att läsa originalet."
            : "Choose Review beside a document to read the original."}
        </BankReviewOriginalPlaceholder>
      }
      decision={
        <>
          <BankReviewSection>
            <BankReviewCaption>
              {sv ? "FLERA MÖJLIGA KOPPLINGAR" : "MULTIPLE POSSIBLE LINKS"}
            </BankReviewCaption>
            <BankReviewHeading title={sv ? "Välj underlag" : "Choose evidence"} />
            <Box display="grid" gap="sm">
              {candidates.map((candidate, index) => (
                <BankReviewCandidateCard
                  key={`${candidate.voucherId}:${candidate.lineId}`}
                  title={candidate.description}
                  amount={`${formatMinorAmount(candidate.remainingMinor, data.currencyScale, locale)} ${data.currency}`}
                  detail={`${documents[index]?.document?.fields?.supplierName ?? ""}, ${bankReviewDate(candidate.postedOn, locale, false)}`}
                  identity={`${sv ? "Verifikation" : "Voucher"} ${documents[index]?.voucher.number ?? ""}, ${candidate.description}`}
                  disabled={!props.current || !documents[index]}
                  onReview={() => props.onChoose(candidate)}
                  action={sv ? "Granska" : "Review"}
                />
              ))}
            </Box>
          </BankReviewSection>
          <Box display="grid" gap="md">
            <BankReviewSectionTitle>
              {sv ? "Varför behöver detta granskas?" : "Why does this need review?"}
            </BankReviewSectionTitle>
            <Text variant="control">
              {sv ? `Båda raderna har ${amount} kvar.` : `Both lines have ${amount} remaining.`}
            </Text>
            <Text variant="control">
              {sv
                ? "Samma belopp räcker inte för att välja underlag."
                : "The same amount is not enough to choose evidence."}
            </Text>
            <Text variant="control" tone="muted">
              {sv
                ? "Lika belopp och datum bevisar inte samma transaktion. Ingen jämförbar fakturareferens finns."
                : "Equal amounts and dates do not prove the same transaction. No comparable invoice reference is available."}
            </Text>
            <BankReviewWarning>
              {sv
                ? "Två bokförda rader har samma belopp. Ingen koppling har valts."
                : "Two posted lines have the same amount. No link has been selected."}
            </BankReviewWarning>
          </Box>
          <BankReviewFooter>
            <BankReviewCaption>
              {sv
                ? "Välj underlag innan du förbereder matchningen."
                : "Choose evidence before preparing a match."}
            </BankReviewCaption>
            <BankReviewSubmit disabled>
              {sv ? "Förbered matchning" : "Prepare match"}
            </BankReviewSubmit>
            <BankReviewTextAction onClick={props.onClose}>
              {sv ? "Lämna i granskning" : "Leave in review"}
            </BankReviewTextAction>
          </BankReviewFooter>
        </>
      }
    />
  );
}

function selectedBankCover(
  data: typeof Candidates.BankMatchCandidates.Type | undefined,
  selection: { digest: string; index: number } | null,
) {
  if (!data || !selection || selection.digest !== data.digest) return undefined;

  return data.coverSearch.covers[selection.index];
}

function ExactCoverChoices({
  data,
  locale,
  current,
  onChoose,
}: {
  data: typeof Candidates.BankMatchCandidates.Type;
  locale: Props["locale"];
  current: boolean;
  onChoose: (index: number) => void;
}) {
  const sv = locale === "sv";
  const [visible, setVisible] = useState(10);
  const search = data.coverSearch;

  const status = {
    unique_within_declared_pool: sv
      ? "En exakt kombination inom sökområdet"
      : "One exact combination within the search scope",
    ambiguous: sv
      ? "Flera likvärdiga exakta kombinationer"
      : "Several equally ranked exact combinations",
    no_match_within_declared_pool: sv
      ? "Ingen exakt kombination inom sökgränserna"
      : "No exact combination within the search limits",
    incomplete_search: sv
      ? "Sökningen är ofullständig. Fler kombinationer kan finnas."
      : "Search is incomplete. More combinations may exist.",
    unavailable: sv
      ? "Exakt kombinationssökning är inte tillgänglig för transaktionen."
      : "Exact combination search is unavailable for this transaction.",
  }[search.status];

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text role="status">{status}</Text>
      <BankReviewCaption>
        {sv
          ? `Sökområde: ${data.window.startsOn}–${data.window.endsOn}. ${search.searchedCount} av ${search.populationCount} möjliga rader, högst ${search.limits.maxSetSize} rader per kombination. Ingen matchning sparas när du väljer.`
          : `Search scope: ${data.window.startsOn}–${data.window.endsOn}. ${search.searchedCount} of ${search.populationCount} eligible lines, at most ${search.limits.maxSetSize} lines per combination. Choosing does not save a match.`}
      </BankReviewCaption>
      {!data.coverConflicts.completeWithinStatement ? (
        <Text>
          {sv
            ? "Kontrollen mot andra banktransaktioner är ofullständig."
            : "The check against other bank entries is incomplete."}
        </Text>
      ) : null}
      {search.covers.slice(0, visible).map((cover, index) => {
        const conflicts = data.coverConflicts.conflicts.filter(
          (conflict) => conflict.coverIndex === index,
        );

        return (
          <Box
            key={cover.legs.map((leg) => `${leg.voucherId}:${leg.lineId}`).join("/")}
            display="grid"
            gap="sm"
            padding="md"
            borderWidth="thin"
            borderColor="default"
            borderRadius="surface"
            minWidth="zero"
          >
            {cover.legs.map((leg) => {
              const line = data.candidates.find(
                (candidate) =>
                  candidate.voucherId === leg.voucherId && candidate.lineId === leg.lineId,
              );

              return (
                <Text key={`${leg.voucherId}:${leg.lineId}`}>
                  {line?.postedOn}, {line?.description},{" "}
                  {formatMinorAmount(leg.amountMinor, data.currencyScale, locale)} {data.currency}
                </Text>
              );
            })}
            <Text>
              {sv ? "Totalt" : "Total"}:{" "}
              {formatMinorAmount(cover.totalMinor, data.currencyScale, locale)} {data.currency},{" "}
              {sv ? "Kvar" : "Left over"}: 0
            </Text>
            {conflicts.length ? (
              <Text>
                {sv
                  ? `Delar bokförda rader med kontoutdragets rader ${conflicts.map((conflict) => conflict.rowOrdinal).join(", ")}. Granska alternativen innan du matchar.`
                  : `Shares posted lines with statement rows ${conflicts.map((conflict) => conflict.rowOrdinal).join(", ")}. Review the alternatives before matching.`}
              </Text>
            ) : null}
            <Box>
              <Button
                variant="outline"
                disabled={!current || !data.source.eligible}
                onClick={() => onChoose(index)}
              >
                {sv ? `Granska kombination ${index + 1}` : `Review combination ${index + 1}`}
              </Button>
            </Box>
          </Box>
        );
      })}
      {search.covers.length > visible ? (
        <Box>
          <Button variant="ghost" onClick={() => setVisible(visible + 10)}>
            {sv ? "Visa fler kombinationer" : "Show more combinations"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function MatchChoice(
  props: Props & {
    data: typeof Candidates.BankMatchCandidates.Type;
    candidate?: typeof Candidates.BankMatchCandidate.Type;
    cover?: (typeof Candidates.BankMatchCandidates.Type)["coverSearch"]["covers"][number];
    current: boolean;
    onBack: () => void;
    refreshCandidates: () => Promise<typeof Candidates.BankMatchCandidates.Type>;
  },
) {
  const { data, candidate, cover, locale } = props;
  const sv = locale === "sv";
  const sourceAmount = BigInt(data.source.remainingMinor);
  const lineAmount = BigInt(candidate?.remainingMinor ?? "0");
  const limit = abs(sourceAmount) < abs(lineAmount) ? abs(sourceAmount) : abs(lineAmount);
  const initial = (sourceAmount < 0n ? -limit : limit).toString();

  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    cover
      ? Object.fromEntries(
          cover.legs.map((leg) => [
            `${leg.voucherId}:${leg.lineId}`,
            minorToDecimal(leg.amountMinor, data.currencyScale),
          ]),
        )
      : candidate
        ? {
            [`${candidate.voucherId}:${candidate.lineId}`]: minorToDecimal(
              initial,
              data.currencyScale,
            ).replace(".", sv ? "," : "."),
          }
        : {},
  );

  const [reviewedDigest, setReviewedDigest] = useState<string | null>(null);
  const acknowledged = reviewedDigest === data.digest;
  const [originalReady, setOriginalReady] = useState(false);
  const [reason, setReason] = useState("");

  const original = useBankMatchOriginal({
    book: props.book,
    locale,
    selection: candidate,
  });

  const originalAvailable =
    original.isSuccess && !original.isFetching && (original.data.source === null || originalReady);

  const chosen = data.candidates.filter((item) => `${item.voucherId}:${item.lineId}` in amounts);

  const legs = chosen.map((item) => ({
    statementId: data.source.statementId,
    rowOrdinal: data.source.rowOrdinal,
    voucherId: item.voucherId,
    lineId: item.lineId,
    amountMinor: signedDecimalToMinor(
      amounts[`${item.voucherId}:${item.lineId}`] ?? "",
      data.currencyScale,
    ),
  }));

  const valid =
    legs.length > 0 &&
    legs.length <= 100 &&
    legs.every((leg) => {
      const posted = chosen.find(
        (item) => item.voucherId === leg.voucherId && item.lineId === leg.lineId,
      );

      return (
        posted?.eligible &&
        leg.amountMinor !== null &&
        BigInt(leg.amountMinor) !== 0n &&
        abs(BigInt(leg.amountMinor)) <= abs(BigInt(posted.remainingMinor)) &&
        BigInt(leg.amountMinor) > 0n === sourceAmount > 0n
      );
    }) &&
    abs(legs.reduce((sum, leg) => sum + BigInt(leg.amountMinor ?? "0"), 0n)) <= abs(sourceAmount);

  const initialCapacity = useRef({
    source: data.source.remainingMinor,
    candidate: candidate?.remainingMinor,
  });

  const reviewState = bankReviewState({
    refused: original.isError,
    initial: initialCapacity.current,
    source: data.source.remainingMinor,
    candidate: candidate?.remainingMinor,
    ready: bankReviewReady(valid, acknowledged, reason, originalAvailable),
  });

  const form = (
    <CommandForm
      {...props}
      compact
      presentation={candidate ? "bank" : undefined}
      submitCaption={bankReviewCaption(reviewState, sv)}
      afterSubmit={<MatchLeaveAction enabled={!!candidate} sv={sv} onClose={props.onClose} />}
      recoveryId={`${data.source.statementId}:${data.source.rowOrdinal}`}
      path={`${bookPath(props.book)}/bank-allocation-plans`}
      schema={Settlement.PrepareBankAllocation}
      output={Settlement.BankAllocationPlan}
      executeRequest={(request, retain, replay) =>
        submitBankWithCitationRefresh({
          path: `${bookPath(props.book)}/bank-allocation-plans`,
          output: Settlement.BankAllocationPlan,
          request,
          retain,
          optionSetDigest: data.optionSetDigest,
          refreshAllowed: !replay,
          refresh: props.refreshCandidates,
        })
      }
      label={sv ? "Förbered matchning" : "Prepare match"}
      allowed={props.current && data.source.eligible}
      canSubmit={valid && acknowledged && !!reason.trim() && (!candidate || originalAvailable)}
      input={(fields) => ({
        accountId: data.window.accountId,
        presentedSuggestionIds: [data.suggestionRecordId],
        reason: fields.get("reason"),
        ambiguityAcknowledged: acknowledged,
        legs,
      })}
      onSuccess={(plan) => props.onPlan(plan.id)}
    >
      <MatchAmountInput
        data={data}
        locale={locale}
        candidate={candidate}
        amounts={amounts}
        onAmounts={(next) => {
          setAmounts(next);
          setReviewedDigest(null);
        }}
      />

      {!valid && !candidate ? (
        <Text role="alert">
          {sv
            ? "Ange ett belopp som ryms inom båda transaktionernas återstående belopp."
            : "Enter an amount within both transactions’ remaining balances."}
        </Text>
      ) : null}
      <BankReviewReason
        label={
          sv ? "Varför hör transaktionerna ihop?" : "Why do these transactions belong together?"
        }
        value={reason}
        onChange={(value) => {
          setReason(value);
          setReviewedDigest(null);
        }}
      />
      <BankReviewAcknowledgment
        label={
          sv
            ? "Jag har jämfört transaktionerna och kontrollerat underlaget."
            : "I have compared the transactions and checked the evidence."
        }
        checked={acknowledged}
        onChange={(checked) => setReviewedDigest(checked ? data.digest : null)}
      />
      {!candidate ? (
        <BankReviewCaption>
          {sv
            ? "Förberedelsen bokför inget. Planen granskas och godkänns separat."
            : "Preparation posts nothing. The plan is reviewed and approved separately."}
        </BankReviewCaption>
      ) : null}
    </CommandForm>
  );

  if (!candidate)
    return <RecordSection title={sv ? "Granska matchning" : "Review match"}>{form}</RecordSection>;

  return (
    <BankEvidenceReview
      bank={<MatchBankSource {...props} data={data} />}
      original={
        <BankMatchOriginal
          key={`${candidate.voucherId}:${candidate.lineId}`}
          book={props.book}
          locale={locale}
          query={original}
          onAvailabilityChange={setOriginalReady}
        />
      }
      decision={
        <>
          <MatchProposal
            book={props.book}
            candidate={candidate}
            data={data}
            locale={locale}
            onBack={props.onBack}
            changed={reviewState === "changed"}
          />
          <MatchExplanation candidate={candidate} sv={sv} state={reviewState} />
          <MatchReviewForm refused={original.isError} sv={sv} form={form} onClose={props.onClose} />
        </>
      }
    />
  );
}

type BankReviewState = "review" | "ready" | "refused" | "changed" | "prepared";

function bankReviewReady(
  valid: boolean,
  acknowledged: boolean,
  reason: string,
  originalAvailable: boolean,
) {
  return valid && acknowledged && !!reason.trim() && originalAvailable;
}

function bankReviewState(props: {
  refused: boolean;
  initial: { source: string; candidate?: string };
  source: string;
  candidate?: string;
  ready: boolean;
}): BankReviewState {
  if (props.refused) return "refused";

  if (
    !props.ready &&
    (props.initial.source !== props.source || props.initial.candidate !== props.candidate)
  )
    return "changed";

  return props.ready ? "ready" : "review";
}

function bankReviewCaption(state: BankReviewState, sv: boolean) {
  if (state === "changed")
    return sv
      ? "Kontrollera beloppet och bekräfta granskningen igen."
      : "Check the amount and confirm the review again.";

  if (state === "ready")
    return sv
      ? "Förberedelsen bokför inget. Planen granskas och godkänns separat."
      : "Preparation posts nothing. The plan is reviewed and approved separately.";

  return sv
    ? "Ange en motivering och bekräfta granskningen."
    : "Enter a reason and confirm the review.";
}

function MatchReviewWarning({ state, sv }: { state: BankReviewState; sv: boolean }) {
  if (state === "changed")
    return (
      <BankReviewWarning destructive>
        {sv
          ? "Kvar att matcha ändrades medan du granskade. Inget förbereddes."
          : "The remaining amount changed during review. Nothing was prepared."}
      </BankReviewWarning>
    );

  if (state !== "review" && state !== "ready") return null;

  return (
    <BankReviewWarning>
      {sv
        ? "Granska underlaget. Källtäckning är inte fastställd."
        : "Review the evidence. Source coverage is not established."}
    </BankReviewWarning>
  );
}

function MatchReviewForm({
  refused,
  sv,
  form,
  onClose,
}: {
  refused: boolean;
  sv: boolean;
  form: ReactNode;
  onClose: () => void;
}) {
  if (!refused) return form;

  return (
    <BankReviewFooter>
      <BankReviewCaption>
        {sv
          ? "Originalet måste kunna granskas innan du förbereder matchningen."
          : "The original must be reviewable before preparing the match."}
      </BankReviewCaption>
      <BankReviewSubmit disabled>{sv ? "Förbered matchning" : "Prepare match"}</BankReviewSubmit>
      <MatchLeaveAction enabled sv={sv} onClose={onClose} />
    </BankReviewFooter>
  );
}

function MatchLeaveAction({
  enabled,
  sv,
  onClose,
}: {
  enabled: boolean;
  sv: boolean;
  onClose: () => void;
}) {
  if (!enabled) return null;

  return (
    <BankReviewTextAction type="button" onClick={onClose}>
      {sv ? "Lämna i granskning" : "Leave in review"}
    </BankReviewTextAction>
  );
}

function MatchProposal(props: {
  book: Props["book"];
  candidate: typeof Candidates.BankMatchCandidate.Type;
  data: typeof Candidates.BankMatchCandidates.Type;
  locale: Props["locale"];
  onBack?: () => void;
  prepared?: boolean;
  changed?: boolean;
}) {
  const { candidate, data, locale, onBack } = props;
  const sv = locale === "sv";
  const document = useBankMatchDocument({ book: props.book, locale, selection: candidate });

  return (
    <BankReviewSection>
      <BankReviewCaption>
        {props.prepared
          ? sv
            ? "FÖRBEREDD MATCHNING"
            : "PREPARED MATCH"
          : sv
            ? "FÖRESLAGEN KOPPLING"
            : "PROPOSED LINK"}
      </BankReviewCaption>
      <BankReviewHeading title={candidate.description} />
      {document.data?.document?.fields?.supplierName ? (
        <Text variant="control" tone="muted">
          {document.data.document.fields.supplierName}
        </Text>
      ) : null}
      <BankReviewFacts>
        <BankReviewFact
          label={`${sv ? "Verifikation" : "Voucher"} ${document.data?.voucher.number ?? ""}, ${bankReviewDate(candidate.postedOn, locale, false)}`}
        >
          {formatMinorAmount(candidate.amountMinor, data.currencyScale, locale)} {data.currency}
        </BankReviewFact>
        <BankReviewFact label={sv ? "Kvar att matcha" : "Remaining"}>
          <Text variant="control" weight={props.changed ? "semibold" : undefined}>
            {formatMinorAmount(candidate.remainingMinor, data.currencyScale, locale)}{" "}
            {data.currency}
          </Text>
        </BankReviewFact>
      </BankReviewFacts>
      {onBack ? (
        <BankReviewTextAction onClick={onBack}>
          {sv ? "Välj en annan transaktion" : "Choose another transaction"}
        </BankReviewTextAction>
      ) : null}
    </BankReviewSection>
  );
}

function MatchBankSource(props: Props & { data: typeof Candidates.BankMatchCandidates.Type }) {
  const { data, locale } = props;
  const sv = locale === "sv";

  return (
    <BankReviewSection bank>
      <BankReviewCaption>
        {sv
          ? `BANKHÄNDELSE, ${BigInt(data.source.amountMinor) < 0n ? "UTBETALNING" : "INBETALNING"}`
          : "BANK ENTRY"}
      </BankReviewCaption>
      <BankReviewHeading
        title={data.source.description}
        amount={`${formatMinorAmount(data.source.amountMinor, data.currencyScale, locale)} ${data.currency}`}
        metadata={
          <>
            <span>{bankReviewDate(data.source.observedOn, locale)}</span>
            {props.accountLabel ? <span>{props.accountLabel}</span> : null}
            {data.source.providerId === null ? (
              <span>{sv ? "Manuellt kontoutdrag" : "Manual statement"}</span>
            ) : null}
          </>
        }
      />
      <BankSourceStatementLink
        book={props.book}
        locale={locale}
        statementId={data.source.statementId}
        presentation="bank-review"
      />
    </BankReviewSection>
  );
}

function bankReviewDate(value: string, locale: Props["locale"], year = true) {
  return new Date(`${value}T12:00:00Z`)
    .toLocaleDateString(locale === "sv" ? "sv-SE" : "en-GB", {
      day: "numeric",
      month: "short",
      year: year ? "numeric" : undefined,
    })
    .replaceAll(".", "");
}

function MatchAmountInput(props: {
  data: typeof Candidates.BankMatchCandidates.Type;
  locale: Props["locale"];
  candidate?: typeof Candidates.BankMatchCandidate.Type;
  amounts: Record<string, string>;
  onAmounts: (amounts: Record<string, string>) => void;
}) {
  const { candidate } = props;

  if (!candidate) return <MatchLineChoices {...props} />;

  const key = `${candidate.voucherId}:${candidate.lineId}`;

  const entered = signedDecimalToMinor(props.amounts[key] ?? "", props.data.currencyScale);
  const sourceCapacity = abs(BigInt(props.data.source.remainingMinor));
  const candidateCapacity = abs(BigInt(candidate.remainingMinor));
  const capacity = sourceCapacity < candidateCapacity ? sourceCapacity : candidateCapacity;

  const valid =
    entered !== null &&
    BigInt(entered) !== 0n &&
    abs(BigInt(entered)) <= capacity &&
    BigInt(entered) > 0n === BigInt(props.data.source.remainingMinor) > 0n;

  const sv = props.locale === "sv";

  return (
    <BankReviewAmount
      label={`${props.locale === "sv" ? "Belopp att matcha" : "Amount to match"}, ${props.data.currency}`}
      value={props.amounts[key] ?? ""}
      formattedValue={
        entered === null
          ? undefined
          : formatMinorAmount(entered, props.data.currencyScale, props.locale)
      }
      error={
        valid
          ? undefined
          : sv
            ? `Högst ${formatMinorAmount(capacity.toString(), props.data.currencyScale, props.locale)} ${props.data.currency} av ${BigInt(props.data.source.amountMinor) < 0n ? "utbetalningen" : "inbetalningen"} kan matchas nu. Ändra beloppet eller välj en annan transaktion.`
            : `Up to ${formatMinorAmount(capacity.toString(), props.data.currencyScale, props.locale)} ${props.data.currency} can be matched now. Change the amount or choose another transaction.`
      }
      onChange={(value) => props.onAmounts({ [key]: value })}
    />
  );
}

function MatchExplanation({
  candidate,
  sv,
  state = "prepared",
}: {
  candidate: typeof Candidates.BankMatchCandidate.Type;
  sv: boolean;
  state?: BankReviewState;
}) {
  return (
    <BankReviewSection open={state === "refused"}>
      <BankReviewSectionTitle>
        {sv ? "Varför visas förslaget?" : "Why is this suggested?"}
      </BankReviewSectionTitle>
      {candidate.equalRemainingAmount ? (
        <Text variant="control">
          {sv ? "Återstående belopp är lika." : "Remaining amounts are equal."}
        </Text>
      ) : state === "changed" ? (
        <Text variant="control">
          {sv
            ? "Återstående belopp är inte längre lika."
            : "Remaining amounts are no longer equal."}
        </Text>
      ) : null}
      {candidate.dayDistance === 0 ? (
        <Text variant="control">
          {sv
            ? "Bokföringsdatum och bankdatum är samma dag."
            : "Posting date and bank date are the same day."}
        </Text>
      ) : null}
      <Text variant="control" tone="muted">
        {sv
          ? "Lika belopp och datum bevisar inte samma transaktion."
          : "Equal amounts and dates do not prove the same transaction."}
        {candidate.referenceComparison === "unavailable"
          ? sv
            ? " Ingen jämförbar fakturareferens finns."
            : " No comparable invoice reference is available."
          : ""}
      </Text>
      {state === "refused" ? (
        <BankReviewWarning destructive>
          {sv
            ? "Originalet kan inte granskas. Matchningen kan inte förberedas."
            : "The original cannot be reviewed. The match cannot be prepared."}
        </BankReviewWarning>
      ) : null}
      <MatchReviewWarning state={state} sv={sv} />
    </BankReviewSection>
  );
}

function MatchLineChoices({
  data,
  locale,
  amounts,
  onAmounts,
}: {
  data: typeof Candidates.BankMatchCandidates.Type;
  locale: Props["locale"];
  amounts: Record<string, string>;
  onAmounts: (value: Record<string, string>) => void;
}) {
  const sv = locale === "sv";
  const [visible, setVisible] = useState(25);
  const eligible = data.candidates.filter((item) => item.eligible);

  const shown = eligible.filter(
    (item, index) => index < visible || `${item.voucherId}:${item.lineId}` in amounts,
  );

  return (
    <Box display="grid" gap="md">
      {shown.map((item) => {
        const key = `${item.voucherId}:${item.lineId}`;
        const selected = key in amounts;

        return (
          <Box
            key={key}
            display="flex"
            flexWrap="wrap"
            alignItems="center"
            gap="md"
            padding="md"
            borderWidth="thin"
            borderColor={selected ? "active" : "default"}
            borderRadius="surface"
          >
            <InputField
              type="checkbox"
              label={sv ? `Välj ${item.description}` : `Choose ${item.description}`}
              checked={selected}
              disabled={!selected && Object.keys(amounts).length >= 100}
              onChange={(event) => {
                if (event.target.checked) onAmounts({ ...amounts, [key]: "" });
                else {
                  const next = { ...amounts };
                  delete next[key];
                  onAmounts(next);
                }
              }}
            />
            <Box minWidth="zero" flexGrow>
              <Text>{item.description}</Text>
              <PageCaption>
                {item.postedOn},{" "}
                {formatMinorAmount(item.remainingMinor, data.currencyScale, locale)} {data.currency}{" "}
                {sv ? "kvar" : "remaining"}
              </PageCaption>
            </Box>
            {selected ? (
              <InputField
                label={`${sv ? "Belopp" : "Amount"}, ${item.description}`}
                value={amounts[key] ?? ""}
                inputMode="decimal"
                required
                onChange={(event) => onAmounts({ ...amounts, [key]: event.target.value })}
              />
            ) : null}
          </Box>
        );
      })}
      {eligible.length > visible ? (
        <Box>
          <Button variant="ghost" type="button" onClick={() => setVisible(visible + 25)}>
            {sv ? "Visa fler bokförda rader" : "Show more posted lines"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function MatchingReview(props: Props & { id: string }) {
  const { book, locale, id } = props;
  const sv = locale === "sv";
  const base = `${bookPath(book)}/bank-allocation-plans/${encodeURIComponent(id)}`;
  const [reviewed, setReviewed] = useState(false);
  const [planOpened, setPlanOpened] = useState(false);

  const review = useQuery({
    queryKey: [...bookKey(book), "bank-allocation", id],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        (client) =>
          client.settlements.getBankAllocation({ params: { ...bookScope(book), id: id } }),
        Settlement.BankAllocationView,
        { signal },
      );

      checkScope(book, value.plan.scope);

      if (value.plan.id !== id) throw new Error("Bank matching review identity mismatch");

      if (props.accountId && value.plan.input.accountId !== props.accountId)
        throw new Error("Bank matching account mismatch");

      return value;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const data = review.isSuccess ? review.data : undefined;

  if (
    data &&
    !data.approval &&
    !data.execution &&
    !data.unmatch &&
    !planOpened &&
    data.plan.input.legs.length === 1
  )
    return <PreparedMatch {...props} view={data} onReview={() => setPlanOpened(true)} />;

  const ready =
    !!data?.dependenciesCurrent && !review.isFetching && !data.execution && !data.unmatch;

  const approvalValid =
    !!data?.approval && new Date(data.approval.expiresAt).getTime() > Date.now();

  const money = (value: string) =>
    data
      ? `${formatMinorAmount(value, data.plan.currencyScale, locale)} ${data.plan.currency}`
      : "—";

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={matchingTitle(!!data?.execution, !!data?.unmatch, sv)}
        subtitle={data?.plan.input.reason}
        action={
          <Button
            variant="ghost"
            disabled={review.isFetching}
            onClick={() => void review.refetch()}
          >
            {sv ? "Uppdatera" : "Refresh"}
          </Button>
        }
      />
      <AccountingStatus locale={locale} pending={review.isPending} error={review.error} />
      {data ? (
        <>
          <MatchBadge view={data} approved={approvalValid} locale={locale} />
          {data.plan.snapshot.capacities.map((item, index, capacities) => {
            const sourceRemaining = capacities
              .filter(
                ({ leg }) =>
                  leg.statementId === item.leg.statementId &&
                  leg.rowOrdinal === item.leg.rowOrdinal,
              )
              .reduce(
                (remaining, { leg }) => remaining - BigInt(leg.amountMinor),
                BigInt(item.sourceAmountMinor) - BigInt(item.sourceAllocatedMinor),
              );

            const lineRemaining = capacities
              .filter(
                ({ leg }) => leg.voucherId === item.leg.voucherId && leg.lineId === item.leg.lineId,
              )
              .reduce(
                (remaining, { leg }) => remaining - BigInt(leg.amountMinor),
                BigInt(item.lineAmountMinor) - BigInt(item.lineAllocatedMinor),
              );

            return (
              <RecordSection
                key={`${item.leg.statementId}:${item.leg.rowOrdinal}:${index}`}
                title={`${sv ? "Matchning" : "Match"} ${index + 1}`}
              >
                <MatchingTransactions book={book} locale={locale} capacity={item} />
                <WorkQuestionsEntry
                  book={book}
                  locale={locale}
                  target={{
                    kind: "bank",
                    recordId: item.leg.statementId,
                    rowOrdinal: item.leg.rowOrdinal,
                  }}
                />
                <RecordSummary>
                  <RecordFact label={sv ? "Belopp som matchas" : "Amount to match"}>
                    {money(item.leg.amountMinor)}
                  </RecordFact>
                  <RecordFact
                    label={
                      sv
                        ? "Kvar på banktransaktionen efter matchning"
                        : "Bank transaction after match"
                    }
                  >
                    {money(sourceRemaining.toString())}
                  </RecordFact>
                  <RecordFact
                    label={
                      sv
                        ? "Kvar på bokförd transaktion efter matchning"
                        : "Posted transaction after match"
                    }
                  >
                    {money(lineRemaining.toString())}
                  </RecordFact>
                </RecordSummary>
                <Disclosure label={sv ? "Kontoutdragets underlag" : "Statement evidence"}>
                  <EvidenceInspector
                    book={book}
                    locale={locale}
                    reference={{
                      evidenceId: item.evidenceId,
                      sha256: item.evidenceSha256,
                      locator: `${item.leg.statementId}/${item.leg.rowOrdinal}`,
                    }}
                  />
                </Disclosure>
              </RecordSection>
            );
          })}
          <MatchCompletion {...props} view={data} allocationId={id} />
          {ready && !approvalValid ? (
            <InputField
              label={
                sv
                  ? "Jag har granskat beloppen och kontoutdragets underlag."
                  : "I have reviewed the amounts and statement evidence."
              }
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
          ) : null}
          <CommandForm
            {...props}
            compact
            path={`${base}/approve`}
            recoveryId={id}
            schema={Settlement.ApproveBankAllocation}
            output={Settlement.BankAllocationApproval}
            allowed={ready && !approvalValid}
            canSubmit={reviewed}
            label={sv ? "Godkänn matchning" : "Approve match"}
            input={() => ({ digest: data.plan.digest, version: data.plan.version })}
            onSuccess={() => setReviewed(false)}
          />
          <CommandForm
            {...props}
            compact
            path={`${base}/execute`}
            recoveryId={id}
            schema={Settlement.ExecuteBankAllocation}
            output={Settlement.BankAllocationExecution}
            allowed={ready && approvalValid}
            label={sv ? "Bekräfta matchning" : "Confirm match"}
            input={() => ({
              digest: data.plan.digest,
              version: data.plan.version,
              approvalId: data.approval?.id,
            })}
          />
        </>
      ) : null}
    </Box>
  );
}

function PreparedMatch(
  props: Props & {
    view: typeof Settlement.BankAllocationView.Type;
    onReview: () => void;
  },
) {
  const { book, locale, view } = props;
  const sv = locale === "sv";
  const leg = view.plan.input.legs[0];
  const members = useQuery(coordinationOptions(book));

  const candidates = useQuery({
    queryKey: [...bookKey(book), "bank-match-candidates", leg?.statementId, leg?.rowOrdinal],
    queryFn: async ({ signal }) => {
      if (!leg) throw new Error("Prepared match has no allocation leg");

      const value = await readAccounting(
        (client, requestOptions) =>
          client.bankMatchCandidates.discoverBankMatchCandidates(
            httpRequest(
              Api.groups.bankMatchCandidates.endpoints.discoverBankMatchCandidates,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          ),
        Candidates.BankMatchCandidates,
        {
          method: "POST",
          body: JSON.stringify({ statementId: leg.statementId, rowOrdinal: leg.rowOrdinal }),
          signal,
        },
      );

      checkScope(book, value.scope);

      if (
        value.source.statementId !== leg.statementId ||
        value.source.rowOrdinal !== leg.rowOrdinal
      )
        throw new Error("Prepared match source identity mismatch");

      return value;
    },
    retry: false,
  });

  const original = useBankMatchOriginal({ book, locale, selection: leg });
  const data = candidates.data;

  const candidate = data?.candidates.find(
    (item) => item.voucherId === leg?.voucherId && item.lineId === leg?.lineId,
  );

  const preparer =
    members.data?.members.find((member) => member.id === view.plan.createdBy)?.name ??
    view.plan.createdBy;

  if (!data || !candidate || !leg)
    return (
      <AccountingStatus locale={locale} pending={candidates.isPending} error={candidates.error} />
    );

  return (
    <BankEvidenceReview
      bank={<MatchBankSource {...props} data={data} />}
      original={<BankMatchOriginal book={book} locale={locale} query={original} />}
      decision={
        <>
          <MatchProposal book={book} candidate={candidate} data={data} locale={locale} prepared />
          <MatchExplanation candidate={candidate} sv={sv} />
          <BankReviewPreparedPlan>
            <BankReviewFact
              align="center"
              label={
                <BankReviewSectionTitle>
                  {sv ? "Förberedd plan" : "Prepared plan"}
                </BankReviewSectionTitle>
              }
            >
              <BankReviewWarning caption>
                {sv ? "Väntar på godkännande" : "Waiting for approval"}
              </BankReviewWarning>
            </BankReviewFact>
            <BankReviewFact
              label={
                <Text variant="control" tone="muted">
                  {sv ? "Belopp att matcha" : "Amount to match"}
                </Text>
              }
            >
              {formatMinorAmount(leg.amountMinor, view.plan.currencyScale, locale)}{" "}
              {view.plan.currency}
            </BankReviewFact>
            <BankReviewFact
              label={
                <Text variant="control" tone="muted">
                  {sv ? "Förberedd av" : "Prepared by"}
                </Text>
              }
            >
              {preparer},{" "}
              {new Date(view.plan.createdAt)
                .toLocaleString(sv ? "sv-SE" : "en-GB", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })
                .replaceAll(".", "")}
            </BankReviewFact>
            <Box display="grid" gap="xs" paddingBlockStart="xs">
              <Text variant="control" tone="muted">
                {sv ? "Motivering" : "Reason"}
              </Text>
              <Text variant="control">{view.plan.input.reason}</Text>
            </Box>
          </BankReviewPreparedPlan>
          <BankReviewFooter>
            <BankReviewCaption>
              {sv
                ? "Inget är bokfört. Godkännande och utförande sker separat."
                : "Nothing is posted. Approval and execution happen separately."}
            </BankReviewCaption>
            <BankReviewSubmit onClick={props.onReview}>
              {sv ? "Granska planen" : "Review plan"}
            </BankReviewSubmit>
            <BankReviewTextAction onClick={props.onClose}>
              {sv ? "Tillbaka till händelser" : "Back to entries"}
            </BankReviewTextAction>
          </BankReviewFooter>
        </>
      }
    />
  );
}

function MatchBadge({
  view,
  approved,
  locale,
}: {
  view: typeof Settlement.BankAllocationView.Type;
  approved: boolean;
  locale: Props["locale"];
}) {
  const sv = locale === "sv";

  const label = view.unmatch
    ? sv
      ? "Ångrad"
      : "Undone"
    : view.execution
      ? sv
        ? "Matchad"
        : "Matched"
      : approved
        ? sv
          ? "Godkänd för matchning"
          : "Approved for matching"
        : sv
          ? "Att godkänna"
          : "Needs approval";

  return (
    <Box>
      <Badge variant={view.unmatch ? "warning" : view.execution ? "success" : "secondary"}>
        {label}
      </Badge>
    </Box>
  );
}

function MatchCompletion(
  props: Props & {
    view: typeof Settlement.BankAllocationView.Type;
    allocationId: string;
  },
) {
  const { view, locale, book, allocationId } = props;
  const sv = locale === "sv";

  return (
    <>
      <MatchStatus view={view} locale={locale} />
      {view.unmatch && props.reversalId === view.unmatch.planId ? (
        <RecordSection title={sv ? "Sparad återföring" : "Saved reversal"}>
          <BankUnmatchReview
            book={book}
            id={props.reversalId}
            locale={locale}
            expected={{ allocationId, accountId: props.accountId }}
          />
        </RecordSection>
      ) : null}
      {view.execution && !view.unmatch ? <UndoMatch {...props} /> : null}
    </>
  );
}

function MatchStatus({
  view,
  locale,
}: {
  view: typeof Settlement.BankAllocationView.Type;
  locale: Props["locale"];
}) {
  const sv = locale === "sv";

  if (view.unmatch) return <BankAllocationUnmatchNotice unmatch={view.unmatch} locale={locale} />;

  if (view.execution)
    return (
      <Text role="status">
        {sv
          ? "Matchningen är sparad. Kontots transaktioner och återstående belopp är uppdaterade."
          : "The match is saved. Account transactions and remaining balances have been updated."}
      </Text>
    );

  if (!view.dependenciesCurrent)
    return (
      <Text role="status">
        {sv
          ? "Transaktionerna har ändrats. Öppna banktransaktionen igen och förbered en ny matchning."
          : "The transactions have changed. Reopen the bank transaction and prepare a new match."}
      </Text>
    );

  return null;
}

function UndoMatch(props: Props & { allocationId: string }) {
  const { book, locale, allocationId } = props;
  const sv = locale === "sv";
  const [reason, setReason] = useState("");
  const keys = useCommandKeys();
  const path = `${bookPath(book)}/bank-match-reversal-plans`;

  const prepare = useMutation({
    mutationFn: (explanation: string) =>
      readAccounting(
        (client, requestOptions) =>
          client.bankMatchReversals.prepareBankMatchReversal(
            httpRequest(
              Api.groups.bankMatchReversals.endpoints.prepareBankMatchReversal,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          ),
        Reversal.BankMatchReversalPlan,
        keys.current.options(
          path,
          JSON.stringify({
            target: { kind: "allocation", allocationPlanId: allocationId },
            reason: explanation,
          }),
        ),
      ),
    onSuccess: (plan) => props.onReversal(plan.id),
  });

  return (
    <RecordSection title={sv ? "Ångra matchning" : "Undo match"}>
      <PageCaption>
        {sv
          ? "Förbered en återföring, granska vilka matchningsbelopp som frigörs och godkänn den innan du genomför den. Bokförda verifikationer ändras inte."
          : "Prepare a reversal, review the matching capacity it releases, and approve it before execution. Posted vouchers do not change."}
      </PageCaption>
      {!props.reversalId ? (
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();

            if (reason.trim() && !prepare.isPending) prepare.mutate(reason.trim());
          }}
        >
          <InputField
            label={sv ? "Varför ska matchningen ångras?" : "Why undo this match?"}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            maxLength={2000}
          />
          <Box>
            <Button type="submit" variant="outline" disabled={!reason.trim() || prepare.isPending}>
              {sv ? "Förbered återföring" : "Prepare reversal"}
            </Button>
          </Box>
          <AccountingStatus
            locale={locale}
            pending={prepare.isPending}
            error={prepare.error}
            write
          />
          {prepare.isError ? (
            <Box>
              <Button type="button" variant="ghost" onClick={() => prepare.mutate(reason.trim())}>
                {sv ? "Försök igen med samma begäran" : "Retry the same request"}
              </Button>
            </Box>
          ) : null}
        </Box>
      ) : null}
      {props.reversalId ? (
        <BankUnmatchReview
          key={props.reversalId}
          book={book}
          id={props.reversalId}
          locale={locale}
          expected={{ allocationId, accountId: props.accountId }}
        />
      ) : null}
    </RecordSection>
  );
}

function matchingTitle(completed: boolean, undone: boolean, sv: boolean) {
  if (undone) return sv ? "Matchningen är ångrad" : "Match undone";

  if (completed) return sv ? "Matchningen är sparad" : "Match saved";

  return sv ? "Bekräfta matchning" : "Confirm match";
}

function MatchingTransactions(
  props: CommerceProps & { capacity: typeof Settlement.AllocationCapacity.Type },
) {
  const { book, locale, capacity } = props;
  const ownerSearch = useSearch({ from: "/entities/$entityId/books/$bookId/accounts" });
  const { leg } = capacity;
  const sv = locale === "sv";

  const records = useQuery({
    queryKey: [
      ...bookKey(book),
      "bank-match-records",
      leg.statementId,
      leg.rowOrdinal,
      leg.voucherId,
      leg.lineId,
    ],
    queryFn: async ({ signal }) => {
      const [statement, voucher] = await Promise.all([
        readAccounting(
          (client) =>
            client.reconciliation.getBankStatement({
              params: { ...bookScope(book), id: leg.statementId },
            }),
          BankStatementView,
          { signal },
        ),
        readAccounting(
          (client) =>
            client.accounting.getVoucher({ params: { ...bookScope(book), id: leg.voucherId } }),
          Voucher,
          {
            signal,
          },
        ),
      ]);

      const source = statement.statement.rows.find((row) => row.rowOrdinal === leg.rowOrdinal);
      const line = voucher.action.lines.find((row) => row.lineId === leg.lineId);

      if (
        statement.statement.id !== leg.statementId ||
        voucher.id !== leg.voucherId ||
        !source ||
        !line
      )
        throw new Error("Matching record identity mismatch");

      return { source, line, voucher };
    },
    retry: false,
  });

  return (
    <>
      <AccountingStatus locale={locale} pending={records.isPending} error={records.error} />
      {records.isSuccess ? (
        <RecordColumns>
          <Box display="grid" gap="sm">
            <PageCaption>
              {sv ? "Banktransaktion" : "Bank transaction"}, {capacity.observedOn}
            </PageCaption>
            <Text>{records.data.source.description}</Text>
            <BankSourceStatementLink book={book} locale={locale} statementId={leg.statementId} />
          </Box>
          <Box display="grid" gap="sm">
            <PageCaption>
              {sv ? "Bokförd transaktion" : "Posted transaction"}, {capacity.postedOn}
            </PageCaption>
            <Text>{records.data.line.description}</Text>
            <Box>
              <PageAction
                quiet
                href={`${workspacePath(book)}/books${defaultStringifySearch({ view: "vouchers", record: leg.voucherId, returnTo: encodeOwnerReturn({ owner: "bank", search: ownerSearch }) })}`}
              >
                {sv ? "Visa verifikation" : "View voucher"} {records.data.voucher.action.series}
                {records.data.voucher.number}
              </PageAction>
            </Box>
          </Box>
        </RecordColumns>
      ) : null}
    </>
  );
}

function BankSourceStatementLink(
  props: CommerceProps & { statementId: string; presentation?: "bank-review" },
) {
  const ownerSearch = useSearch({ from: "/entities/$entityId/books/$bookId/accounts" });
  const copy = accountingCopy(props.locale);

  const href = `${workspacePath(props.book)}/accounts${defaultStringifySearch({
    ...ownerSearch,
    view: "bank",
    record: `statement:${props.statementId}`,
    statement: undefined,
    row: undefined,
    plan: undefined,
    undo: undefined,
    returnTo: encodeOwnerReturn({ owner: "bank", search: ownerSearch }),
  })}`;

  return props.presentation === "bank-review" ? (
    <BankReviewLink href={href}>
      {props.locale === "sv" ? "Öppna kontoutdrag" : "Open statement"}
    </BankReviewLink>
  ) : (
    <PageAction quiet href={href}>
      {copy.bank_statement}
    </PageAction>
  );
}
