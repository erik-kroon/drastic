import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as Setup from "@open-erp/contracts/company-setup";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";

export function NativeLedgerSetup() {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const form = useRef<HTMLFormElement>(null);
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");

  const [accounts, setAccounts] = useState(() => [
    { key: crypto.randomUUID(), code: "", name: "" },
  ]);

  const [validation, setValidation] = useState<string | null>(null);

  const path = `${bookPath(book)}/company-setup/native-ledger`;

  const setup = useQuery({
    queryKey: [...bookKey(book), "company-setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/company-setup`, Setup.CompanySetup, { signal }),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: typeof Setup.InitializeNativeLedger.Type) =>
      readAccounting(
        path,
        Setup.NativeLedgerSetup,
        mutationOptions(path, JSON.stringify(input), keys.current),
      ),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: bookKey(book) });
    },
  });

  const uncertain = isUncertainWriteError(save.error);

  const disabled = book.role !== "operator" || save.isPending || uncertain;

  const duplicateCodes = accounts.filter(
    (account, index) => accounts.findIndex((other) => other.code === account.code) !== index,
  );

  function submit() {
    if (save.isPending || book.role !== "operator" || !setup.data) return;

    if (uncertain && save.variables) {
      save.mutate(save.variables);

      return;
    }

    if (duplicateCodes.length) {
      setValidation(sv ? "Kontonummer måste vara unika." : "Account numbers must be unique.");
      form.current?.querySelector<HTMLInputElement>('input[name="account-code-1"]')?.focus();

      return;
    }

    const command = Schema.decodeResult(Setup.InitializeNativeLedger)({
      expectedRevision: setup.data.revision,
      startsOn,
      endsOn,
      accounts: accounts.map(({ code, name }) => ({ code, name })),
    });

    if (Result.isFailure(command)) {
      setValidation(
        sv
          ? "Kontrollera räkenskapsåret och kontouppgifterna."
          : "Check the fiscal year and account definitions.",
      );

      return;
    }

    setValidation(null);
    save.mutate(command.success);
  }

  return (
    <Box
      as="form"
      display="flex"
      flexDirection="column"
      gap="lg"
      minWidth="zero"
      ref={form}
      aria-label={sv ? "Konfigurera bokföringen" : "Configure accounting"}

      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Box display="flex" flexDirection="column" gap="sm">
        <Heading size="section">{sv ? "Konfigurera bokföringen" : "Configure accounting"}</Heading>
        <Text variant="control" tone="muted">
          {sv
            ? "Ange första räkenskapsåret och de konton du vill använda. Belopp och ingående balanser registreras separat."
            : "Enter the first fiscal year and the accounts you want to use. Amounts and opening balances are recorded separately."}
        </Text>
      </Box>
      <AccountingStatus locale={locale} pending={setup.isPending} error={setup.error} />
      {setup.isError ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void setup.refetch();
          }}
        >
          {sv ? "Försök igen" : "Try again"}
        </Button>
      ) : null}
      <Box display="grid" columns={1} columnsAtSm={2} gap="md">
        <Box minWidth="zero">
          <InputField
            compact
            label={sv ? "Första dag" : "First day"}
            type="date"
            required
            value={startsOn}
            disabled={disabled}
            onChange={(event) => setStartsOn(event.currentTarget.value)}
          />
        </Box>
        <Box minWidth="zero">
          <InputField
            compact
            label={sv ? "Sista dag" : "Last day"}
            type="date"
            required
            min={startsOn || undefined}
            value={endsOn}
            disabled={disabled}
            onChange={(event) => setEndsOn(event.currentTarget.value)}
          />
        </Box>
      </Box>
      <Text variant="control" tone="muted">
        {sv
          ? "Perioder skapas månadsvis inom det angivna året."
          : "Monthly periods are created within the entered year."}
      </Text>
      <Box display="flex" flexDirection="column" gap="md">
        <Heading size="section">{sv ? "Konton" : "Accounts"}</Heading>
        <Text variant="control" tone="muted">
          {sv
            ? "Kontonummer och namn är dina egna definitioner. Kontonas användning i rapporter granskas separat."
            : "Numbers and names are your account definitions. Their use in reports is reviewed separately."}
        </Text>
        {accounts.map((account, index) => (
          <Box
            key={account.key}
            display="grid"
            columns={1}
            columnsAtSm={3}
            alignItems="end"
            gap="md"
          >
            <Box minWidth="zero">
              <InputField
                compact
                label={`${sv ? "Kontonummer" : "Account number"} ${index + 1}`}
                name={`account-code-${index + 1}`}
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                required
                value={account.code}
                disabled={disabled}
                aria-invalid={
                  !!validation && duplicateCodes.some((row) => row.code === account.code)
                }
                aria-describedby={validation ? "native-ledger-error" : undefined}
                onChange={(event) => {
                  const code = event.currentTarget.value;
                  setAccounts((rows) =>
                    rows.map((row) => (row.key === account.key ? { ...row, code } : row)),
                  );
                  setValidation(null);
                }}
              />
            </Box>
            <Box minWidth="zero">
              <InputField
                compact
                label={`${sv ? "Kontonamn" : "Account name"} ${index + 1}`}
                required
                maxLength={200}
                value={account.name}
                disabled={disabled}
                onChange={(event) => {
                  const name = event.currentTarget.value;
                  setAccounts((rows) =>
                    rows.map((row) => (row.key === account.key ? { ...row, name } : row)),
                  );
                }}
              />
            </Box>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`${sv ? "Ta bort konto" : "Remove account"} ${index + 1}`}
              disabled={disabled || accounts.length === 1}
              onClick={() => setAccounts((rows) => rows.filter((row) => row.key !== account.key))}
            >
              {sv ? "Ta bort" : "Remove"}
            </Button>
          </Box>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || accounts.length >= 100}
          onClick={() =>
            setAccounts((rows) => [...rows, { key: crypto.randomUUID(), code: "", name: "" }])
          }
        >
          {sv ? "Lägg till konto" : "Add account"}
        </Button>
      </Box>
      <Text variant="caption" tone="muted">
        {sv
          ? "Konton och perioder skapas utan belopp. Bokföringsprofil, ingående balanser och årsredovisning är inte godkända genom detta steg."
          : "Accounts and periods are created without amounts. This step does not approve the accounting profile, opening balances or annual report."}
      </Text>
      {validation ? (
        <Text id="native-ledger-error" role="alert" variant="control">
          {validation}
        </Text>
      ) : null}
      <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
      <Box display="flex" gap="md" flexWrap="wrap">
        <Button
          type="submit"
          size="sm"
          disabled={save.isPending || !setup.data || book.role !== "operator"}
        >
          {uncertain
            ? sv
              ? "Försök igen"
              : "Try again"
            : sv
              ? "Skapa konton och perioder"
              : "Create accounts and periods"}
        </Button>
      </Box>
    </Box>
  );
}
