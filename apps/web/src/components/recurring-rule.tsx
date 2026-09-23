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
import {
  bookKey,
  bookPath,
  mutationOptions,
  readAccounting,
  requiresNewProposal,
} from "@/lib/accounting-api";
import { accountingCopy } from "@/lib/accounting-copy";
import type { Locale } from "@/paraglide/runtime";

export function RecurringRulePanel({
  book,
  id,
  locale,
  onRunCreated,
}: {
  book: typeof Accounting.Book.Type;
  id: string;
  locale: Locale;
  onRunCreated: (id: string) => void;
}) {
  const copy = accountingCopy(locale);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [inputError, setInputError] = useState("");
  const rule = useQuery({
    queryKey: [...bookKey(book), "recurring-rule", id],
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/recurring-rules/${encodeURIComponent(id)}`,
        Automation.RecurringRuleView,
        { signal },
      );
      if (
        view.rule.id !== id ||
        view.rule.scope.bookId !== book.id ||
        view.rule.scope.entityId !== book.entityId
      )
        throw new Error("Rule scope mismatch");
      return view;
    },
    retry: false,
    refetchOnMount: "always",
  });
  const readReady = rule.isSuccess && rule.isFetchedAfterMount && rule.fetchStatus === "idle";
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.auto_rule}</Heading>
      <AccountingStatus locale={locale} pending={rule.isPending} error={rule.error} />
      <Box>
        <Button
          size="xl"
          variant="outline"
          disabled={rule.isFetching}
          onClick={() => {
            void rule.refetch();
          }}
        >
          {copy.journal_refresh}
        </Button>
      </Box>
      {!readReady ? <Text>{copy.auto_unverified_read}</Text> : null}
      {rule.data ? (
        <>
          <RuleFacts rule={rule.data.rule} locale={locale} />
          <Text>
            {rule.data.dependenciesCurrent
              ? copy.auto_dependencies_current
              : copy.auto_dependencies_stale}
          </Text>
          {rule.data.activeActivation ? (
            <>
              <Text>
                {copy.auto_activation_id}: {rule.data.activeActivation.id} ·{" "}
                {rule.data.activeActivation.authority}
              </Text>
              <Text tone="muted">
                {rule.data.activeActivation.actorId} · {rule.data.activeActivation.activatedAt}
              </Text>
            </>
          ) : (
            <Text>{copy.auto_inactive}</Text>
          )}
          <DeactivateRule
            book={book}
            activation={rule.data.activeActivation}
            locale={locale}
            readReady={readReady && book.role === "operator"}
          />
          <CreateRun
            book={book}
            activation={rule.data.activeActivation}
            locale={locale}
            allowed={readReady && rule.data.dependenciesCurrent}
            onCreated={onRunCreated}
          />
          <SimulateRule book={book} ruleId={id} locale={locale} onSimulated={setSimulationId} allowed={readReady} />
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              const savedId = new FormData(event.currentTarget).get("simulationId");
              if (!Schema.is(Accounting.Identifier)(savedId)) {
                setInputError(copy.journal_invalid);
                return;
              }
              setInputError("");
              setSimulationId(savedId);
            }}
          >
            <InputField
              label={copy.auto_simulation_id}
              name="simulationId"
              required
              pattern="[a-z][a-z0-9_\-]{2,127}"
            />
            <Box>
              <Button type="submit" size="xl" variant="outline">
                {copy.auto_load_simulation}
              </Button>
            </Box>
            <Text role="status">{inputError}</Text>
          </Box>
          {simulationId ? (
            <SimulationReview
              book={book}
              id={simulationId}
              view={rule.data}
              locale={locale}
              readReady={readReady}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

function RuleFacts({
  rule,
  locale,
}: {
  rule: typeof Automation.RecurringRule.Type;
  locale: Locale;
}) {
  const copy = accountingCopy(locale);
  return (
    <Box display="grid" gap="md" minWidth="zero">
      <Text>
        {rule.input.name} · {copy.auto_rule_id}: {rule.id} · v{rule.version}
      </Text>
      <Text>
        {copy.auto_rule_digest}: {rule.digest}
      </Text>
      <Text tone="muted">
        {rule.createdAt} · {rule.proposedBy}
      </Text>
      <DataTable
        title={copy.auto_rule}
        narrow="stack"
        columns={[
          { id: "field", label: copy.journal_description },
          { id: "value", label: copy.case_facts },
        ]}
        rows={[
          { id: "source", cells: [copy.bank_source_account, rule.input.sourceBankAccountId] },
          { id: "bank", cells: [copy.auto_bank_account, rule.input.accountId] },
          { id: "counterpart", cells: [copy.auto_counterpart, rule.input.counterpartAccountId] },
          {
            id: "sign",
            cells: [
              copy.auto_sign,
              rule.input.sign === "positive" ? copy.auto_positive : copy.auto_negative,
            ],
          },
          { id: "series", cells: [copy.journal_series, rule.input.series] },
          { id: "tax", cells: ["taxAssessment", rule.input.taxAssessment] },
        ]}
      />
      <Text>{copy.auto_description}</Text>
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
          aria-label={copy.auto_description}
          value={rule.input.description}
          readOnly
          rows={3}
          cols={16}
        />
      </Box>
      <Text tone="muted">{copy.auto_exact_help}</Text>
      <DataTable
        title={copy.journal_dependencies}
        narrow="stack"
        columns={[
          { id: "kind", label: copy.journal_description },
          { id: "resource", label: "ID" },
          { id: "version", label: "Version" },
          { id: "reason", label: copy.journal_rationale },
        ]}
        rows={rule.dependencies.map((dependency) => ({
          id: `${dependency.kind}/${dependency.resourceId}`,
          cells: [dependency.kind, dependency.resourceId, dependency.version, dependency.reason],
        }))}
      />
      <Text tone="muted">
        {copy.bank_receipt}: {rule.receipt.key} · {rule.receipt.operation} · {rule.receipt.actorId}
      </Text>
    </Box>
  );
}

function SimulateRule(props: {
  book: typeof Accounting.Book.Type;
  ruleId: string;
  locale: Locale;
  onSimulated: (id: string) => void;
  allowed: boolean;
}) {
  const { book, ruleId, locale, onSimulated } = props;
  const copy = accountingCopy(locale);
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const [inputError, setInputError] = useState("");
  const simulation = useMutation({
    mutationFn: (payload: typeof Automation.SimulateRecurringRule.Type) => {
      const path = `${bookPath(book)}/recurring-rule-simulations`;
      return readAccounting(
        path,
        Automation.RuleSimulation,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: (result) => {
      client.setQueryData([...bookKey(book), "rule-simulation", result.id], result);
      onSimulated(result.id);
    },
  });
  const captured = simulation.variables;
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (!props.allowed || simulation.isPending || captured) return;
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Automation.SimulateRecurringRule)({
          ruleId,
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        setInputError("");
        simulation.mutate(decoded.value);
      }}
    >
      <Heading>{copy.auto_simulate}</Heading>
      <Box
        as="fieldset"
        disabled={!props.allowed || simulation.isPending || !!captured}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <InputField label={copy.bank_starts} name="startsOn" type="date" required />
          <InputField label={copy.bank_ends} name="endsOn" type="date" required />
        </Box>
        <Box>
          <Button type="submit" size="xl" variant="outline">
            {copy.auto_simulate}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus
        write
        locale={locale}
        pending={simulation.isPending}
        error={simulation.error}
      />
      {captured && simulation.isError ? (
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button type="button" variant="outline" disabled={simulation.isPending}
            onClick={() => simulation.mutate(captured)}>{copy.journal_retry}</Button>
          <Button type="button" variant="outline" disabled={simulation.isPending}
            onClick={() => {
              if (simulation.isPending) return;
              simulation.reset();
              keys.current.clear();
            }}>
            {locale === "sv" ? "Kasta sparad begäran (ångrar inte serverns arbete)" : "Discard saved request (does not undo server work)"}
          </Button>
        </Box>
      ) : null}
      {simulation.data ? (
        <Box>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => {
              if (simulation.isPending) return;
              simulation.reset();
              keys.current.clear();
            }}
          >
            {copy.auto_new_simulation}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function SimulationReview(props: {
  book: typeof Accounting.Book.Type;
  id: string;
  view: typeof Automation.RecurringRuleView.Type;
  locale: Locale;
  readReady: boolean;
}) {
  const { book, id, view, locale } = props;
  const copy = accountingCopy(locale);
  const simulation = useQuery({
    queryKey: [...bookKey(book), "rule-simulation", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/recurring-rule-simulations/${encodeURIComponent(id)}`,
        Automation.RuleSimulation,
        { signal },
      );
      if (result.id !== id) throw new Error("Simulation scope mismatch");
      return result;
    },
    retry: false,
    refetchOnMount: "always",
    staleTime: 0,
  });
  const simulationReady = simulation.isSuccess && simulation.isFetchedAfterMount && simulation.fetchStatus === "idle";
  const matchesRule = simulation.data?.ruleId === view.rule.id && simulation.data?.ruleDigest === view.rule.digest;
  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.auto_simulation}</Heading>
      <AccountingStatus locale={locale} pending={simulation.isPending} error={simulation.error} />
      {simulation.isError ? (
        <Box>
          <Button
            size="xl"
            variant="outline"
            onClick={() => {
              void simulation.refetch();
            }}
          >
            {copy.journal_retry}
          </Button>
        </Box>
      ) : null}
      {simulation.data ? (
        <>
          <Text>
            {copy.auto_simulation_id}: {simulation.data.id} · {simulation.data.createdAt}
          </Text>
          <Text>
            {copy.auto_rule_digest}: {simulation.data.ruleDigest}
          </Text>
          <Text>
            {copy.auto_simulation_digest}: {simulation.data.digest}
          </Text>
          <PreparationSelection selection={simulation.data} locale={locale} />
          <Text tone="muted">
            {copy.bank_receipt}: {simulation.data.receipt.key} · {simulation.data.receipt.actorId}
          </Text>
          {!matchesRule ? <Text role="alert">{copy.auto_activation_mismatch}</Text> : null}
        </>
      ) : null}
      <ActivateRule
        book={book}
        simulation={simulation.data ?? null}
        locale={locale}
        allowed={props.readReady && view.dependenciesCurrent && view.activeActivation === null && simulationReady && matchesRule}
      />
    </Box>
  );
}

function ActivateRule({
  book,
  simulation,
  locale,
  allowed,
}: {
  book: typeof Accounting.Book.Type;
  simulation: typeof Automation.RuleSimulation.Type | null;
  locale: Locale;
  allowed: boolean;
}) {
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const activation = useMutation({
    mutationFn: (payload: typeof Automation.ActivateRecurringRule.Type) => {
      const path = `${bookPath(book)}/recurring-rule-activations`;
      return readAccounting(
        path,
        Automation.RuleActivation,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...bookKey(book), "recurring-rule"] }),
  });
  const captured = activation.variables;
  const canActivate =
    allowed &&
    book.role === "operator" &&
    simulation !== null &&
    simulation.matchingCount > 0 &&
    simulation.blockers.length === 0 &&
    simulation.overlappingRuleIds.length === 0 &&
    !requiresNewProposal(activation.error);
  return (
    <Box display="grid" gap="lg">
      <Heading>{copy.auto_activation}</Heading>
      <Text>{copy.auto_activation_help}</Text>
      <Text>{copy.auto_warning}</Text>
      {book.role === "operator" ? (
        <Box>
          <Button
            size="xl"
            disabled={!canActivate || activation.isPending || !!captured}
            onClick={() => {
              if (!canActivate || !simulation || activation.isPending || captured) return;
              activation.mutate(Schema.decodeSync(Automation.ActivateRecurringRule)({
                ruleId: simulation.ruleId,
                ruleDigest: simulation.ruleDigest,
                simulationId: simulation.id,
                simulationDigest: simulation.digest,
              }));
            }}
          >
            {copy.auto_activate}
          </Button>
        </Box>
      ) : (
        <Text>{copy.auto_operator_only}</Text>
      )}
      <AccountingStatus
        write
        locale={locale}
        pending={activation.isPending}
        error={activation.error}
      />
      {captured ? (
        <Box display="flex" flexWrap="wrap" gap="md">
          {activation.isError ? <Button type="button" variant="outline" disabled={activation.isPending}
            onClick={() => activation.mutate(captured)}>{copy.journal_retry}</Button> : null}
          <Button type="button" variant="outline" disabled={activation.isPending}
            onClick={() => {
              if (activation.isPending) return;
              activation.reset();
              keys.current.clear();
            }}>
            {locale === "sv" ? "Kasta sparad begäran (ångrar inte serverns arbete)" : "Discard saved request (does not undo server work)"}
          </Button>
        </Box>
      ) : null}
      {activation.data ? (
        <Text role="status">
          {copy.auto_activated} · {activation.data.id}
        </Text>
      ) : null}
    </Box>
  );
}

function DeactivateRule({
  book,
  activation,
  locale,
  readReady,
}: {
  book: typeof Accounting.Book.Type;
  activation: typeof Automation.RuleActivation.Type | null;
  locale: Locale;
  readReady: boolean;
}) {
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const deactivation = useMutation({
    mutationFn: (payload: typeof Automation.DeactivateRecurringRule.Type) => {
      const path = `${bookPath(book)}/recurring-rule-deactivations`;
      return readAccounting(
        path,
        Automation.RuleDeactivation,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: () => client.invalidateQueries({ queryKey: [...bookKey(book), "recurring-rule"] }),
  });
  const captured = deactivation.variables;
  return (
    <Box
      as="form"
      display="grid"
      gap="md"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readReady || !activation || deactivation.isPending || captured) return;
        const decoded = Schema.decodeUnknownOption(Automation.DeactivateRecurringRule)({
          activationId: activation?.id,
          reason: new FormData(event.currentTarget).get("reason"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        setInputError("");
        deactivation.mutate(decoded.value);
      }}
    >
      <InputField
        label={copy.journal_rationale}
        name="reason"
        required
        maxLength={2000}
        disabled={!readReady || !activation || deactivation.isPending || !!captured}
      />
      <Box>
        <Button
          type="submit"
          size="xl"
          variant="outline"
          disabled={!readReady || !activation || deactivation.isPending || !!captured}
        >
          {copy.auto_deactivate}
        </Button>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus
        write
        locale={locale}
        pending={deactivation.isPending}
        error={deactivation.error}
      />
      {captured ? (
        <Box display="flex" flexWrap="wrap" gap="md">
          {deactivation.isError ? <Button type="button" variant="outline" disabled={deactivation.isPending}
            onClick={() => deactivation.mutate(captured)}>{copy.journal_retry}</Button> : null}
          <Button type="button" variant="outline" disabled={deactivation.isPending}
            onClick={() => {
              if (deactivation.isPending) return;
              deactivation.reset();
              keys.current.clear();
            }}>
            {locale === "sv" ? "Kasta sparad begäran (ångrar inte serverns arbete)" : "Discard saved request (does not undo server work)"}
          </Button>
        </Box>
      ) : null}
      {deactivation.data ? <Text role="status">{copy.auto_deactivated}</Text> : null}
    </Box>
  );
}

function CreateRun(props: {
  book: typeof Accounting.Book.Type;
  activation: typeof Automation.RuleActivation.Type | null;
  locale: Locale;
  allowed: boolean;
  onCreated: (id: string) => void;
}) {
  const { book, activation, locale, allowed } = props;
  const copy = accountingCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [inputError, setInputError] = useState("");
  const run = useMutation({
    mutationFn: (payload: typeof Automation.CreatePreparationRun.Type) => {
      const path = `${bookPath(book)}/preparation-runs`;
      return readAccounting(
        path,
        Automation.PreparationRun,
        mutationOptions(path, JSON.stringify(payload), keys.current),
      );
    },
    onSuccess: async (result) => {
      const queryKey = [...bookKey(book), "preparation-run", result.id];
      await client.cancelQueries({ queryKey, exact: true });
      void client.invalidateQueries({ queryKey, exact: true });
      props.onCreated(result.id);
    },
  });
  const captured = run.variables;
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        if (!allowed || !activation || run.isPending || captured) return;
        const fields = new FormData(event.currentTarget);
        const decoded = Schema.decodeUnknownOption(Automation.CreatePreparationRun)({
          activationId: activation?.id,
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
        });
        if (decoded._tag === "None") {
          setInputError(copy.journal_invalid);
          return;
        }
        setInputError("");
        run.mutate(decoded.value);
      }}
    >
      <Heading>{copy.auto_create_run}</Heading>
      <Text tone="muted">{copy.auto_run_help}</Text>
      <Text>
        {copy.auto_activation_id}: {activation?.id ?? "—"}
      </Text>
      <Box
        as="fieldset"
        disabled={!allowed || !activation || run.isPending || !!captured}
        borderWidth="none"
        padding="none"
        margin="none"
        minWidth="zero"
        display="grid"
        gap="lg"
      >
        <Box display="grid" columns={1} columnsAtSm={2} gap="lg">
          <InputField label={copy.bank_starts} name="startsOn" type="date" required />
          <InputField label={copy.bank_ends} name="endsOn" type="date" required />
        </Box>
        <Box>
          <Button type="submit" size="xl">
            {copy.auto_create_run}
          </Button>
        </Box>
      </Box>
      <Text role="status">{inputError}</Text>
      <AccountingStatus write locale={locale} pending={run.isPending} error={run.error} />
      {captured && run.isError ? (
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button type="button" variant="outline" disabled={run.isPending}
            onClick={() => run.mutate(captured)}>{copy.journal_retry}</Button>
          <Button type="button" variant="outline" disabled={run.isPending}
            onClick={() => {
              if (run.isPending) return;
              run.reset();
              keys.current.clear();
            }}>
            {locale === "sv" ? "Kasta sparad begäran (ångrar inte serverns arbete)" : "Discard saved request (does not undo server work)"}
          </Button>
        </Box>
      ) : null}
      {run.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>
            {copy.auto_run_id}: {run.data.id}
          </Text>
          <Box>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                if (run.isPending) return;
                run.reset();
                keys.current.clear();
              }}
            >
              {copy.auto_new_run}
            </Button>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
