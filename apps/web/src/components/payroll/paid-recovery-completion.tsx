import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import * as Settlement from "@open-erp/contracts/payroll-settlements";
import * as Calculations from "@open-erp/contracts/payroll-calculations";
import * as Runs from "@open-erp/contracts/payroll-runs";
import { InputField, FormText } from "@open-erp/ui/kanon/form";
import { PanelSection } from "@open-erp/ui/kanon/detail-panel";
import { CommandForm } from "@/components/commerce/shared";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";

type View = typeof Recovery.PaidRecoveryView.Type;

type Leg = View["legs"][number];

export function PaidRecoveryCompletion({ view }: { view: View }) {
  const { book, locale } = useBookWorkspace();

  if (view.cancellation || !view.attachments.length) return null;
  const attachment = view.attachments.at(-1)!;
  const root = `${bookPath(book)}/payroll/paid-recoveries/${view.assessment.id}`;
  const gross = view.qualifications.find((row) => row.purpose === "gross_claim");

  return (
    <>
      <PanelSection label="Oberoende kvalificering">
        <FormText>
          Kvalificering kräver en annan person än den som bifogade underlaget. Detta arbetsflöde är
          syntetiskt kvalificerat.
        </FormText>
        {(["gross_claim", "net_offset"] as const)
          .filter((purpose) => !view.qualifications.some((row) => row.purpose === purpose))
          .map((purpose) => (
            <CommandForm
              key={purpose}
              book={book}
              locale={locale}
              presentation="kanon"
              inputRequired={false}
              path={`${root}/qualifications`}
              schema={Recovery.QualifyPaidRecovery}
              output={Recovery.PaidRecoveryView}
              label={
                purpose === "gross_claim"
                  ? "Kvalificera bruttofordran"
                  : "Kvalificera nettokvittning"
              }
              input={() => ({
                attachmentId: attachment.id,
                attachmentDigest: attachment.digest,
                purpose,
              })}
            />
          ))}
      </PanelSection>
      {gross && !view.claimReview ? (
        <PanelSection label="Bruttofordran">
          <CommandForm
            book={book}
            locale={locale}
            presentation="kanon"
            path={`${root}/claim-reviews`}
            schema={Recovery.PreparePaidRecoveryClaim}
            output={Recovery.PaidRecoveryView}
            label="Förbered fordran"
            input={(fields) => ({
              assessmentDigest: view.assessment.digest,
              qualificationId: gross.id,
              recoveryReceivableAccountId: field(fields, "account"),
              accountingPeriodId: field(fields, "period"),
              postingDate: field(fields, "date"),
              series: field(fields, "series"),
            })}
          >
            <InputField label="Fordringskonto" name="account" required />
            <InputField label="Bokföringsperiod" name="period" required />
            <InputField
              label="Bokföringsdatum"
              name="date"
              required
              pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
            />
            <InputField label="Serie" name="series" defaultValue="L" required />
          </CommandForm>
        </PanelSection>
      ) : null}
      {view.claimSettlement ? (
        <SettlementActions settlement={view.claimSettlement} noun="fordran" />
      ) : null}
      {view.claimExecution
        ? view.legs.map((leg) => <RecoveryInstallment key={leg.leg.id} view={view} row={leg} />)
        : null}
    </>
  );
}

function SettlementActions({
  settlement,
  noun,
  executionLabel,
}: {
  settlement: typeof Settlement.SettlementView.Type;
  noun: string;
  executionLabel?: string;
}) {
  const { book, locale } = useBookWorkspace();

  if (settlement.execution) return <FormText>{noun}: verkställd.</FormText>;
  const root = `${bookPath(book)}/payroll/settlement-reviews/${settlement.review.id}`;

  const approval = settlement.approvals.find(
    (row) =>
      row.reviewDigest === settlement.review.digest && Date.parse(row.expiresAt) > Date.now(),
  );

  return (
    <PanelSection label={noun}>
      <FormText>
        Granskning {settlement.review.id}. Godkännandet gäller exakt denna sparade revision.
      </FormText>
      {approval ? (
        <CommandForm
          book={book}
          locale={locale}
          presentation="kanon"
          inputRequired={false}
          path={`${root}/executions`}
          schema={Settlement.ExecuteSettlement}
          output={Settlement.SettlementExecution}
          label={executionLabel ?? `Verkställ ${noun}`}
          input={() => ({ reviewDigest: settlement.review.digest, approvalId: approval.id })}
        />
      ) : (
        <CommandForm
          book={book}
          locale={locale}
          presentation="kanon"
          inputRequired={false}
          path={`${root}/approvals`}
          schema={Settlement.ApproveSettlement}
          output={Settlement.SettlementApproval}
          label={`Godkänn ${noun}`}
          input={() => ({ reviewDigest: settlement.review.digest })}
        />
      )}
    </PanelSection>
  );
}

function RecoveryInstallment({ view, row }: { view: View; row: Leg }) {
  const { book, locale } = useBookWorkspace();
  const [capacityId, setCapacityId] = useState(row.capacityCalculationId ?? "");
  const qualification = view.qualifications.find((item) => item.purpose === "net_offset");
  const claim = view.claimExecution?.recoveryClaim;
  const month = row.leg.month;
  const settlement = row.reviews.at(-1);

  if (!qualification || !claim) return null;

  return (
    <PanelSection label={`Kvittning ${month}`}>
      {!settlement ? (
        <CommandForm
          book={book}
          locale={locale}
          presentation="kanon"
          path={`${bookPath(book)}/payroll/settlement-reviews`}
          schema={Settlement.PrepareSettlement}
          output={Settlement.SettlementReview}
          inputRequired={false}
          canSubmit={Boolean(capacityId)}
          label={`Förbered kvittning ${month}`}
          input={() => ({
            kind: "future_pay",
            recoveryClaimId: claim.id,
            paidRecoveryLegId: row.leg.id,
            capacityCalculationId: capacityId,
            comparisonId: view.comparison.id,
            lawfulBasisId: qualification.adjustmentBasis.id,
            recoveryReceivableAccountId: null,
            futureMonth: month,
            evidenceId: qualification.adjustmentBasis.evidence.evidenceId,
            accountingPeriodId: view.originalPaidEvent.originalRun.input.accountingPeriodId,
            postingDate: `${month}-05`,
            series: view.originalPaidEvent.originalRun.input.series,
            reason: qualification.adjustmentBasis.input.reason,
          })}
        >
          <InputField
            label={`Kapacitetsberäkning ${month}`}
            value={capacityId}
            onChange={(event) => setCapacityId(event.currentTarget.value)}
            required
          />
        </CommandForm>
      ) : (
        <SettlementActions settlement={settlement} noun={`kvittning ${month}`} />
      )}
      {settlement?.execution?.instruction ? (
        <RecoveryPayroll view={view} row={row} settlement={settlement} />
      ) : null}
    </PanelSection>
  );
}

const PrepareRecoveryRun = Schema.Struct({
  calculation: Calculations.PreparePayRun,
  run: Runs.PreparePayrollRun,
});

function RecoveryPayroll({
  view,
  row,
  settlement,
}: {
  view: View;
  row: Leg;
  settlement: typeof Settlement.SettlementView.Type;
}) {
  const { book, locale } = useBookWorkspace();
  const root = `${bookPath(book)}/payroll`;
  const calculationId = row.capacityCalculationId;

  const capacity = useQuery({
    queryKey: [...bookKey(book), "payroll", "calculations", calculationId],
    enabled: !!calculationId,
    queryFn: ({ signal }) =>
      readAccounting(`${root}/calculations/${calculationId}`, Calculations.PayrollCalculation, {
        signal,
      }),
  });

  const instruction = settlement.execution?.instruction;
  const month = row.leg.month;

  if (!instruction) return null;

  if (row.payrollRun) return <RecoveryPayrollRun view={view} row={row} run={row.payrollRun} />;

  if (!capacity.data)
    return <AccountingStatus locale={locale} pending={capacity.isPending} error={capacity.error} />;
  const calculation = { ...capacity.data.basis.reviewedInput, adjustmentIds: [instruction.id] };

  const run = {
    ...view.originalPaidEvent.originalRun.input,
    calculationIds: [capacity.data.id],
    postingDate: calculation.work.expectedPaymentOn,
  };

  return (
    <CommandForm
      book={book}
      locale={locale}
      presentation="kanon"
      inputRequired={false}
      path={`${root}/runs`}
      schema={PrepareRecoveryRun}
      output={Runs.PayrollRun}
      label={`Förbered lönekörning ${month}`}
      input={() => ({ calculation, run })}
      executeRequest={async (request) => {
        const prepared = await readAccounting(
          `${root}/calculations`,
          Calculations.PayrollCalculation,
          {
            method: "POST",
            headers: { "Idempotency-Key": `${request.key}_calculation` },
            body: JSON.stringify(request.input.calculation),
          },
        );

        return readAccounting(`${root}/runs`, Runs.PayrollRun, {
          method: "POST",
          headers: { "Idempotency-Key": request.key },
          body: JSON.stringify({ ...request.input.run, calculationIds: [prepared.id] }),
        });
      }}
    />
  );
}

function RecoveryPayrollRun({
  view,
  row,
  run,
}: {
  view: View;
  row: Leg;
  run: typeof Runs.PayrollRunView.Type;
}) {
  const { book, locale } = useBookWorkspace();
  const root = `${bookPath(book)}/payroll`;
  const month = row.leg.month;

  if (!run.execution)
    return run.approval ? (
      <CommandForm
        book={book}
        locale={locale}
        presentation="kanon"
        inputRequired={false}
        path={`${root}/runs/${run.run.id}/executions`}
        schema={Runs.ExecutePayrollRun}
        output={Runs.PayrollRunExecution}
        label={`Bokför lönekörning ${month}`}
        input={() => ({ runDigest: run.run.digest, approvalId: run.approval!.id })}
      />
    ) : (
      <CommandForm
        book={book}
        locale={locale}
        presentation="kanon"
        inputRequired={false}
        path={`${root}/runs/${run.run.id}/approvals`}
        schema={Runs.ApprovePayrollRun}
        output={Runs.PayrollRunApproval}
        label={`Godkänn lönekörning ${month}`}
        input={() => ({ runDigest: run.run.digest })}
      />
    );

  if (row.noncash)
    return (
      <SettlementActions
        settlement={row.noncash}
        noun={`kvittad utbetalning ${month}`}
        executionLabel={`Registrera kvittad utbetalning ${month}`}
      />
    );

  if (
    run.run.employeeObligations.find((item) => item.employeeId === view.assessment.employee.id)
      ?.payableMinor !== "0"
  )
    return null;

  return (
    <CommandForm
      book={book}
      locale={locale}
      presentation="kanon"
      inputRequired={false}
      path={`${root}/settlement-reviews`}
      schema={Settlement.PrepareSettlement}
      output={Settlement.SettlementReview}
      label={`Förbered kvittad utbetalning ${month}`}
      input={() => ({
        kind: "noncash_payment",
        runId: run.run.id,
        employeeId: view.assessment.employee.id,
        evidenceId: view.attachments.at(-1)!.evidence.evidenceId,
        accountingPeriodId: run.run.input.accountingPeriodId,
        postingDate: `${month}-28`,
        series: run.run.input.series,
        reason: "Syntetiskt kvalificerad utbetalning utan bankrad efter full kvittning",
      })}
    />
  );
}

function field(fields: FormData, name: string) {
  const value = fields.get(name);

  if (typeof value !== "string") throw new Error(`Missing ${name}`);

  return value;
}
