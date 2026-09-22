import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Automation from "@open-erp/contracts/automation";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { PreparationSelection } from "@/components/preparation-selection";
import { PreparationBackground } from "@/components/preparation-background";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function PreparationRunPanel({
  book,
  id,
  locale,
  onPrepared,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const run = useQuery({
    queryKey: [...bookKey(book), "preparation-run", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/preparation-runs/${encodeURIComponent(id)}`,
        Automation.PreparationRun,
        { signal },
      );
      if (
        result.id !== id ||
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId
      )
        throw new Error("Preparation run scope mismatch");
      return result;
    },
    retry: false,
    refetchInterval: (query) => (query.state.data?.state === "ready" ? 3000 : false),
  });
  const state = {
    ready: copy.auto_ready,
    blocked: copy.auto_blocked,
    cancelled: copy.auto_cancelled,
    completed: copy.auto_completed,
  };
  const readReady = run.isSuccess && !run.isFetching;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.auto_run}</Heading>
      <Text>{copy.auto_warning}</Text>
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={run.isFetching}
          onClick={() => {
            void run.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={run.isPending} error={run.error} />
      {!readReady ? <Text>{copy.auto_unverified_read}</Text> : null}
      {run.data ? (
        <>
          <Text>
            {copy.auto_run_id}: {run.data.id}
          </Text>
          <Text>
            {copy.auto_rule_id}: {run.data.ruleId} · {copy.auto_activation_id}:{" "}
            {run.data.activationId}
          </Text>
          <Text>
            {copy.auto_rule_digest}: {run.data.ruleDigest}
          </Text>
          <Box
            role="status"
            display="grid"
            gap="md"
            padding="lg"
            backgroundColor="muted"
            borderRadius="surface"
          >
            <Text>
              {copy.auto_state}: {state[run.data.state]}
            </Text>
            <Text>
              {copy.auto_cursor}: {run.data.cursor} / {run.data.total}
            </Text>
            {run.data.blocker ? (
              <Text>
                {run.data.blocker.code}: {run.data.blocker.message}
              </Text>
            ) : null}
          </Box>
          <RunCommands book={book} run={run.data} locale={locale} readReady={readReady} />
          <PreparationBackground
            book={book}
            runId={id}
            locale={locale}
            ready={readReady && run.data.state === "ready"}
          />
          <details>
            <summary>{copy.auto_selection}</summary>
            <Box display="grid" gap="lg" paddingBlock="lg" minWidth="zero">
              <PreparationSelection selection={run.data.selection} locale={locale} />
            </Box>
          </details>
          <RunResults run={run.data} locale={locale} onPrepared={onPrepared} />
          <DataTable
            title={copy.auto_audit}
            narrow="stack"
            columns={[
              { id: "index", label: "#" },
              { id: "action", label: copy.auto_action },
              { id: "state", label: copy.auto_state },
              { id: "cursor", label: copy.auto_cursor },
              { id: "blocker", label: copy.auto_blockers },
              { id: "actor", label: copy.auto_actor },
              { id: "date", label: copy.auto_recorded_at },
              { id: "receipt", label: copy.bank_receipt },
            ]}
            rows={run.data.audit.map((entry) => ({
              id: String(entry.index),
              cells: [
                String(entry.index),
                entry.action,
                state[entry.state],
                String(entry.cursor),
                entry.blocker ? `${entry.blocker.code}: ${entry.blocker.message}` : "—",
                entry.actorId,
                entry.recordedAt,
                `${entry.receipt.key} · ${entry.receipt.operation}`,
              ],
            }))}
          />
        </>
      ) : null}
    </Box>
  );
}

function RunCommands({
  book,
  run,
  locale,
  readReady,
}: {
  book: typeof Accounting.Book.Type;
  run: typeof Automation.PreparationRun.Type;
  locale: Locale;
  readReady: boolean;
}) {
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [batch, setBatch] = useState("20");
  const [inputError, setInputError] = useState("");
  const command = useMutation({
    mutationFn: (payload: typeof Automation.AdvancePreparationRun.Type) => {
      const path = `${bookPath(book)}/preparation-runs/${encodeURIComponent(run.id)}/advance`;
      return readAccounting(
        path,
        Automation.PreparationRun,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (result) => {
      client.setQueryData([...bookKey(book), "preparation-run", run.id], result);
      // A confirmed response ends this command; the next bounded step needs a new key.
      keys.current.clear();
      return client.invalidateQueries({ queryKey: [...bookKey(book), "preparation-run", run.id] });
    },
    onError: (error) => {
      if (error instanceof Accounting.AccountingError)
        void client.invalidateQueries({ queryKey: [...bookKey(book), "preparation-run", run.id] });
    },
  });
  function advance(action: (typeof Automation.AdvancePreparationRun.Type)["action"]) {
    const decoded = Schema.decodeOption(Automation.AdvancePreparationRun)({
      action,
      maxItems: action === "cancel" ? 1 : Number(batch),
    });
    if (decoded._tag === "None") {
      setInputError(copy.journal_invalid);
      return;
    }
    setInputError("");
    command.mutate(decoded.value);
  }
  const uncertain = command.isError && !(command.error instanceof Accounting.AccountingError);
  const disabled = !readReady || command.isPending || uncertain;
  return (
    <Box display="grid" gap="lg">
      <Text tone="muted">{copy.auto_cancel_help}</Text>
      <InputField
        label={copy.auto_batch}
        value={batch}
        onChange={(event) => setBatch(event.target.value)}
        inputMode="numeric"
        pattern="([1-9]|1[0-9]|20)"
        disabled={disabled || run.state === "completed"}
      />
      <Box display="flex" flexWrap="wrap" gap="lg">
        <Button
          size="xl"
          disabled={disabled || run.state !== "ready"}
          onClick={() => advance("continue")}
        >
          {copy.auto_continue}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={disabled || (run.state !== "ready" && run.state !== "blocked")}
          onClick={() => advance("cancel")}
        >
          {copy.auto_cancel}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={disabled || (run.state !== "cancelled" && run.state !== "blocked")}
          onClick={() => advance("resume")}
        >
          {copy.auto_resume}
        </Button>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={command.isPending} error={command.error} />
      {uncertain ? (
        <Box display="grid" gap="md">
          <Text>{copy.auto_uncertain}</Text>
          <Box>
            <Button
              size="xl"
              variant="outline"
              disabled={command.isPending}
              onClick={() => {
                if (command.variables) command.mutate(command.variables);
              }}
            >
              {copy.auto_retry}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

function RunResults({
  run,
  locale,
  onPrepared,
}: {
  run: typeof Automation.PreparationRun.Type;
  locale: Locale;
  onPrepared: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const state = {
    prepared: copy.auto_prepared,
    recovered: copy.auto_recovered,
    already_posted: copy.auto_already_posted,
    skipped_matched: copy.auto_skipped,
  };
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={copy.auto_results}
        narrow="stack"
        columns={[
          { id: "source", label: copy.bank_statement_id },
          { id: "ordinal", label: copy.bank_ordinal },
          { id: "state", label: copy.auto_result_state },
          { id: "plan", label: copy.journal_plan_id },
          { id: "digest", label: copy.journal_digest },
          { id: "voucher", label: copy.journal_voucher },
        ]}
        rows={run.results.map((result) => ({
          id: `${result.statementId}/${result.rowOrdinal}`,
          cells: [
            result.statementId,
            String(result.rowOrdinal),
            state[result.state],
            <Box key={`${result.statementId}/${result.rowOrdinal}`} display="grid" gap="sm">
              <Text>{result.changeSetId ?? "—"}</Text>
              {result.changeSetId &&
              (result.state === "prepared" || result.state === "recovered") ? (
                <Button
                  size="xl"
                  variant="outline"
                  onClick={() => {
                    if (result.changeSetId) onPrepared(result.changeSetId);
                    requestAnimationFrame(() => document.getElementById("journal-review")?.focus());
                  }}
                >
                  {copy.auto_review_plan}
                </Button>
              ) : null}
            </Box>,
            result.planDigest ?? "—",
            result.voucherId ?? "—",
          ],
        }))}
      />
      {run.results.length === 0 ? <Text>{copy.bank_empty}</Text> : null}
    </Box>
  );
}
