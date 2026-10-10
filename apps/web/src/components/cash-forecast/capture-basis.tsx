import type { CommandKeys } from "@/lib/command-keys";
import { useCommandKeys } from "@/lib/command-keys";
import { bookScope } from "@/lib/contract-client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient, skipToken } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-forecast";
import * as Coverage from "@open-erp/contracts/bank-source-coverage";
import * as Settlement from "@open-erp/contracts/settlements";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, isUncertainWriteError, readAccounting } from "@/lib/accounting-api";

type Review = typeof Cash.CashAccountSelection.Type.review;

type Selection = {
  readonly report: typeof Coverage.BankSourceCoverageReport.Type;
  readonly accountIds: ReadonlyArray<string>;
  readonly eligibility: Review["eligibility"];
  readonly balanceType: Review["balanceType"];
  readonly reason: string;
  readonly asOf: string;
};

export function CaptureCashBasis({ onSaved }: { onSaved: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const cache = useQueryClient();
  const keys = useCommandKeys();
  const [reportId, setReportId] = useState("");
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [eligibility, setEligibility] = useState<Review["eligibility"]>("unknown");
  const [balanceType, setBalanceType] = useState<Review["balanceType"]>("unknown");
  const [reason, setReason] = useState("");

  const reports = useQuery({
    queryKey: [...bookKey(book), "bank-source-coverage", "list"],
    queryFn: ({ signal }) =>
      readAccounting(
        (client) =>
          client.bankSourceCoverage.listBankSourceCoverage({ params: { ...bookScope(book) } }),
        Coverage.BankSourceCoverageList,
        {
          signal,
        },
      ),
    retry: false,
  });

  const report = useQuery({
    queryKey: [...bookKey(book), "bank-source-coverage", reportId],
    queryFn: reportId
      ? ({ signal }) =>
          readAccounting(
            (client) =>
              client.bankSourceCoverage.getBankSourceCoverage({
                params: { ...bookScope(book), id: reportId },
              }),
            Coverage.BankSourceCoverageView,
            { signal },
          )
      : skipToken,
    retry: false,
  });

  const capture = useMutation({
    mutationFn: (selection: Selection) => saveBasis(bookPath(book), selection, keys.current, sv),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: [...bookKey(book), "cash-bases"] });
    },
  });

  const uncertain = isUncertainWriteError(capture.error);
  const disabled = book.role !== "operator" || capture.isPending || uncertain;

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();

        if (capture.isPending || book.role !== "operator") return;

        if (uncertain && capture.variables) {
          capture.mutate(capture.variables, { onSuccess: (basis) => onSaved(basis.id) });

          return;
        }

        if (!report.data || accountIds.length === 0 || !reason.trim()) return;

        capture.mutate(
          {
            report: report.data.report,
            accountIds,
            eligibility,
            balanceType,
            reason: reason.trim(),
            asOf: setup.today,
          },
          { onSuccess: (basis) => onSaved(basis.id) },
        );
      }}
    >
      <RecordSection title={sv ? "Konton som ingår" : "Included accounts"}>
        <AccountingStatus locale={locale} pending={reports.isPending} error={reports.error} />
        {reports.isError ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void reports.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        ) : null}
        {reports.data?.items.length === 0 ? (
          <Text>{sv ? "Kontoutdrag saknas" : "Statements unavailable"}</Text>
        ) : null}
        <Link href={`${workspacePath(book)}/accounts?view=coverage`}>Bank</Link>
        <SelectField
          compact
          label={sv ? "Kontoutdragstäckning" : "Statement coverage"}
          value={reportId}
          disabled={disabled}
          options={(reports.data?.items ?? []).map((item) => ({
            value: item.id,
            label: `${item.startsOn} till ${item.endsOn}, ${item.createdAt}`,
          }))}
          onValueChange={(value) => {
            setReportId(value ?? "");
            setAccountIds([]);
          }}
        />
        <AccountingStatus
          locale={locale}
          pending={reportId !== "" && report.isPending}
          error={report.error}
        />
        {report.isError ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void report.refetch();
            }}
          >
            {sv ? "Försök igen" : "Retry"}
          </Button>
        ) : null}
        {report.data ? (
          <Text>
            {report.data.dependenciesCurrent
              ? sv
                ? "Aktuellt kontoutdragsunderlag"
                : "Current statement basis"
              : sv
                ? "Inaktuell. Källorna har ändrats."
                : "Stale. Sources have changed."}
          </Text>
        ) : null}
        {report.data?.report.accounts.map((account) => (
          <Button
            key={account.accountId}
            type="button"
            variant={accountIds.includes(account.accountId) ? "secondary" : "outline"}
            aria-pressed={accountIds.includes(account.accountId)}
            disabled={disabled}
            onClick={() =>
              setAccountIds((current) =>
                current.includes(account.accountId)
                  ? current.filter((id) => id !== account.accountId)
                  : [...current, account.accountId],
              )
            }
          >
            {account.code} {account.name}
          </Button>
        ))}
      </RecordSection>
      <BasisReview
        disabled={disabled}
        eligibility={eligibility}
        balanceType={balanceType}
        reason={reason}
        onEligibility={setEligibility}
        onBalanceType={setBalanceType}
        onReason={setReason}
      />
      <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
      <Button
        type="submit"
        disabled={
          book.role !== "operator" ||
          capture.isPending ||
          (!uncertain && (!report.data || accountIds.length === 0))
        }
      >
        {uncertain ? (sv ? "Försök igen" : "Retry") : sv ? "Spara underlag" : "Save basis"}
      </Button>
      {book.role !== "operator" ? (
        <Text>{sv ? "En operatör kan spara underlaget." : "An operator can save the basis."}</Text>
      ) : null}
    </Box>
  );
}

function BasisReview(props: {
  disabled: boolean;
  eligibility: Review["eligibility"];
  balanceType: Review["balanceType"];
  reason: string;
  onEligibility: (value: Review["eligibility"]) => void;
  onBalanceType: (value: Review["balanceType"]) => void;
  onReason: (value: string) => void;
}) {
  const { setup, locale } = useBookWorkspace();
  const sv = locale === "sv";

  return (
    <RecordSection title={sv ? "Tidpunkt och öppningssaldo" : "Date and opening balance"}>
      <Text>
        {sv ? "Som av" : "As of"} {setup.today}
      </Text>
      <Text>
        {sv
          ? "Öppningssaldot tas från banken, inte från bokföringen."
          : "Opening comes from the bank, not the ledger."}
      </Text>
      <SelectField
        compact
        label={sv ? "Kontonas användning" : "Account eligibility"}
        value={props.eligibility}
        disabled={props.disabled}
        options={[
          { value: "unknown", label: sv ? "Okänt" : "Unknown" },
          {
            value: "unrestricted_entity_bank",
            label: sv ? "Företagets fria bankmedel" : "Unrestricted company bank funds",
          },
          { value: "restricted", label: sv ? "Reserverade medel" : "Restricted funds" },
          { value: "private", label: sv ? "Privata medel" : "Private funds" },
          { value: "tax_account", label: sv ? "Skattekonto" : "Tax account" },
          { value: "unused_credit", label: sv ? "Outnyttjad kredit" : "Unused credit" },
        ]}
        onValueChange={(value) =>
          props.onEligibility(
            Schema.decodeUnknownSync(Cash.CashAccountSelection.fields.review.fields.eligibility)(
              value,
            ),
          )
        }
      />
      <SelectField
        compact
        label={sv ? "Saldotyp" : "Balance type"}
        value={props.balanceType}
        disabled={props.disabled}
        options={[
          { value: "unknown", label: sv ? "Okänt" : "Unknown" },
          {
            value: "statement_closing",
            label: sv ? "Kontoutdragets slutsaldo" : "Statement closing balance",
          },
          { value: "available", label: sv ? "Tillgängligt saldo" : "Available balance" },
        ]}
        onValueChange={(value) =>
          props.onBalanceType(
            Schema.decodeUnknownSync(Cash.CashAccountSelection.fields.review.fields.balanceType)(
              value,
            ),
          )
        }
      />
      <InputField
        compact
        label={sv ? "Granskningsgrund" : "Review reason"}
        value={props.reason}
        required
        maxLength={4000}
        disabled={props.disabled}
        onChange={(event) => props.onReason(event.target.value)}
      />
    </RecordSection>
  );
}

async function saveBasis(base: string, selection: Selection, keys: CommandKeys, sv: boolean) {
  const evidencePath = `${base}/evidence`;

  const evidence = await readAccounting(
    evidencePath,
    Accounting.Evidence,
    keys.options(
      evidencePath,
      JSON.stringify({
        title: sv ? "Granskning av prognosunderlag" : "Forecast basis review",
        content: JSON.stringify({
          coverageReportId: selection.report.id,
          accountIds: selection.accountIds,
          eligibility: selection.eligibility,
          balanceType: selection.balanceType,
          reason: selection.reason,
          asOf: selection.asOf,
        }),
        mediaType: "application/json",
        origin: "cash-basis-review",
      }),
    ),
  );

  const accounts: Array<typeof Cash.CashAccountSelection.Type> = [];

  for (const accountId of selection.accountIds) {
    const path = `${base}/bank-capacity-reconciliations`;

    const reconciliation = await readAccounting(
      path,
      Settlement.BankCapacityReconciliation,
      keys.options(
        path,
        JSON.stringify({
          accountId,
          startsOn: selection.report.input.startsOn,
          endsOn: selection.asOf,
        }),
      ),
    );

    accounts.push({
      accountId,
      reconciliationId: reconciliation.id,
      coverageReportId: selection.report.id,
      review: {
        evidenceId: evidence.id,
        sha256: evidence.sha256,
        eligibility: selection.eligibility,
        balanceType: selection.balanceType,
        reason: selection.reason,
      },
    });
  }

  const path = `${base}/cash-bases`;

  const input = Schema.decodeSync(Cash.CaptureCashBasis)({
    asOf: selection.asOf,
    accounts,
    expectedDates: [],
  });

  return readAccounting(path, Cash.CashBasis, keys.options(path, JSON.stringify(input)));
}
