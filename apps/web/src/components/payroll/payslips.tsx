import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Runs from "@open-erp/contracts/payroll-runs";
import type * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { PayrollPayslipCard } from "@open-erp/ui/components/payroll-review";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { downloadIntake } from "@/components/source-intake/download";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import type { Locale } from "@/paraglide/runtime";

export function PayrollPayslips(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  documents: readonly (typeof Runs.PayrollPayslipDocument.Type)[];
}) {
  const sv = props.locale === "sv";
  const [selected, setSelected] = useState<typeof Runs.PayrollPayslipDocument.Type | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  return (
    <Box display="grid" gap="sm">
      {props.documents.map((document) => (
        <Box key={document.id} display="flex" alignItems="center" justifyContent="between" gap="sm">
          <Text>{document.personRef}</Text>
          <Button
            variant="outline"
            onClick={(event) => {
              returnFocus.current = event.currentTarget;
              setSelected(document);
            }}
          >
            {sv ? "Visa lönebesked" : "View payslip"}
          </Button>
        </Box>
      ))}
      {selected ? (
        <FormDialog
          title={props.book.name}
          closeLabel={sv ? "Stäng" : "Close"}
          size="fullscreen"
          finalFocus={returnFocus}
          onClose={() => setSelected(null)}
          onEscape={() => setSelected(null)}
        >
          <PrivatePayslip
            key={selected.id}
            book={props.book}
            locale={props.locale}
            expected={selected}
          />
        </FormDialog>
      ) : null}
    </Box>
  );
}

function PrivatePayslip(props: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  expected: typeof Runs.PayrollPayslipDocument.Type;
}) {
  const sv = props.locale === "sv";
  const path = `${bookPath(props.book)}/payroll/payslips/${encodeURIComponent(props.expected.id)}`;

  const saved = useQuery({
    queryKey: [...bookKey(props.book), "payroll", "payslips", props.expected.id],
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(path, Runs.PayrollPayslipView, { signal });

      if (
        view.document.id !== props.expected.id ||
        view.document.digest !== props.expected.digest ||
        view.document.runId !== props.expected.runId ||
        view.document.scope.bookId !== props.book.id ||
        view.document.scope.entityId !== props.book.entityId
      )
        throw new Error("Payslip document identity mismatch");

      return view;
    },
  });

  const download = useMutation({
    mutationFn: async () => {
      const result = await readAccounting(`${path}/artifact`, Runs.PayrollPayslipArtifactBytes);
      const artifact = result.artifact;

      if (
        artifact.documentId !== props.expected.id ||
        artifact.documentDigest !== props.expected.digest ||
        artifact.scope.bookId !== props.book.id ||
        artifact.scope.entityId !== props.book.entityId ||
        artifact.byteLength < 1 ||
        artifact.byteLength > 10 * 1024 * 1024
      )
        throw new Error("Payslip artifact identity mismatch");

      const binary = atob(result.contentBase64);

      if (btoa(binary) !== result.contentBase64) throw new Error("Noncanonical payslip bytes");

      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));

      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");

      if (bytes.length !== artifact.byteLength || hash !== artifact.sha256)
        throw new Error("Payslip artifact checksum mismatch");

      downloadIntake(
        new Blob([bytes], { type: artifact.mediaType }),
        `payslip-${props.expected.id}.pdf`,
      );
    },
  });

  if (!saved.isSuccess)
    return <AccountingStatus locale={props.locale} pending={saved.isPending} error={saved.error} />;

  const { document, artifact } = saved.data;
  const amount = (value: string) => formatMinorAmount(value, document.currencyScale, props.locale);

  const month = new Intl.DateTimeFormat(props.locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${document.earningsPeriod.startsOn}T12:00:00Z`));

  const paymentDate = new Intl.DateTimeFormat(props.locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${document.expectedPaymentOn}T12:00:00Z`));

  return (
    <PayrollPayslipCard
      title={`${sv ? "Lönespecifikation" : "Payslip"} ${month}`}
      subtitle={`${document.personRef}, ${sv ? "planerad utbetalning" : "planned payment"} ${paymentDate}`}
      rows={[
        { id: "gross", label: sv ? "Bruttolön" : "Gross pay", amount: amount(document.grossMinor) },
        {
          id: "reimbursement",
          label: sv ? "Kontant ersättning" : "Cash reimbursement",
          amount: amount(document.cashReimbursementMinor),
        },
        {
          id: "tax",
          label: sv ? "Preliminärskatt" : "Withholding",
          amount: amount((-BigInt(document.withholdingMinor)).toString()),
        },
        {
          id: "deduction",
          label: sv ? "Nettoavdrag" : "Net deductions",
          amount: amount((-BigInt(document.netDeductionMinor)).toString()),
        },
        {
          id: "payable",
          label: sv ? "Att betala" : "Payable",
          amount: amount(document.payableMinor),
          total: true,
        },
      ]}
      note={
        sv
          ? `Bokförd, inte utbetald. Originalet är sparat för den här körningen.${artifact ? "" : " PDF är inte sparad ännu."}`
          : `Posted, not paid. The original is saved for this run.${artifact ? "" : " The PDF is not saved yet."}`
      }
    >
      {artifact ? (
        <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
          {sv ? "Ladda ned PDF" : "Download PDF"}
        </Button>
      ) : null}
      <AccountingStatus locale={props.locale} pending={download.isPending} error={download.error} />
    </PayrollPayslipCard>
  );
}
