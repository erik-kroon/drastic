import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Candidates from "@open-erp/contracts/bank-match-candidates";
import * as Reversal from "@open-erp/contracts/bank-match-reversals";
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
import { BankUnmatchReview } from "@/components/bank-match-reversals/review";
import { BankAllocationUnmatchNotice } from "@/components/bank-match-reversals/notice";
import { mutationOptions } from "@/lib/accounting-api";

type Props = CommerceProps & {
  statementId?: string;
  rowOrdinal: number;
  planId?: string;
  reversalId?: string;
  accountId?: string;
  onPlan: (id: string) => void;
  onReversal: (id: string) => void;
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
  const [amounts, setAmounts] = useState<Record<string, string>>({
    [`${candidate.voucherId}:${candidate.lineId}`]: minorToDecimal(initial, data.currencyScale),
  });
  const [acknowledged, setAcknowledged] = useState(false);
  const chosen = data.candidates.filter((item) => `${item.voucherId}:${item.lineId}` in amounts);
  const legs = chosen.map((item) => ({
    statementId: data.source.statementId,
    rowOrdinal: data.source.rowOrdinal,
    voucherId: item.voucherId,
    lineId: item.lineId,
    amountMinor: signedDecimalToMinor(amounts[`${item.voucherId}:${item.lineId}`] ?? "", data.currencyScale),
  }));
  const valid = legs.length > 0 && legs.length <= 100 && legs.every((leg) => {
    const posted = chosen.find((item) => item.voucherId === leg.voucherId && item.lineId === leg.lineId);
    return posted?.eligible && leg.amountMinor !== null && BigInt(leg.amountMinor) !== 0n &&
      abs(BigInt(leg.amountMinor)) <= abs(BigInt(posted.remainingMinor)) &&
      (BigInt(leg.amountMinor) > 0n) === (sourceAmount > 0n);
  }) && abs(legs.reduce((sum, leg) => sum + BigInt(leg.amountMinor ?? "0"), 0n)) <= abs(sourceAmount);
  const money = (value: string) =>
    `${formatMinorAmount(value, data.currencyScale, locale)} ${data.currency}`;
  return (
    <RecordSection title={sv ? "Granska matchning" : "Review match"}>
      <Box>
        <Button variant="ghost" onClick={props.onBack}>
          {sv ? "Välj en annan transaktion" : "Choose another transaction"}
        </Button>
      </Box>
      <RecordHeading title={sv ? "Bokförda transaktioner" : "Posted transactions"}
        subtitle={sv ? "Välj en eller flera rader och ange beloppet för varje rad." : "Choose one or more lines and enter an amount for each."} />
      <CommandForm
        {...props}
        compact
        recoveryId={`${data.source.statementId}:${data.source.rowOrdinal}`}
        path={`${bookPath(props.book)}/bank-allocation-plans`}
        schema={Settlement.PrepareBankAllocation}
        output={Settlement.BankAllocationPlan}
        label={sv ? "Förbered matchning" : "Prepare match"}
        allowed={props.current && data.source.eligible}
        canSubmit={valid && acknowledged}
        input={(fields) => ({
          accountId: data.window.accountId,
          reason: fields.get("reason"),
          ambiguityAcknowledged: acknowledged,
          legs,
        })}
        onSuccess={(plan) => props.onPlan(plan.id)}
      >
        <MatchLineChoices data={data} locale={locale} amounts={amounts} onAmounts={setAmounts} />
        <Text>{sv ? "Totalt att matcha" : "Total to match"}: {money(legs.reduce((sum, leg) => sum + BigInt(leg.amountMinor ?? "0"), 0n).toString())}</Text>
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

function MatchLineChoices({ data, locale, amounts, onAmounts }: {
  data: typeof Candidates.BankMatchCandidates.Type;
  locale: Props["locale"];
  amounts: Record<string, string>;
  onAmounts: (value: Record<string, string>) => void;
}) {
  const sv = locale === "sv";
  const [visible, setVisible] = useState(25);
  const eligible = data.candidates.filter((item) => item.eligible);
  const shown = eligible.filter((item, index) => index < visible || `${item.voucherId}:${item.lineId}` in amounts);
  return <Box display="grid" gap="md">
    <DataTable title={sv ? "Välj bokförda rader" : "Choose posted lines"}
      columns={[
        { id: "choice", label: sv ? "Välj" : "Choose" },
        { id: "description", label: sv ? "Transaktion" : "Transaction" },
        { id: "remaining", label: sv ? "Kvar" : "Remaining", numeric: true },
        { id: "amount", label: sv ? "Belopp att matcha" : "Amount to match" },
      ]}
      rows={shown.map((item) => {
        const key = `${item.voucherId}:${item.lineId}`;
        const selected = key in amounts;
        return { id: key, cells: [
          <InputField key="selected" type="checkbox" label={sv ? `Välj ${item.description}` : `Choose ${item.description}`}
            checked={selected} disabled={!selected && Object.keys(amounts).length >= 100}
            onChange={(event) => {
              if (event.target.checked) onAmounts({ ...amounts, [key]: "" });
              else {
                const next = { ...amounts };
                delete next[key];
                onAmounts(next);
              }
            }} />,
          <Box key="description"><Text>{item.description}</Text><PageCaption>{item.postedOn}</PageCaption></Box>,
          `${formatMinorAmount(item.remainingMinor, data.currencyScale, locale)} ${data.currency}`,
          selected ? <InputField key="amount" label={`${sv ? "Belopp" : "Amount"} · ${item.description}`}
            value={amounts[key] ?? ""} inputMode="decimal" required
            onChange={(event) => onAmounts({ ...amounts, [key]: event.target.value })} /> : "—",
        ] };
      })}
    />
    {eligible.length > visible ? <Box><Button variant="ghost" type="button" onClick={() => setVisible(visible + 25)}>
      {sv ? "Visa fler bokförda rader" : "Show more posted lines"}
    </Button></Box> : null}
  </Box>;
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
      if (props.accountId && value.plan.input.accountId !== props.accountId)
        throw new Error("Bank matching account mismatch");
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

function MatchBadge({ view, approved, locale }: {
  view: typeof Settlement.BankAllocationView.Type;
  approved: boolean;
  locale: Props["locale"];
}) {
  const sv = locale === "sv";
  const label = view.unmatch ? (sv ? "Ångrad" : "Undone")
    : view.execution ? (sv ? "Matchad" : "Matched")
    : approved ? (sv ? "Godkänd för matchning" : "Approved for matching")
    : (sv ? "Att godkänna" : "Needs approval");
  return <Box><Badge variant={view.unmatch ? "warning" : view.execution ? "success" : "secondary"}>
    {label}
  </Badge></Box>;
}

function MatchCompletion(props: Props & {
  view: typeof Settlement.BankAllocationView.Type;
  allocationId: string;
}) {
  const { view, locale, book, allocationId } = props;
  const sv = locale === "sv";
  return <>
    <MatchStatus view={view} locale={locale} />
    {view.unmatch && props.reversalId === view.unmatch.planId ?
      <RecordSection title={sv ? "Sparad återföring" : "Saved reversal"}>
        <BankUnmatchReview book={book} id={props.reversalId} locale={locale}
          expected={{ allocationId, accountId: props.accountId }} />
      </RecordSection> : null}
    {view.execution && !view.unmatch ? <UndoMatch {...props} /> : null}
  </>;
}

function MatchStatus({ view, locale }: {
  view: typeof Settlement.BankAllocationView.Type;
  locale: Props["locale"];
}) {
  const sv = locale === "sv";
  if (view.unmatch) return <BankAllocationUnmatchNotice unmatch={view.unmatch} locale={locale} />;
  if (view.execution) return <Text role="status">
    {sv
      ? "Matchningen är sparad. Kontots transaktioner och återstående belopp är uppdaterade."
      : "The match is saved. Account transactions and remaining balances have been updated."}
  </Text>;
  if (!view.dependenciesCurrent) return <Text role="status">
    {sv
      ? "Transaktionerna har ändrats. Öppna banktransaktionen igen och förbered en ny matchning."
      : "The transactions have changed. Reopen the bank transaction and prepare a new match."}
  </Text>;
  return null;
}

function UndoMatch(props: Props & { allocationId: string }) {
  const { book, locale, allocationId } = props;
  const sv = locale === "sv";
  const [reason, setReason] = useState("");
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/bank-match-reversal-plans`;
  const prepare = useMutation({
    mutationFn: (explanation: string) => readAccounting(
      path,
      Reversal.BankMatchReversalPlan,
      mutationOptions(path, JSON.stringify({
        target: { kind: "allocation", allocationPlanId: allocationId },
        reason: explanation,
      }), keys.current),
    ),
    onSuccess: (plan) => props.onReversal(plan.id),
  });
  return <RecordSection title={sv ? "Ångra matchning" : "Undo match"}>
    <PageCaption>
      {sv
        ? "Förbered en återföring, granska vilka matchningsbelopp som frigörs och godkänn den innan du genomför den. Bokförda verifikationer ändras inte."
        : "Prepare a reversal, review the matching capacity it releases, and approve it before execution. Posted vouchers do not change."}
    </PageCaption>
    {!props.reversalId ? <Box as="form" display="grid" gap="md" onSubmit={(event) => {
      event.preventDefault();
      if (reason.trim() && !prepare.isPending) prepare.mutate(reason.trim());
    }}>
      <InputField label={sv ? "Varför ska matchningen ångras?" : "Why undo this match?"}
        value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} />
      <Box><Button type="submit" variant="outline" disabled={!reason.trim() || prepare.isPending}>
        {sv ? "Förbered återföring" : "Prepare reversal"}
      </Button></Box>
      <AccountingStatus locale={locale} pending={prepare.isPending} error={prepare.error} write />
      {prepare.isError ? <Box><Button type="button" variant="ghost" onClick={() => prepare.mutate(reason.trim())}>
        {sv ? "Försök igen med samma begäran" : "Retry the same request"}
      </Button></Box> : null}
    </Box> : null}
    {props.reversalId ? <BankUnmatchReview key={props.reversalId} book={book}
      id={props.reversalId} locale={locale} expected={{ allocationId, accountId: props.accountId }} /> : null}
  </RecordSection>;
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
