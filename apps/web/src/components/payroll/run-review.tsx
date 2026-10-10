import { useCommandKeys } from "@/lib/command-keys";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Runs from "@open-erp/contracts/payroll-runs";
import type * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { DataTable } from "@open-erp/ui/components/data-table";
import { PayrollReviewLayout, PayrollInputStatus } from "@open-erp/ui/components/payroll-review";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";
import { PayrollPayslips } from "./payslips";

export function PayrollRunReview(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  runId: string;
}) {
  const client = useQueryClient();
  const { current: keys } = useCommandKeys();
  const root = `${bookPath(props.book)}/payroll/runs/${encodeURIComponent(props.runId)}`;
  const queryKey = [...bookKey(props.book), "payroll", "runs", props.runId];

  const view = useQuery({
    queryKey,
    retry: false,
    queryFn: async ({ signal }) => {
      const saved = await readAccounting(root, Runs.PayrollRunView, { signal });

      if (
        saved.run.id !== props.runId ||
        saved.run.scope.entityId !== props.book.entityId ||
        saved.run.scope.bookId !== props.book.id
      )
        throw new Error("Payroll run scope mismatch");

      return saved;
    },
  });

  const refresh = () =>
    client.invalidateQueries({ queryKey: [...bookKey(props.book), "payroll", "runs"] });

  const approve = useMutation({
    mutationFn: (run: typeof Runs.PayrollRun.Type) => {
      const path = `${root}/approvals`;

      return readAccounting(
        path,
        Runs.PayrollRunApproval,
        mutationOptions(path, JSON.stringify({ runDigest: run.digest }), keys),
      );
    },
    onSuccess: async (saved) => {
      if (saved.runId !== props.runId) throw new Error("Payroll approval scope mismatch");
      await refresh();
    },
    onError: async () => {
      await refresh();
    },
  });

  const execute = useMutation({
    mutationFn: ({
      run,
      approved,
    }: {
      run: typeof Runs.PayrollRun.Type;
      approved: typeof Runs.PayrollRunActiveApproval.Type;
    }) => {
      if (approved.runId !== run.id || approved.runDigest !== run.digest)
        throw new Error("Payroll approval basis mismatch");
      const path = `${root}/executions`;

      return readAccounting(
        path,
        Runs.PayrollRunExecution,
        mutationOptions(
          path,
          JSON.stringify({ runDigest: run.digest, approvalId: approved.id }),
          keys,
        ),
      );
    },
    onSuccess: refresh,
    onError: refresh,
  });

  if (!view.isSuccess)
    return <AccountingStatus locale={props.locale} pending={view.isPending} error={view.error} />;
  const { run } = view.data;

  const approved = view.data.approval;

  return (
    <PayrollRunFrame
      book={props.book}
      locale={props.locale}
      view={view.data}
      approved={approved !== null}
      pending={approve.isPending || execute.isPending || view.isFetching}
      error={approve.error ?? execute.error}
      onApprove={() => approve.mutate(run)}
      onExecute={() => {
        if (approved) execute.mutate({ run, approved });
      }}
    />
  );
}

function PayrollRunFrame(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  view: typeof Runs.PayrollRunView.Type;
  approved: boolean;
  pending: boolean;
  error: Error | null;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const sv = props.locale === "sv";
  const { run, execution } = props.view;
  const first = run.employees[0];

  if (!first) throw new Error("Payroll run has no retained employees");

  const calculation = first.calculation.calculation;
  const state = execution ? "posted" : props.approved ? "approved" : "prepared";

  const notes = sv
    ? {
        posted: "Körningen är bokförd. Inget är utbetalt. Lönebeskeden är sparade, inte skickade.",
        approved:
          "Körningen är godkänd. Bokföring skapar verifikat, löneskulder och lönebesked. Inget är utbetalt.",
        prepared:
          "Beloppen är sparade. Godkännande och bokföring är separata steg. Inget är utbetalt.",
      }
    : {
        posted: "The run is posted. Nothing has been paid. Payslips are saved, not sent.",
        approved:
          "The run is approved. Posting creates a voucher, payroll liabilities and payslips. Nothing has been paid.",
        prepared:
          "Amounts are saved. Approval and posting are separate steps. Nothing has been paid.",
      };

  return (
    <PayrollReviewLayout
      title={sv ? "Skatt och löner" : "Tax and payroll"}
      breadcrumb={
        <Link href={`${workspacePath(props.book)}/tax?view=payroll`}>
          / {sv ? "Löner" : "Payroll"} /
        </Link>
      }
      stateLabel={
        <>
          {new Intl.DateTimeFormat(props.locale, {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })
            .format(new Date(`${calculation.earningsPeriod.startsOn}T00:00:00Z`))
            .replace(/^./u, (letter) => letter.toLocaleUpperCase(props.locale))}
          ,{" "}
          {execution
            ? sv
              ? "bokförd"
              : "posted"
            : props.approved
              ? sv
                ? "godkänd"
                : "approved"
              : sv
                ? "förberedd"
                : "prepared"}
        </>
      }
      action={
        !execution ? (
          <Button
            disabled={props.pending || props.book.role !== "operator"}
            onClick={props.approved ? props.onExecute : props.onApprove}
          >
            {props.approved ? (sv ? "Bokför" : "Post") : sv ? "Godkänn" : "Approve"}
          </Button>
        ) : undefined
      }
      notice={notes[state]}
      amounts={<PayrollAmounts run={run} locale={props.locale} />}
      footnote={
        sv
          ? "Ändras underlaget måste körningen förberedas och godkännas igen. Bokföring skapar lönebesked och skuld, inte en betalning."
          : "Changed inputs require a new preparation and approval. Posting creates payslips and liabilities, not a payment."
      }
    >
      <Box display="grid" gap="sm" padding="lg">
        <AccountingStatus locale={props.locale} pending={props.pending} error={props.error} write />
        {execution ? (
          <Link
            href={`${workspacePath(props.book)}/bookkeeping?record=${encodeURIComponent(execution.postingReceipt.voucherId)}`}
          >
            {sv ? "Visa verifikat" : "View voucher"} {execution.postingReceipt.voucherNumber}
          </Link>
        ) : null}
        {execution ? (
          <PayrollPayslips book={props.book} locale={props.locale} documents={execution.payslips} />
        ) : null}
      </Box>
    </PayrollReviewLayout>
  );
}

function PayrollAmounts({ run, locale }: { run: typeof Runs.PayrollRun.Type; locale: Locale }) {
  const first = run.employees[0];

  if (!first) throw new Error("Payroll run has no retained employees");

  const sv = locale === "sv";

  const amount = (value: string) =>
    formatMinorAmount(value, first.calculation.calculation.currencyScale, locale);

  const fields = [
    "grossMinor",
    "withholdingMinor",
    "payableMinor",
    "employerContributionMinor",
  ] as const;

  const rows = run.employeeObligations.map((row) => {
    const employee = run.employees.find((entry) => entry.calculation.id === row.calculationId);

    if (!employee) throw new Error("Payroll obligation has no retained employee");

    return {
      id: row.calculationId,
      cells: [
        employee.personRef,
        ...fields.map((field) => amount(row[field])),
        <PayrollInputStatus key="inputs">{sv ? "Komplett" : "Complete"}</PayrollInputStatus>,
      ],
    };
  });

  const totals = fields.map((field) => (
    <strong key={field}>
      {amount(
        run.employeeObligations.reduce((total, row) => total + BigInt(row[field]), 0n).toString(),
      )}
    </strong>
  ));

  return (
    <DataTable
      title={sv ? "Lönebelopp" : "Payroll amounts"}
      narrow="scroll"
      presentation="register"
      columns={[
        { id: "employee", label: sv ? "Anställd" : "Employee", width: 200 },
        { id: "gross", label: sv ? "Brutto" : "Gross", numeric: true, width: 120 },
        { id: "tax", label: sv ? "Skatt" : "Tax", numeric: true, width: 120 },
        { id: "net", label: sv ? "Netto" : "Net", numeric: true, width: 120 },
        {
          id: "contribution",
          label: sv ? "Arbetsgivaravgift" : "Employer contribution",
          numeric: true,
          width: 140,
        },
        { id: "inputs", label: sv ? "Indata" : "Inputs", width: "fill", inset: true },
      ]}
      rows={[
        ...rows,
        {
          id: "total",
          cells: [<strong key="total">{sv ? "Summa" : "Total"}</strong>, ...totals, null],
        },
      ]}
    />
  );
}
