import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Automation from "@open-erp/contracts/automation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function RecurringRuleForm({
  book,
  setup,
  locale,
  onProposed,
}: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
  onProposed: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const descriptionId = useId();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const proposal = useMutation({
    mutationFn: (payload: typeof Automation.ProposeRecurringRule.Type) => {
      const path = `${bookPath(book)}/recurring-rules`;
      return readAccounting(
        path,
        Automation.RecurringRule,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (rule) => onProposed(rule.id),
  });
  const accounts = setup.accounts.map((account) => ({
    value: account.id,
    label: `${account.code} · ${account.name} · ${account.id}`,
    disabled: !account.active,
  }));
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Automation.ProposeRecurringRule)({
          kind: "synthetic_recurring_preparation_v1",
          name: fields.get("name"),
          sourceBankAccountId: fields.get("sourceBankAccountId"),
          accountId: fields.get("accountId"),
          description: fields.get("description"),
          sign: fields.get("sign"),
          counterpartAccountId: fields.get("counterpartAccountId"),
          series: fields.get("series"),
          taxAssessment: "not_applicable",
        });
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        if (decoded.value.accountId === decoded.value.counterpartAccountId) {
          setInputError(copy.auto_different_accounts);
          return;
        }
        setInputError("");
        proposal.mutate(decoded.value);
      }}
    >
      <Heading>{copy.auto_propose}</Heading>
      <Text>{copy.journal_manual_scope}</Text>
      <Box
        as="fieldset"
        disabled={proposal.isPending || proposal.isSuccess}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <InputField label={copy.auto_name} name="name" required maxLength={2000} />
        <InputField
          label={copy.bank_source_account}
          name="sourceBankAccountId"
          required
          maxLength={200}
          autoCapitalize="off"
        />
        <SelectField label={copy.auto_bank_account} name="accountId" required options={accounts} />
        <Label htmlFor={descriptionId}>{copy.auto_description}</Label>
        <Text tone="muted">{copy.auto_exact_help}</Text>
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
            id={descriptionId}
            name="description"
            required
            maxLength={2000}
            rows={3}
            cols={16}
            spellCheck={false}
          />
        </Box>
        <SelectField
          label={copy.auto_sign}
          name="sign"
          required
          options={[
            { value: "positive", label: copy.auto_positive },
            { value: "negative", label: copy.auto_negative },
          ]}
        />
        <SelectField
          label={copy.auto_counterpart}
          name="counterpartAccountId"
          required
          options={accounts}
        />
        <InputField
          label={copy.journal_series}
          name="series"
          required
          maxLength={16}
          pattern="[A-Z0-9]{1,16}"
        />
        <Box>
          <Button type="submit" size="xl">
            {copy.auto_propose}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={proposal.isPending} error={proposal.error} />
      {proposal.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>
            {copy.auto_rule_id}: {proposal.data.id}
          </Text>
          <Text>
            {copy.auto_rule_digest}: {proposal.data.digest}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                proposal.reset();
                keys.current.clear();
              }}
            >
              {copy.auto_new_rule}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
