import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import * as Settlement from "@open-erp/contracts/settlements";
import { Voucher } from "@open-erp/contracts/accounting";
import { BankStatementView } from "@open-erp/contracts/reconciliation";
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

type Props = CommerceProps & {
  statementId?: string;
  rowOrdinal: number;
  planId?: string;
  onPlan: (id: string) => void;
};
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
  const [visible, setVisible] = useState(25);
  const matches = useQuery({
    queryKey: [...bookKey(book), "bank-match-candidates", statementId, rowOrdinal],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(
        `${bookPath(book)}/bank-match-candidates`,
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
  const copy = bankCandidateCopy(locale);
  const money = (value: string) =>
    data ? `${formatMinorAmount(value, data.currencyScale, locale)} ${data.currency}` : "—";
  return (
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
          {selected ? (
            <MatchChoice
              {...props}
              key={selection}
              data={data}
              candidate={selected}
              current={!matches.isFetching}
              onBack={() => setSelection(null)}
            />
          ) : (
            <RecordSection title={sv ? "Välj bokförd transaktion" : "Choose a posted transaction"}>
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
                        onClick={() => setSelection(`${row.voucherId}:${row.lineId}`)}
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
}

function MatchChoice(
  props: Props & {
    data: typeof Candidates.BankMatchCandidates.Type;
    candidate: typeof Candidates.BankMatchCandidate.Type;
    current: boolean;
    onBack: () => void;
  },
) {
  const { data, candidate, locale } = props;
  const sv = locale === "sv";
  const sourceAmount = BigInt(data.source.remainingMinor);
  const lineAmount = BigInt(candidate.remainingMinor);
  const abs = (amount: bigint) => (amount < 0n ? -amount : amount);
  const limit = abs(sourceAmount) < abs(lineAmount) ? abs(sourceAmount) : abs(lineAmount);
  const initial = (sourceAmount < 0n ? -limit : limit).toString();
  const [amount, setAmount] = useState(minorToDecimal(initial, data.currencyScale));
  const [acknowledged, setAcknowledged] = useState(false);
  const entered = signedDecimalToMinor(amount, data.currencyScale);
  const valid =
    entered !== null &&
    BigInt(entered) !== 0n &&
    abs(BigInt(entered)) <= limit &&
    BigInt(entered) > 0n === sourceAmount > 0n;
  const money = (value: string) =>
    `${formatMinorAmount(value, data.currencyScale, locale)} ${data.currency}`;
  return (
    <RecordSection title={sv ? "Granska matchning" : "Review match"}>
      <Box>
        <Button variant="ghost" onClick={props.onBack}>
          {sv ? "Välj en annan transaktion" : "Choose another transaction"}
        </Button>
      </Box>
      <RecordHeading
        title={candidate.description}
        subtitle={`${candidate.postedOn} · ${money(candidate.amountMinor)}`}
      />
      <CommandForm
        {...props}
        compact
        recoveryId={`${data.source.statementId}:${data.source.rowOrdinal}`}
        path={`${bookPath(props.book)}/bank-allocation-plans`}
        schema={Settlement.PrepareBankAllocation}
        output={Settlement.BankAllocationPlan}
        label={sv ? "Förbered matchning" : "Prepare match"}
        allowed={props.current && candidate.eligible && data.source.eligible}
        canSubmit={valid && acknowledged}
        input={(fields) => ({
          accountId: data.window.accountId,
          reason: fields.get("reason"),
          ambiguityAcknowledged: acknowledged,
          legs: [
            {
              statementId: data.source.statementId,
              rowOrdinal: data.source.rowOrdinal,
              voucherId: candidate.voucherId,
              lineId: candidate.lineId,
              amountMinor: entered,
            },
          ],
        })}
        onSuccess={(plan) => props.onPlan(plan.id)}
      >
        <InputField
          label={`${sv ? "Belopp att matcha" : "Amount to match"} (${data.currency})`}
          name="amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          required
        />
        {!valid ? (
          <Text role="alert">
            {sv
              ? "Ange ett belopp som ryms inom båda transaktionernas återstående belopp."
              : "Enter an amount within both transactions’ remaining balances."}
          </Text>
        ) : null}
        <InputField
          label={
            sv ? "Varför hör transaktionerna ihop?" : "Why do these transactions belong together?"
          }
          name="reason"
          required
          maxLength={2000}
        />
        <InputField
          label={
            sv
              ? "Jag har jämfört transaktionerna och kontrollerat underlaget."
              : "I have compared the transactions and checked the evidence."
          }
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
      </CommandForm>
    </RecordSection>
  );
}

function MatchingReview(props: Props & { id: string }) {
  const { book, locale, id } = props;
  const sv = locale === "sv";
  const base = `${bookPath(book)}/bank-allocation-plans/${encodeURIComponent(id)}`;
  const [reviewed, setReviewed] = useState(false);
  const review = useQuery({
    queryKey: [...bookKey(book), "bank-allocation", id],
    queryFn: async ({ signal }) => {
      const value = await readAccounting(base, Settlement.BankAllocationView, { signal });
      checkScope(book, value.plan.scope);
      if (value.plan.id !== id) throw new Error("Bank matching review identity mismatch");
      return value;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const data = review.isSuccess ? review.data : undefined;
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
        title={matchingTitle(!!data?.execution, sv)}
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
          <Box>
            <Badge variant={data.execution ? "success" : "secondary"}>
              {data.execution
                ? sv
                  ? "Matchad"
                  : "Matched"
                : approvalValid
                  ? sv
                    ? "Godkänd för matchning"
                    : "Approved for matching"
                  : sv
                    ? "Att godkänna"
                    : "Needs approval"}
            </Badge>
          </Box>
          {data.plan.snapshot.capacities.map((item, index) => (
            <RecordSection
              key={`${item.leg.statementId}:${item.leg.rowOrdinal}:${index}`}
              title={`${sv ? "Matchning" : "Match"} ${index + 1}`}
            >
              <MatchingTransactions book={book} locale={locale} capacity={item} />
              <RecordSummary>
                <RecordFact label={sv ? "Belopp som matchas" : "Amount to match"}>
                  {money(item.leg.amountMinor)}
                </RecordFact>
                <RecordFact label={sv ? "Kvar på banktransaktionen" : "Bank transaction remaining"}>
                  {money(
                    (
                      BigInt(item.sourceAmountMinor) -
                      BigInt(item.sourceAllocatedMinor) -
                      BigInt(item.leg.amountMinor)
                    ).toString(),
                  )}
                </RecordFact>
                <RecordFact
                  label={sv ? "Kvar på bokförd transaktion" : "Posted transaction remaining"}
                >
                  {money(
                    (
                      BigInt(item.lineAmountMinor) -
                      BigInt(item.lineAllocatedMinor) -
                      BigInt(item.leg.amountMinor)
                    ).toString(),
                  )}
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
          ))}
          {data.execution ? (
            <Text role="status">
              {sv
                ? "Matchningen är sparad. Kontots transaktioner och återstående belopp är uppdaterade."
                : "The match is saved. Account transactions and remaining balances have been updated."}
            </Text>
          ) : !data.dependenciesCurrent || data.unmatch ? (
            <Text role="status">
              {sv
                ? "Transaktionerna har ändrats. Öppna banktransaktionen igen och förbered en ny matchning."
                : "The transactions have changed. Reopen the bank transaction and prepare a new match."}
            </Text>
          ) : null}
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

function matchingTitle(completed: boolean, sv: boolean) {
  if (completed) return sv ? "Matchningen är sparad" : "Match saved";
  return sv ? "Bekräfta matchning" : "Confirm match";
}

function MatchingTransactions(
  props: CommerceProps & { capacity: typeof Settlement.AllocationCapacity.Type },
) {
  const { book, locale, capacity } = props;
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
          `${bookPath(book)}/bank-statements/${encodeURIComponent(leg.statementId)}`,
          BankStatementView,
          { signal },
        ),
        readAccounting(`${bookPath(book)}/vouchers/${encodeURIComponent(leg.voucherId)}`, Voucher, {
          signal,
        }),
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
              {sv ? "Banktransaktion" : "Bank transaction"} · {capacity.observedOn}
            </PageCaption>
            <Text>{records.data.source.description}</Text>
          </Box>
          <Box display="grid" gap="sm">
            <PageCaption>
              {sv ? "Bokförd transaktion" : "Posted transaction"} · {capacity.postedOn}
            </PageCaption>
            <Text>{records.data.line.description}</Text>
            <Box>
              <PageAction
                quiet
                href={`${workspacePath(book)}/books?view=vouchers&record=${encodeURIComponent(leg.voucherId)}`}
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
