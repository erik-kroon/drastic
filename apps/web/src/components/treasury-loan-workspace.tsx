import { bookScope } from "@/lib/contract-client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Loans from "@open-erp/contracts/treasury-loans";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  RetainedActionLayout,
  AssetActionMetadata,
  AssetActionSection,
  AssetActionNote,
  AssetActionActions,
  AssetPostedJournal,
} from "@open-erp/ui/components/asset-action";
import {
  LoanEvidenceButton,
  LoanRateTable,
  LoanSegmentTable,
  LoanCalculationFact,
  LoanCoverageWarning,
} from "@open-erp/ui/components/loan-interest";
import { RecordSheet } from "@open-erp/ui/components/record-sheet";
import { EvidenceInspector } from "./evidence-inspector";
import { AccountingStatus } from "@/components/accounting-status";
import { CommandForm, checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { TreasuryLoanDirectory } from "./treasury-loan-directory";
import {
  loanCoverageLabel,
  loanDate,
  loanDecimal,
  loanRate,
  previousLoanDay,
} from "./treasury-loan-format";

export function TreasuryLoanWorkspace(props: {
  loanId: string;
  reviewId?: string;
  approval?: boolean;
}) {
  const { book, locale, setup } = useBookWorkspace();

  const { loanId, reviewId } = props;

  const query = useQuery({
    queryKey: [...bookKey(book), "treasury-loan", loanId, reviewId],
    retry: false,
    queryFn: async ({ signal }) => {
      const loan = await readAccounting(
        (client) => client.treasuryLoan.getLoan({ params: { ...bookScope(book), id: loanId } }),
        Loans.LoanView,
        { signal },
      );

      checkScope(book, loan.loan.scope);

      if (loan.loan.id !== loanId) throw new Error("Loan identity mismatch");

      const view = reviewId
        ? await readAccounting(
            (client) =>
              client.treasuryLoan.getLoanReview({ params: { ...bookScope(book), id: reviewId } }),
            Loans.LoanReviewView,
            { signal },
          )
        : null;

      if (view) {
        checkScope(book, view.review.scope);

        if (
          view.review.id !== reviewId ||
          view.review.loanId !== loanId ||
          view.review.input.kind !== "accrual"
        )
          throw new Error("Loan accrual review identity mismatch");
      }

      const voucherId = view?.event?.postingReceipt?.voucherId;

      const voucher = voucherId
        ? await readAccounting(
            (client) =>
              client.accounting.getVoucher({
                params: { ...bookScope(book), id: voucherId },
              }),
            Accounting.Voucher,
            { signal },
          )
        : null;

      if (view?.event) {
        checkScope(book, view.event.scope);

        if (
          view.event.loanId !== loanId ||
          view.event.reviewId !== reviewId ||
          (voucher && voucher.id !== view.event.postingReceipt?.voucherId)
        )
          throw new Error("Posted loan lineage mismatch");
      }

      const rates = view
        ? view.review.basis.rateDigests.map((digest) => {
            const rate = loan.rates.find((item) => item.digest === digest);

            if (!rate) throw new Error("Retained loan rate is unavailable");

            return rate;
          })
        : [];

      const evidence = await Promise.all(
        rates.map(async (rate) => {
          const source = await readAccounting(
            (client) =>
              client.accounting.getEvidence({
                params: { ...bookScope(book), id: rate.evidence.evidenceId },
              }),
            Accounting.EvidenceContent,
            { signal },
          );

          if (source.id !== rate.evidence.evidenceId || source.sha256 !== rate.evidence.sha256)
            throw new Error("Loan rate evidence mismatch");

          return { rate, source };
        }),
      );

      return { loan, view, evidence, voucher };
    },
  });

  const saved = query.isError ? undefined : query.data;

  const account = setup.accounts.find((item) => item.id === saved?.loan.loan.principal.accountId);

  const accountLabel = account
    ? `${account.code} ${account.name}`
    : (saved?.loan.loan.principal.accountId ?? "Lån");

  const review = saved?.view?.review;

  const calculation = review?.calculation;

  const backHref = `${workspacePath(book)}/books?view=accounts`;

  const latest = saved?.evidence
    .toSorted((a, b) => a.rate.createdAt.localeCompare(b.rate.createdAt))
    .at(-1);

  const title =
    calculation && review?.input.kind === "accrual" && saved
      ? `Ränta ${loanCoverageLabel(saved.loan.loan.input.coverageStartOn, previousLoanDay(review.input.coverageEndExclusiveOn), locale)} ${saved.view?.event ? "bokförd" : "räknas om"}`
      : accountLabel;

  return (
    <RetainedActionLayout
      title={title}
      trail={[
        { label: "Bokföring", href: `${workspacePath(book)}/books` },
        { label: "Kontoplan", href: backHref },
        { label: accountLabel, href: `${backHref}&loan=${encodeURIComponent(loanId)}` },
        { label: "Förbered ränta" },
      ]}
      synthetic={book.profile === "synthetic-core-v1"}
      draft={!!review && !saved?.view?.event}
      posted={!!saved?.view?.event}
    >
      <AccountingStatus locale={locale} pending={query.isPending} error={query.error} />
      {query.isError ? (
        <Button variant="outline" onClick={() => void query.refetch()}>
          Försök igen
        </Button>
      ) : null}
      {saved && !reviewId ? <TreasuryLoanDirectory key={loanId} loanId={loanId} /> : null}
      {saved && review && calculation && latest ? (
        <LoanInterestResult
          saved={saved}
          review={review}
          calculation={calculation}
          latest={latest}
          loanId={loanId}
          backHref={backHref}
          approval={props.approval}
          onRefresh={() => void query.refetch()}
        />
      ) : null}
    </RetainedActionLayout>
  );
}

type LoanEvidence = {
  rate: typeof Loans.LoanRate.Type;
  source: typeof Accounting.EvidenceContent.Type;
};

function LoanInterestResult(props: {
  saved: {
    loan: typeof Loans.LoanView.Type;
    view: typeof Loans.LoanReviewView.Type | null;
    evidence: LoanEvidence[];
    voucher: typeof Accounting.Voucher.Type | null;
  };
  review: typeof Loans.LoanReview.Type;
  calculation: NonNullable<(typeof Loans.LoanReview.Type)["calculation"]>;
  latest: LoanEvidence;
  loanId: string;
  backHref: string;
  approval?: boolean;
  onRefresh: () => void;
}) {
  const { book, locale, setup } = useBookWorkspace();

  const { saved, review, calculation, latest } = props;

  const [selectedEvidence, setSelectedEvidence] = useState<LoanEvidence>();

  return (
    <>
      <AssetActionMetadata>
        Ny ränta{" "}
        {loanRate(latest.rate.input.rateNumerator, latest.rate.input.rateDenominator, locale)}{" "}
        gäller från {loanDate(latest.rate.input.effectiveOn, locale)} enligt {latest.source.title}.
        Räntan räknas om för hela perioden och bokförs som skillnaden mot det som redan är bokfört.
      </AssetActionMetadata>
      <AssetActionSection>RÄNTESATSER</AssetActionSection>
      <LoanRateTable
        rows={saved.evidence.map(({ rate, source }) => ({
          id: rate.id,
          date: loanDate(rate.input.effectiveOn, locale, true),
          rate: loanRate(rate.input.rateNumerator, rate.input.rateDenominator, locale),
          evidence: (
            <LoanEvidenceButton onClick={() => setSelectedEvidence({ rate, source })}>
              {source.title}
            </LoanEvidenceButton>
          ),
          backdated:
            rate.id === latest.rate.id &&
            review.basis.coverageEndExclusiveOn !== null &&
            rate.input.effectiveOn < review.basis.coverageEndExclusiveOn,
        }))}
      />
      <AssetActionSection>BERÄKNING PER DELPERIOD</AssetActionSection>
      <LoanSegmentTable
        rows={calculation.segments.map((segment, index) => ({
          id: `${index}-${segment.fromOn}`,
          from: loanDate(segment.fromOn, locale),
          through: loanDate(previousLoanDay(segment.toExclusiveOn), locale),
          days: segment.days.toString(),
          principal: formatMinorAmount(segment.principalMinor, 2, locale),
          rate: loanRate(segment.rateNumerator, segment.rateDenominator, locale),
          exact: loanDecimal(
            BigInt(segment.principalMinor) * BigInt(segment.rateNumerator) * BigInt(segment.days),
            BigInt(segment.rateDenominator) *
              (saved.loan.loan.input.convention === "ACT/365F" ? 365n : 360n) *
              100n,
            4,
            locale,
          ),
        }))}
      />
      <LoanCalculationFact
        label={`Summa före avrundning, faktiska dagar delat med ${saved.loan.loan.input.convention === "ACT/365F" ? "365" : "360"}`}
        value={
          calculation.exactTotal
            ? loanDecimal(
                BigInt(calculation.exactTotal.numerator),
                BigInt(calculation.exactTotal.denominator) * 100n,
                4,
                locale,
              )
            : "Okänd"
        }
      />
      <LoanCalculationFact
        label="Avrundad en gång på den sammanlagda summan"
        value={formatMinorAmount(calculation.targetMinor, 2, locale)}
      />
      <LoanCalculationFact
        label="Redan bokfört för perioden"
        value={`−${formatMinorAmount(calculation.priorEffectiveMinor, 2, locale)}`}
      />
      <LoanCalculationFact
        label="Skillnad att bokföra"
        value={formatMinorAmount(calculation.deltaMinor, 2, locale)}
        emphasis
      />
      <AssetActionSection>
        {saved.voucher
          ? `VERIFIKAT ${saved.voucher.action.series}${saved.voucher.number}`
          : saved.view?.event?.noJournal
            ? "INGET VERIFIKAT"
            : "VERIFIKATFÖRSLAG"}
      </AssetActionSection>
      {review.postingPlan ? (
        <AssetPostedJournal
          rows={
            saved.voucher
              ? saved.voucher.action.lines.map((line) => {
                  const account = setup.accounts.find((item) => item.id === line.accountId);

                  return {
                    id: line.lineId,
                    label: account ? `${account.code} ${account.name}` : line.accountId,
                    debit:
                      line.debitMinor === "0" ? "" : formatMinorAmount(line.debitMinor, 2, locale),
                    credit:
                      line.creditMinor === "0"
                        ? ""
                        : formatMinorAmount(line.creditMinor, 2, locale),
                  };
                })
              : review.postingPlan.groups.flatMap((group) =>
                  group.actions.flatMap((action) =>
                    action.lines.map((line) => {
                      const account = setup.accounts.find((item) => item.id === line.accountId);

                      return {
                        id: line.lineId,
                        label: account ? `${account.code} ${account.name}` : line.accountId,
                        debit:
                          line.debitMinor === "0"
                            ? ""
                            : formatMinorAmount(line.debitMinor, 2, locale),
                        credit:
                          line.creditMinor === "0"
                            ? ""
                            : formatMinorAmount(line.creditMinor, 2, locale),
                      };
                    }),
                  ),
                )
          }
          debit=""
          credit=""
          total={false}
        />
      ) : (
        <AssetActionNote>Inget verifikat skapas.</AssetActionNote>
      )}
      <LoanCoverageWarning>
        Långivarens kontoutdrag är inte inläst. Beloppet räknas från avtalet och aviseringen, inte
        från långivarens saldo. Skillnaden mot långivarens uppgift är okänd, inte noll.
      </LoanCoverageWarning>
      {saved.view?.event && !props.approval ? (
        <AssetActionNote status>Bokfört</AssetActionNote>
      ) : props.approval && saved.view ? (
        <LoanApprovalCommands key={review.id} view={saved.view} onRefresh={props.onRefresh} />
      ) : (
        <AssetActionActions>
          <Button
            render={
              <Link
                href={`${props.backHref}&loan=${encodeURIComponent(props.loanId)}&loanReview=${encodeURIComponent(review.id)}&loanApproval=true`}
              />
            }
            nativeButton={false}
          >
            Skicka för godkännande
          </Button>
          <Button variant="outline" render={<Link href={props.backHref} />} nativeButton={false}>
            Avbryt
          </Button>
        </AssetActionActions>
      )}
      <AssetActionNote>
        Godkännandet görs av en person i webbläsaren och gäller i en timme. Blir skillnaden 0,00
        finns inget att bokföra och inget verifikat skapas. En negativ skillnad kräver en angiven
        rättelseorsak.
      </AssetActionNote>
      {selectedEvidence ? (
        <RecordSheet
          title={selectedEvidence.source.title}
          closeLabel="Stäng"
          onClose={() => setSelectedEvidence(undefined)}
        >
          <EvidenceInspector
            book={book}
            locale={locale}
            reference={{
              ...selectedEvidence.rate.evidence,
              locator: selectedEvidence.source.title,
            }}
            expanded
          />
        </RecordSheet>
      ) : null}
    </>
  );
}

function LoanApprovalCommands(props: {
  view: typeof Loans.LoanReviewView.Type;
  onRefresh: () => void;
}) {
  const { book, locale } = useBookWorkspace();

  const [approved, setApproved] = useState<typeof Loans.LoanApproval.Type>();

  const { review, event } = props.view;

  const approval =
    approved ??
    props.view.approvals
      .filter(
        (item) => item.reviewDigest === review.digest && Date.parse(item.expiresAt) > Date.now(),
      )
      .at(-1);

  if (event) return <AssetActionNote status>Bokfört</AssetActionNote>;

  return (
    <AssetActionActions>
      <CommandForm
        book={book}
        locale={locale}
        path={`${bookPath(book)}/treasury/loans/reviews/${encodeURIComponent(review.id)}/approvals`}
        schema={Loans.ApproveLoanReview}
        output={Loans.LoanApproval}
        input={() => ({ digest: review.digest })}
        label="Godkänn"
        compact
        allowed={book.role === "operator"}
        onSuccess={(result) => {
          setApproved(result);
          props.onRefresh();
        }}
        validate={(result) => {
          if (result.reviewId !== review.id || result.reviewDigest !== review.digest)
            throw new Error("Loan approval identity mismatch");
        }}
      />
      <CommandForm
        book={book}
        locale={locale}
        path={`${bookPath(book)}/treasury/loans/reviews/${encodeURIComponent(review.id)}/execute`}
        schema={Loans.ExecuteLoanReview}
        output={Loans.LoanEvent}
        input={() => ({ digest: review.digest, approvalId: approval?.id })}
        label="Bokför"
        compact
        canSubmit={!!approval}
        onSuccess={props.onRefresh}
        validate={(result) => {
          if (result.reviewId !== review.id || result.loanId !== review.loanId)
            throw new Error("Loan event identity mismatch");
        }}
      />
    </AssetActionActions>
  );
}
