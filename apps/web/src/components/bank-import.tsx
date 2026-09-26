import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Bank from "@open-erp/contracts/reconciliation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

type BankImportDraft = {
  source: typeof Bank.StatementSource.Type;
  evidence: typeof Accounting.CreateEvidence.Type;
  existingMatches: (typeof Bank.ImportBankStatement.Type)["existingMatches"];
};

const example = JSON.stringify(
  {
    kind: "synthetic_bank_statement_v1",
    statementIdentifier: "statement_demo_001",
    sourceBankAccountId: "bank_demo",
    accountId: "account_bank",
    currency: "SEK",
    startsOn: "2026-01-01",
    endsOn: "2026-01-31",
    openingMinor: "0",
    closingMinor: "100",
    completeness: {
      declaredComplete: false,
      basis: "Partial synthetic example; not bank verified",
    },
    rows: [
      {
        rowOrdinal: 1,
        providerId: null,
        date: "2026-01-01",
        description: "Example incoming payment",
        amountMinor: "100",
      },
    ],
  },
  null,
  2,
);

export function BankImport({
  book,
  locale,
  onImported,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onImported: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const sourceId = useId();
  const matchesId = useId();
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");

  const imported = useMutation({
    mutationFn: async (draft: BankImportDraft) => {
      const evidencePath = `${bookPath(book)}/evidence`;

      const evidence = await readAccounting(
        evidencePath,
        Accounting.Evidence,
        mutationOptions(evidencePath, JSON.stringify(draft.evidence), keys.current),
      );

      const path = `${bookPath(book)}/bank-statements`;

      const payload = Schema.decodeSync(Bank.ImportBankStatement)({
        ...draft.source,
        evidenceId: evidence.id,
        existingMatches: draft.existingMatches,
      });

      return readAccounting(
        path,
        Bank.StatementImportReceipt,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: async (receipt) => {
      const statementKey = [...bookKey(book), "bank-statement", receipt.statement.id];
      await client.cancelQueries({ queryKey: statementKey, exact: true });
      void client.invalidateQueries({ queryKey: statementKey, exact: true });
      void client.invalidateQueries({ queryKey: [...bookKey(book), "bank-reconciliation"] });
      onImported(receipt.statement.id);
    },
  });

  function submit(form: HTMLFormElement) {
    const fields = new FormData(form);

    const evidence = Schema.decodeUnknownOption(Accounting.CreateEvidence)({
      title: fields.get("title"),
      origin: fields.get("origin"),
      content: fields.get("source"),
      mediaType: "application/json",
    });

    const matchesText = fields.get("matches");

    if (evidence._tag === "None" || !Schema.is(Schema.String)(matchesText)) {
      setInputError(copy.bank_invalid);

      return;
    }

    try {
      const source = Schema.decodeUnknownOption(Bank.StatementSource, {
        onExcessProperty: "error",
      })(JSON.parse(evidence.value.content));

      const matches = Schema.decodeUnknownOption(Bank.ImportBankStatement.fields.existingMatches, {
        onExcessProperty: "error",
      })(JSON.parse(matchesText.trim() || "[]"));

      if (source._tag === "None" || matches._tag === "None") {
        setInputError(copy.bank_invalid);

        return;
      }

      setInputError("");
      imported.mutate({
        source: source.value,
        evidence: evidence.value,
        existingMatches: matches.value,
      });
    } catch {
      setInputError(copy.bank_invalid);
    }
  }

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
    >
      <Heading>{copy.bank_import}</Heading>
      <Text tone="muted">{copy.bank_source_help}</Text>
      <Text tone="muted">{copy.bank_source_rules}</Text>
      <details>
        <summary>{copy.bank_example}</summary>
        <Box display="grid" minWidth="zero" paddingBlock="md">
          <textarea aria-label={copy.bank_example} value={example} readOnly rows={12} cols={16} />
        </Box>
      </details>
      <Box
        as="fieldset"
        disabled={imported.isPending || imported.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <InputField label={copy.journal_title_field} name="title" required maxLength={2000} />
        <InputField label={copy.journal_origin} name="origin" required maxLength={2000} />
        <Label htmlFor={sourceId}>{copy.bank_source}</Label>
        <Box
          display="grid"
          minWidth="zero"
          borderWidth="thin"
          borderColor="default"
          borderRadius="control"
          backgroundColor="surface"
          padding="md"
        >
          <textarea
            id={sourceId}
            name="source"
            required
            maxLength={65536}
            rows={12}
            cols={16}
            spellCheck={false}
          />
        </Box>
        <Label htmlFor={matchesId}>{copy.bank_existing}</Label>
        <Text tone="muted">{copy.bank_existing_help}</Text>
        <Box
          display="grid"
          minWidth="zero"
          borderWidth="thin"
          borderColor="default"
          borderRadius="control"
          backgroundColor="surface"
          padding="md"
        >
          <textarea
            id={matchesId}
            name="matches"
            defaultValue="[]"
            rows={4}
            cols={16}
            spellCheck={false}
          />
        </Box>
        <Box>
          <Button type="submit" size="xl">
            {copy.bank_import}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={imported.isPending} error={imported.error} />
      {imported.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>{copy.bank_imported}</Text>
          <Text>
            {copy.bank_statement_id}: {imported.data.statement.id}
          </Text>
          <Text>
            {copy.bank_receipt}: {imported.data.receipt.key} · {imported.data.receipt.operation} ·{" "}
            {imported.data.receipt.actorId}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                imported.reset();
                keys.current.clear();
              }}
            >
              {copy.bank_new_import}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
