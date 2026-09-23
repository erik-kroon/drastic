import { useState } from "react";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { RecurringRuleForm } from "@/components/recurring-rule-form";
import { RecurringRulePanel } from "@/components/recurring-rule";
import { PreparationRunPanel } from "@/components/preparation-run";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function RecurringPreparation(props: {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type | undefined;
  locale: Locale;
  onPrepared: (id: string) => void;
  open?: boolean;
}) {
  const { book, setup, locale, onPrepared } = props;
  const copy = accountingCopy(locale);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [inputError, setInputError] = useState("");
  return (
    <details open={props.open} id="recurring-preparation" tabIndex={-1}>
      <summary>{copy.auto_title}</summary>
      <Box display="grid" gap="2xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.auto_title}</Heading>
        <Box padding="lg" backgroundColor="muted" borderRadius="surface">
          <Text>{copy.auto_warning}</Text>
        </Box>
        {setup && setup.blockers.length === 0 ? (
          <RecurringRuleForm book={book} setup={setup} locale={locale} onProposed={setRuleId} />
        ) : null}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("ruleId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setInputError(copy.journal_invalid);
              return;
            }
            setInputError("");
            setRuleId(id);
          }}
        >
          <InputField
            label={copy.auto_rule_id}
            name="ruleId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.auto_load_rule}
            </Button>
          </Box>
        </Box>
        {ruleId ? (
          <RecurringRulePanel
            key={ruleId}
            book={book}
            id={ruleId}
            locale={locale}
            onRunCreated={setRunId}
          />
        ) : null}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("runId");
            if (!Schema.is(Accounting.Identifier)(id)) {
              setInputError(copy.journal_invalid);
              return;
            }
            setInputError("");
            setRunId(id);
          }}
        >
          <InputField
            label={copy.auto_run_id}
            name="runId"
            required
            pattern="[a-z][a-z0-9_\-]{2,127}"
          />
          <Box>
            <Button type="submit" size="xl" variant="outline">
              {copy.auto_load_run}
            </Button>
          </Box>
        </Box>
        <Text role="status">{inputError}</Text>
        {runId ? (
          <PreparationRunPanel
            key={runId}
            book={book}
            id={runId}
            locale={locale}
            onPrepared={onPrepared}
          />
        ) : null}
      </Box>
    </details>
  );
}
