import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { BankImport } from "@/components/bank-import";
import { BankStatementReview } from "@/components/bank-statement";
import { BankReport } from "@/components/bank-report";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function BankReconciliation({
  book,
  setup,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  const [statementId, setStatementId] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  return (
    <details id="bank-reconciliation" tabIndex={-1}>
      <summary>{copy.bank_title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.bank_title}</Heading>
        <Text>{copy.bank_warning}</Text>
        {setup.blockers.length === 0 ? (
          <BankImport book={book} locale={locale} onImported={setStatementId} />
        ) : null}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("statementId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setLoadError(copy.bank_invalid);
              return;
            }
            setLoadError("");
            setStatementId(id);
          }}
        >
          <InputField
            label={copy.bank_statement_id}
            name="statementId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.bank_load_statement}
            </Button>
          </Box>
        </Box>
        {statementId ? (
          <BankStatementReview key={statementId} book={book} id={statementId} locale={locale} />
        ) : null}
        {setup.blockers.length === 0 ? (
          <ReconciliationForm book={book} setup={setup} locale={locale} onCreated={setReportId} />
        ) : null}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("reportId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setLoadError(copy.bank_invalid);
              return;
            }
            setLoadError("");
            setReportId(id);
          }}
        >
          <InputField
            label={copy.bank_report_id}
            name="reportId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.bank_load_report}
            </Button>
          </Box>
        </Box>
        <Text role="status">{loadError}</Text>
        {reportId ? <BankReport key={reportId} book={book} id={reportId} locale={locale} /> : null}
      </Box>
    </details>
  );
}

function ReconciliationForm({
  book,
  setup,
  locale,
  onCreated,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  onCreated: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const reconciliation = useMutation({
    mutationFn: (payload: typeof Bank.ReconcileBank.Type) => {
      const path = `${bookPath(book)}/bank-reconciliations`;
      return readAccounting(
        path,
        Bank.BankReconciliation,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (report) => onCreated(report.id),
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Bank.ReconcileBank)({
          accountId: fields.get("accountId"),
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.bank_invalid);
          return;
        }
        setInputError("");
        reconciliation.mutate(decoded.value);
      }}
    >
      <Heading>{copy.bank_run}</Heading>
      <Text tone="muted">{copy.bank_run_help}</Text>
      <Text tone="muted">{copy.bank_range_rules}</Text>
      <Box
        as="fieldset"
        disabled={reconciliation.isPending || reconciliation.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <SelectField
          label={copy.journal_account}
          name="accountId"
          required
          options={setup.accounts.map((account) => ({
            value: account.id,
            label: `${account.code} · ${account.name} · ${account.id}`,
          }))}
        />
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <InputField label={copy.bank_starts} name="startsOn" type="date" required />
          <InputField label={copy.bank_ends} name="endsOn" type="date" required />
        </Box>
        <Box>
          <Button type="submit" size="xl">
            {copy.bank_run}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus
        write
        locale={locale}
        pending={reconciliation.isPending}
        error={reconciliation.error}
      />
      {reconciliation.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>
            {copy.bank_report_id}: {reconciliation.data.id}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                reconciliation.reset();
                keys.current.clear();
              }}
            >
              {copy.bank_new_run}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
