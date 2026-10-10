import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import * as Recovery from "@open-erp/contracts/paid-payroll-recovery";
import { Action } from "@open-erp/ui/kanon/action";
import {
  DetailPanelSurface,
  DetailPanelHeader,
  DetailPanelActions,
  PanelSection,
} from "@open-erp/ui/kanon/detail-panel";
import {
  FormColumn,
  FormText,
  FormNote,
  SelectField,
  InputField,
  PlainFacts,
  FormLink,
} from "@open-erp/ui/kanon/form";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";
import { PaidRecoveryCompletion } from "./paid-recovery-completion";
import { payrollMonth, nextPayrollMonth } from "./paid-recovery-presentation";
import { usePaidRecovery } from "./use-paid-recovery";

export function PaidRecoveryPanel({ recoveryId }: { recoveryId: string }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const state = usePaidRecovery(recoveryId);
  const [sourceId, setSourceId] = useState("");
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");

  const view = state.query.data;

  if (!view)
    return (
      <AccountingStatus locale={locale} pending={state.query.isPending} error={state.query.error} />
    );
  const assessment = view.assessment;
  const scale = view.originalPaidEvent.originalEmployee.calculation.calculation.currencyScale;
  const money = (value: string) => formatMinorAmount(value, scale, locale);
  const digest = assessment.digest;
  const attachment = view.attachments.at(-1);

  return (
    <DetailPanelSurface label={sv ? "Valt återkrav" : "Selected recovery"}>
      <DetailPanelHeader
        figureAs="h2"
        kickerTone={recoveryTone(view)}
        kicker={recoveryKicker(view, sv)}
        figure={money(assessment.targetMinor)}
        subtitle={`${assessment.employee.name}, ${sv ? "betald lön" : "paid payroll"} ${payrollMonth(assessment.original.reportingPeriod, locale)}.`}
      />
      <RecoveryBlockers view={view} money={money} sv={sv} />
      <PanelSection record label={sv ? "Jämförelse" : "Comparison"}>
        <PlainFacts
          compact
          presentation="record"
          align="end"
          facts={[
            {
              label: sv ? "Betald bruttolön" : "Paid gross",
              value: money(assessment.original.grossMinor),
            },
            {
              label: sv ? "Korrigerad bruttolön" : "Corrected gross",
              value: money(view.comparison.calculation.grossMinor),
            },
            {
              label: sv ? "Arbetsgivaravgift, ändring" : "Employer contribution change",
              value: money(assessment.contributionDeltaMinor),
            },
          ]}
        />
      </PanelSection>
      <RecoverySplitProposal view={view} money={money} sv={sv} />
      <RecoveryEvidencePicker
        view={view}
        blocked={state.blocked}
        sourceId={sourceId}
        onSourceChange={setSourceId}
        reason={reason}
        onReasonChange={setReason}
      />
      <AccountingStatus
        locale={locale}
        pending={state.command.isPending}
        error={state.command.error}
      />
      {state.captured && (state.command.isError || state.recovery.saved) ? (
        <Action
          kind="secondary"
          onClick={() => {
            if (state.captured) state.command.mutate(state.captured);
          }}
        >
          {sv ? "Försök igen med exakt begäran" : "Retry the exact request"}
        </Action>
      ) : null}
      {cancelling ? (
        <PanelSection record label={sv ? "Avbryt försök" : "Cancel attempt"}>
          <InputField
            label={sv ? "Orsak till avbrott" : "Cancellation reason"}
            value={cancellationReason}
            onChange={(event) => setCancellationReason(event.currentTarget.value)}
            required
          />
          <Action
            kind="secondary"
            disabled={state.blocked || !cancellationReason.trim()}
            onClick={() =>
              state.execute({
                kind: "cancel",
                input: { assessmentDigest: digest, reason: cancellationReason },
              })
            }
          >
            {sv ? "Bekräfta avbrott" : "Confirm cancellation"}
          </Action>
        </PanelSection>
      ) : null}
      {view.cancellation ? (
        <FormText>{sv ? "Försöket är avbrutet" : "The attempt is cancelled"}</FormText>
      ) : null}
      {attachment ? (
        <FormLink
          href={`${workspacePath(book)}/tax?view=payroll&record=${encodeURIComponent(assessment.original.runId)}`}
        >
          {sv ? "Visa ursprunglig lönekörning" : "View original payroll run"}
        </FormLink>
      ) : null}
      <PaidRecoveryCompletion view={view} />
      <DetailPanelActions
        primary={
          <Action
            kind="secondary"
            presentation="record"
            besidePrimary
            fill
            disabled={state.blocked || !view.current.canSplit}
            onClick={() => state.execute({ kind: "split", input: { assessmentDigest: digest } })}
          >
            {sv ? "Spara uppdelning" : "Save split"}
          </Action>
        }
        secondary={
          <Action
            kind="secondary"
            fill
            disabled={state.blocked || !view.current.canAttach || !sourceId || !reason.trim()}
            onClick={() =>
              state.execute({
                kind: "attach",
                input: { assessmentDigest: digest, evidenceId: sourceId, reason },
              })
            }
          >
            {sv ? "Bifoga underlag" : "Attach evidence"}
          </Action>
        }
        tertiary={
          <Action
            kind="quiet"
            disabled={state.blocked || !view.current.canCancel}
            onClick={() => setCancelling((value) => !value)}
          >
            {sv ? "Avbryt försök" : "Cancel attempt"}
          </Action>
        }
      />
    </DetailPanelSurface>
  );
}

function RecoveryBlockers({
  view,
  money,
  sv,
}: {
  view: typeof Recovery.PaidRecoveryView.Type;
  money: (value: string) => string;
  sv: boolean;
}) {
  if (view.cancellation) return null;

  return (
    <FormColumn compact>
      {view.assessment.blockers.includes("missing_lawful_basis") ? (
        <FormText record tone="needsYou">
          {sv ? "Underlag för kvittning saknas." : "Offset evidence is missing."}
        </FormText>
      ) : null}
      {view.assessment.blockers.includes("insufficient_net_capacity") ? (
        <FormText record tone="needsYou">
          {sv
            ? `Nettolönen i ${payrollMonth(view.assessment.capacity.month, "sv").split(" ")[0]} räcker inte. ${money(view.assessment.shortfallMinor)} återstår.`
            : `Net pay is insufficient. ${money(view.assessment.shortfallMinor)} remains.`}
        </FormText>
      ) : null}
    </FormColumn>
  );
}

type RecoveryView = typeof Recovery.PaidRecoveryView.Type;

function RecoverySplitProposal({
  view,
  money,
  sv,
}: {
  view: RecoveryView;
  money: (value: string) => string;
  sv: boolean;
}) {
  const assessment = view.assessment;
  const saved = view.drafts.at(-1);

  return (
    <PanelSection record label={sv ? "Förslag på uppdelning" : "Split proposal"}>
      <PlainFacts
        compact
        presentation="record"
        align="end"
        facts={
          saved
            ? saved.legs.map((leg) => ({
                label: `${payrollMonth(leg.month, sv ? "sv" : "en", true).split(" ")[0]}, ${leg.capacityCalculationId ? (sv ? "sparad nettolön" : "saved net") : sv ? "kapacitet okänd" : "capacity unknown"}`,
                value: money(leg.amountMinor),
              }))
            : [
                {
                  label: `${payrollMonth(assessment.capacity.month, sv ? "sv" : "en", true).split(" ")[0]}, ${sv ? "sparad nettolön" : "saved net"}`,
                  value: money(assessment.capacity.availableNetMinor),
                },
                {
                  label: `${payrollMonth(nextPayrollMonth(assessment.capacity.month), sv ? "sv" : "en", true).split(" ")[0]}, ${sv ? "kapacitet okänd" : "capacity unknown"}`,
                  value: money(assessment.shortfallMinor),
                },
              ]
        }
      />
      {saved?.legs.some((leg) => leg.capacityCalculationId === null) ? (
        <FormNote>{sv ? "Senare kapacitet är inte känd" : "Later capacity is unknown"}</FormNote>
      ) : null}
      <FormText>
        {sv
          ? "Förslaget bokför inget. Fordran och varje kvittning kräver eget underlag och godkännande."
          : "The proposal posts nothing. The claim and each offset require their own evidence and approval."}
      </FormText>
    </PanelSection>
  );
}

function RecoveryEvidencePicker(props: {
  view: RecoveryView;
  blocked: boolean;
  sourceId: string;
  onSourceChange: (value: string) => void;
  reason: string;
  onReasonChange: (value: string) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const view = props.view;
  const attachment = view.attachments.at(-1);

  const sources = useInfiniteQuery({
    queryKey: [...bookKey(book), "payroll", "recovery-basis-sources"],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const page = await readAccounting(
        `${bookPath(book)}/payroll/paid-recovery-basis-sources${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Recovery.PaidRecoveryBasisSources,
        { signal },
      );

      if (page.scope.entityId !== book.entityId || page.scope.bookId !== book.id)
        throw new Error("Recovery source scope mismatch");

      return page;
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });

  const choices = sources.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PanelSection record label={sv ? "Underlag" : "Evidence"}>
      <SelectField
        label={sv ? "Underlag" : "Evidence"}
        record
        labelHidden
        value={props.sourceId}
        onValueChange={props.onSourceChange}
        options={[
          { value: "", label: sv ? "Välj sparat underlag" : "Choose saved evidence" },
          ...choices.map((source) => ({ value: source.id, label: source.title })),
        ]}
        disabled={props.blocked || !view.current.canAttach}
      />
      <AccountingStatus locale={locale} pending={sources.isPending} error={sources.error} />
      {sources.hasNextPage ? (
        <Action
          kind="quiet"
          disabled={sources.isFetchingNextPage}
          onClick={() => void sources.fetchNextPage()}
        >
          {sv ? "Fler underlag" : "More evidence"}
        </Action>
      ) : null}
      {props.sourceId ? (
        <InputField
          label={sv ? "Motivering" : "Reason"}
          value={props.reason}
          onChange={(event) => props.onReasonChange(event.currentTarget.value)}
          required
          disabled={props.blocked}
        />
      ) : null}
      <FormText>
        {attachment && !view.qualifications.length
          ? sv
            ? "Underlaget är inte kvalificerat"
            : "The evidence is not qualified"
          : view.qualifications.length
            ? sv
              ? "Oberoende kvalificering är sparad."
              : "Independent qualification is saved."
            : sv
              ? "Ingen oberoende granskning finns ännu."
              : "No independent review exists yet."}
      </FormText>
    </PanelSection>
  );
}

function recoveryKicker(view: RecoveryView, sv: boolean) {
  if (view.cancellation) return sv ? "Avbrutet" : "Cancelled";

  if (view.claimExecution) return sv ? "Fordran bokförd" : "Claim posted";

  return sv ? "Kan inte kvittas" : "Cannot offset";
}

function recoveryTone(view: RecoveryView) {
  if (view.cancellation || view.claimExecution) return undefined;

  return "needsYou" as const;
}
