import { useQuery } from "@tanstack/react-query";
import * as Delta from "@open-erp/contracts/onboarding-deltas";
import * as Sie from "@open-erp/contracts/sie-import";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { SetupBlock, SetupText } from "@open-erp/ui/components/setup-parts";
import { SetupButton } from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace } from "@/lib/book-context";
import { formatMoment, useOnboardingCommand } from "./data";
import type { Lifecycle } from "./lifecycle";

function DeltaEffectRow({
  view,
  row,
  plan,
  lifecycle,
}: {
  view: typeof Delta.OnboardingDeltaView.Type;
  row: typeof Delta.OnboardingDeltaRow.Type;
  plan: typeof Sie.SiePlan.Type | undefined;
  lifecycle: Lifecycle;
}) {
  const { book, setup } = useBookWorkspace();

  const decision = view.decisions
    .filter((entry) => entry.sourceReference === row.sourceReference)
    .at(-1);

  const proposal = view.proposals.find(
    (entry) => entry.sourceReference === row.sourceReference && entry.decisionId === decision?.id,
  );

  const effect = view.effects.find((entry) => entry.sourceReference === row.sourceReference);

  const prepare = useOnboardingCommand(
    `${bookPath(book)}/onboarding/source-delta-proposals`,
    Delta.PrepareOnboardingDeltaEffect,
    Delta.OnboardingDeltaProposal,
  );

  const source = row.candidate ?? row.previous;

  const date = source
    ? `${source.date.slice(0, 4)}-${source.date.slice(4, 6)}-${source.date.slice(6, 8)}`
    : null;

  const period = setup.periods.find(
    (entry) => date && entry.startsOn <= date && entry.endsOn >= date && !entry.locked,
  );

  const name = (id: string) =>
    lifecycle.people.find((person) => person.id === id)?.name ?? "Okänd person";

  return (
    <SetupBlock layout={["stack12"]}>
      <SetupText>
        {row.sourceReference.replace(":", "")} /{" "}
        {
          {
            new: "Nytt verifikat",
            removed: "Borttaget i källan",
            changed: "Uppdaterat verifikat",
            unchanged: "Oförändrat verifikat",
          }[row.kind]
        }
      </SetupText>
      {effect ? (
        <SetupText>
          Importerat av {name(effect.executedBy)}, {formatMoment(effect.executedAt)}.
        </SetupText>
      ) : decision?.choice === "keep_previous" ? (
        <SetupText>Tidigare bokföring behålls.</SetupText>
      ) : !proposal ? (
        <SetupButton
          variant="outline"
          disabled={
            prepare.disabled ||
            !plan ||
            !period ||
            decision?.choice !== "use_change" ||
            !view.current
          }
          onClick={() => {
            if (plan && period)
              prepare.mutate(
                prepare.uncertain && prepare.variables
                  ? prepare.variables
                  : {
                      deltaId: view.delta.id,
                      expectedDeltaDigest: view.delta.digest,
                      sourceReference: row.sourceReference,
                      sourcePlanId: plan.id,
                      expectedSourcePlanDigest: plan.digest,
                      accountingPeriodId: period.id,
                      rationale: "Förbered den valda ändringen från slutligt underlag",
                    },
              );
          }}
        >
          Förbered ändringen
        </SetupButton>
      ) : (
        <PreparedDeltaEffect proposal={proposal} lifecycle={lifecycle} />
      )}
      <AccountingStatus locale="sv" pending={prepare.isPending} error={prepare.error} write />
    </SetupBlock>
  );
}

function PreparedDeltaEffect({
  proposal,
  lifecycle,
}: {
  proposal: typeof Delta.OnboardingDeltaProposal.Type;
  lifecycle: Lifecycle;
}) {
  const { book } = useBookWorkspace();

  const current = useQuery({
    queryKey: [...bookKey(book), "onboarding", "delta-proposal", proposal?.id],
    enabled: true,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/onboarding/source-delta-proposals/${encodeURIComponent(proposal?.id ?? "")}`,
        Delta.OnboardingDeltaProposalView,
        { signal },
      ),
    retry: false,
  });

  const approve = useOnboardingCommand(
    `${bookPath(book)}/onboarding/source-delta-approvals`,
    Delta.ApproveOnboardingDeltaEffect,
    Delta.OnboardingDeltaApproval,
  );

  const execute = useOnboardingCommand(
    `${bookPath(book)}/onboarding/source-delta-effects`,
    Delta.ExecuteOnboardingDeltaEffect,
    Delta.OnboardingDeltaEffect,
  );

  const approvalIds =
    proposal?.changes.flatMap((change) => {
      const approval = current.data?.approvals.find((entry) => entry.changeSetId === change.id);

      return approval ? [approval.id] : [];
    }) ?? [];

  const accepted = !!proposal && approvalIds.length === proposal.changes.length;

  const name = (id: string) =>
    lifecycle.people.find((person) => person.id === id)?.name ?? "Okänd person";

  return (
    <>
      <SetupText>
        Förberett av {name(proposal.preparedBy)}, {formatMoment(proposal.preparedAt)}.
      </SetupText>
      {accepted ? (
        <SetupButton
          disabled={execute.disabled || !current.data?.current}
          onClick={() =>
            execute.mutate(
              execute.uncertain && execute.variables
                ? execute.variables
                : { proposalId: proposal.id, expectedDigest: proposal.digest, approvalIds },
            )
          }
        >
          Importera ändringen
        </SetupButton>
      ) : (
        <SetupButton
          variant="outline"
          disabled={
            approve.disabled ||
            proposal.preparedBy === lifecycle.viewerActorId ||
            !current.data?.current ||
            lifecycle.responsibilities?.assignments.bookkeepingApproverId !==
              lifecycle.viewerActorId
          }
          onClick={() =>
            approve.mutate(
              approve.uncertain && approve.variables
                ? approve.variables
                : { proposalId: proposal.id, expectedDigest: proposal.digest },
            )
          }
        >
          Godkänn ändringen
        </SetupButton>
      )}
      <AccountingStatus
        locale="sv"
        pending={approve.isPending || execute.isPending || current.isPending}
        error={approve.error ?? execute.error ?? current.error}
        write
      />
    </>
  );
}

export function DeltaEffectsDialog({
  view,
  plan,
  lifecycle,
  close,
}: {
  view: typeof Delta.OnboardingDeltaView.Type;
  plan: typeof Sie.SiePlan.Type | undefined;
  lifecycle: Lifecycle;
  close: () => void;
}) {
  return (
    <FormDialog
      size="compact"
      title="Importera ändringarna"
      closeLabel="Stäng"
      onClose={close}
      onEscape={close}
    >
      <SetupBlock layout={["stack"]}>
        {view.delta.rows
          .filter((row) => row.kind !== "unchanged")
          .map((row) => (
            <DeltaEffectRow
              key={row.sourceReference}
              view={view}
              row={row}
              plan={plan}
              lifecycle={lifecycle}
            />
          ))}
      </SetupBlock>
    </FormDialog>
  );
}
