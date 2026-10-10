import { bookScope, httpQuery, httpRequest } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import * as Schema from "effect/Schema";
import { useQuery } from "@tanstack/react-query";
import * as O from "@open-erp/contracts/onboarding";
import * as Historical from "@open-erp/contracts/historical-migration";
import * as Sie from "@open-erp/contracts/sie-import";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { SetupBlock, SetupText } from "@open-erp/ui/components/setup-parts";
import { SetupButton } from "@open-erp/ui/components/setup-workspace";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatDate, formatMinor, formatMoment, useOnboardingCommand } from "./data";
import {
  currentSnapshot,
  hasDecision,
  personName,
  type Lifecycle,
  type Workspace,
} from "./lifecycle";
import { PendingRead, SetupLink, type OpenOnboardingView } from "./shared";
import { useSieSource } from "./sources";

export function useInitialImport(
  workspace: Workspace,
  lifecycle: Lifecycle,
  open: OpenOnboardingView,
) {
  const { book, setup } = useBookWorkspace();
  const source = useSieSource(workspace);

  const start = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/imports`,
      execute: (client, requestOptions) =>
        client.onboarding.startOnboardingImport(
          httpRequest(
            Api.groups.onboarding.endpoints.startOnboardingImport,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    O.StartOnboardingImport,
    O.OnboardingImportStart,
    () => open("opening"),
  );

  const prepare = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/import-plans`,
      execute: (client, requestOptions) =>
        client.onboarding.prepareOnboardingImportPlan(
          httpRequest(
            Api.groups.onboarding.endpoints.prepareOnboardingImportPlan,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    O.PrepareOnboardingImportPlan,
    Sie.SiePlan,
    (plan) =>
      start.mutate({
        expectedRevision: workspace.case.revision,
        sourcePlanId: plan.id,
        expectedSourcePlanDigest: plan.digest,
      }),
  );

  const historyStart = workspace.case.configuration.dates.historyStartsOn;

  const beforeHistory = historyStart
    ? new Date(Date.parse(`${historyStart}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    : null;

  const historyEnd = workspace.case.configuration.dates.historyEndsOn;

  const controls = lifecycle.controls.toSorted(
    (left, right) =>
      right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
  );

  const opening = controls.find(
    (control) => control.kind === "trial_balance" && control.asOf === beforeHistory,
  );

  const closing = controls.find(
    (control) => control.kind === "trial_balance" && control.asOf === historyEnd,
  );

  const preview = source.preview.data;

  const accounts = [
    ...new Set(
      preview?.vouchers.flatMap((voucher) => voucher.transactions.map((line) => line.account)) ??
        [],
    ),
  ];

  const mappings = accounts.flatMap((sourceAccount) => {
    const reviewed = source.mappings.data?.current.find(
      (mapping) => mapping.sourceAccount === sourceAccount,
    )?.accountId;

    const accountId =
      reviewed ??
      setup.accounts.find((account) => account.active && account.code === sourceAccount)?.id;

    return accountId ? [{ sourceAccount, accountId }] : [];
  });

  const ready = !!preview?.ready && !!opening && !!closing && mappings.length === accounts.length;

  return {
    prepare,
    start,
    ready,
    disabled: prepare.disabled || start.disabled || !ready,
    run: () => {
      if (start.uncertain && start.variables) start.mutate(start.variables);
      else if (prepare.uncertain && prepare.variables) prepare.mutate(prepare.variables);
      else if (preview && opening && closing)
        prepare.mutate({
          expectedRevision: workspace.case.revision,
          previewId: preview.id,
          expectedPreviewDigest: preview.digest,
          openingControlId: opening.id,
          closingControlId: closing.id,
          mappings,
          rationale: "Förbered historiken från filen och oberoende balansunderlag",
        });
    },
  };
}

export function ImportPrimaryAction(props: {
  previewReady: boolean;
  decisions: number | null;
  run: Workspace["imports"][number] | undefined;
  openingAccepted: boolean;
  initial: ReturnType<typeof useInitialImport>;
  open: OpenOnboardingView;
  continueImport: () => void;
}) {
  const { initial, open, run, decisions } = props;

  const label =
    decisions !== 0
      ? "Lös undantag"
      : run?.financialState === "posted"
        ? "Verifiera bokföringen"
        : props.openingAccepted && run?.financialRunId
          ? "Fortsätt importen"
          : "Granska öppningsläget";

  return (
    <SetupButton
      disabled={!props.previewReady || (decisions === 0 && !run && initial.disabled)}
      onClick={() => {
        if (decisions !== 0) open("mapping");
        else if (run?.financialState === "posted") open("verification");
        else if (run?.financialRunId && props.openingAccepted) props.continueImport();
        else if (run?.financialRunId) open("opening");
        else initial.run();
      }}
    >
      {label}
    </SetupButton>
  );
}

export function ImportPauseAction({
  run,
  open,
}: {
  run: Workspace["imports"][number] | undefined;
  open: OpenOnboardingView;
}) {
  const { book, locale } = useBookWorkspace();

  const pause = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/sie-financial-runs/${encodeURIComponent(run?.financialRunId ?? "unselected")}/lease`,
      execute: (client, requestOptions) =>
        client.historicalMigration.reclaimSieFinancialRun(
          httpRequest(
            Api.groups.historicalMigration.endpoints.reclaimSieFinancialRun,
            { params: { ...bookScope(book), id: run?.financialRunId ?? "unselected" } },
            requestOptions,
          ),
        ),
    },
    Schema.Struct({ action: Schema.Literals(["pause", "resume"]) }),
    Historical.Fence,
  );

  return (
    <>
      <SetupButton
        variant="outline"
        disabled={run?.financialState === "posted" || pause.disabled}
        onClick={() => {
          if (!run?.financialRunId) {
            open("workspace");

            return;
          }

          pause.mutate(
            pause.uncertain && pause.variables
              ? pause.variables
              : { action: run?.financialState === "paused" ? "resume" : "pause" },
          );
        }}
      >
        {run?.financialState === "paused" ? "Återuppta import" : "Pausa import"}
      </SetupButton>
      <AccountingStatus locale={locale} pending={pause.isPending} error={pause.error} write />
    </>
  );
}

export function InitialImportStatus({ initial }: { initial: ReturnType<typeof useInitialImport> }) {
  const { locale } = useBookWorkspace();

  return (
    <AccountingStatus
      locale={locale}
      pending={initial.prepare.isPending || initial.start.isPending}
      error={initial.prepare.error ?? initial.start.error}
      write
    />
  );
}

function BatchReview({ batch }: { batch: typeof O.OnboardingImportBatch.Type }) {
  const { setup } = useBookWorkspace();

  return (
    <SetupBlock layout={["controls"]}>
      {batch.proposals.map((proposal) => (
        <SetupBlock key={proposal.change.id} layout={["stack4", "rule", "section"]}>
          <SetupText layout={["semibold"]}>
            {proposal.sourceReference.replace(":", "")} /{" "}
            {formatDate(proposal.change.groups[0]?.actions[0]?.postingDate ?? null, false)}
          </SetupText>
          {proposal.change.groups.flatMap((group) =>
            group.actions.flatMap((action) =>
              action.lines.map((line) => (
                <SetupBlock key={`${action.eventId}-${line.lineId}`} layout={["row"]}>
                  <SetupText>
                    {setup.accounts.find((account) => account.id === line.accountId)?.code ??
                      "Uppgift saknas"}{" "}
                    / {line.description}
                  </SetupText>
                  <SetupText>
                    {BigInt(line.debitMinor) > 0n
                      ? `Debet ${formatMinor(line.debitMinor)}`
                      : `Kredit ${formatMinor(line.creditMinor)}`}
                  </SetupText>
                </SetupBlock>
              )),
            ),
          )}
        </SetupBlock>
      ))}
    </SetupBlock>
  );
}

export function ImportBatchesDialog({
  financialRunId,
  lifecycle,
  close,
  open,
}: {
  financialRunId: string;
  lifecycle: Lifecycle;
  close: () => void;
  open: OpenOnboardingView;
}) {
  const { book, locale } = useBookWorkspace();

  const current = useQuery({
    queryKey: [...bookKey(book), "onboarding", "import-batch", financialRunId],
    queryFn: ({ signal }) =>
      readAccounting(
        (client) =>
          client.onboarding.getOnboardingImportBatch({
            params: { ...bookScope(book) },
            query: httpQuery(
              Api.groups.onboarding.endpoints.getOnboardingImportBatch,
              `financialRunId=${financialRunId}`,
            ),
          }),
        O.OnboardingImportBatchWorkspace,
        { signal },
      ),
    retry: false,
  });

  const prepare = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/import-batches`,
      execute: (client, requestOptions) =>
        client.onboarding.prepareOnboardingImportBatch(
          httpRequest(
            Api.groups.onboarding.endpoints.prepareOnboardingImportBatch,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    O.PrepareOnboardingImportBatch,
    O.OnboardingImportBatch,
  );

  const approve = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/import-batch-approvals`,
      execute: (client, requestOptions) =>
        client.onboarding.approveOnboardingImportBatch(
          httpRequest(
            Api.groups.onboarding.endpoints.approveOnboardingImportBatch,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    O.ApproveOnboardingImportBatch,
    O.OnboardingImportBatchApproval,
  );

  const execute = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/import-batch-executions`,
      execute: (client, requestOptions) =>
        client.onboarding.executeOnboardingImportBatch(
          httpRequest(
            Api.groups.onboarding.endpoints.executeOnboardingImportBatch,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    O.ExecuteOnboardingImportBatch,
    Historical.Chunk,
  );

  const view = current.data;
  const batch = view?.batch;
  const opening = currentSnapshot(lifecycle, "opening");
  const openingAccepted = hasDecision(lifecycle, opening, "accept_opening");

  return (
    <FormDialog
      size="setup"
      title="Import av historik"
      closeLabel="Stäng"
      onClose={close}
      onEscape={close}
    >
      <SetupBlock layout={["stack12"]}>
        <PendingRead
          pending={current.isPending}
          error={current.error}
          retry={() => {
            void current.refetch();
          }}
        />
        {view ? (
          <>
            <SetupText>
              {view.run.items.length} av {view.total} verifikat är inlagda.
            </SetupText>
            {!batch && view.run.status !== "posted" && lifecycle.responsibilities ? (
              <SetupText>
                {personName(lifecycle, lifecycle.responsibilities.assignments.preparerId)}{" "}
                förbereder importen.
              </SetupText>
            ) : null}
            {batch ? (
              <>
                <SetupText>
                  Förberett av {personName(lifecycle, batch.preparedBy)},{" "}
                  {formatMoment(batch.preparedAt)}.
                </SetupText>
                <BatchReview batch={batch} />
              </>
            ) : null}
            {view.approval && view.approvalCurrent ? (
              <SetupText>
                Godkänt av {personName(lifecycle, view.approval.approvedBy)},{" "}
                {formatMoment(view.approval.approvedAt)}.
              </SetupText>
            ) : null}
            {view.run.status === "posted" ? (
              <SetupButton
                onClick={() => {
                  close();
                  open("verification");
                }}
              >
                Verifiera bokföringen
              </SetupButton>
            ) : !openingAccepted ? (
              <SetupLink
                onClick={() => {
                  close();
                  open("opening");
                }}
              >
                Granska öppningsläget
              </SetupLink>
            ) : !batch ? (
              <SetupButton
                disabled={
                  prepare.disabled ||
                  view.run.status !== "running" ||
                  lifecycle.responsibilities?.assignments.preparerId !== lifecycle.viewerActorId
                }
                onClick={() =>
                  prepare.mutate(
                    prepare.uncertain && prepare.variables
                      ? prepare.variables
                      : {
                          financialRunId,
                          expectedFence: view.run.fence,
                          expectedNextOrdinal: view.run.nextOrdinal,
                          expectedSourcePlanDigest: view.run.planDigest,
                          rationale: "Förbered nästa del av den granskade historiken",
                        },
                  )
                }
              >
                Förbered importen
              </SetupButton>
            ) : !view.approvalCurrent ? (
              <SetupButton
                variant="outline"
                disabled={
                  approve.disabled ||
                  batch.preparedBy === lifecycle.viewerActorId ||
                  lifecycle.responsibilities?.assignments.bookkeepingApproverId !==
                    lifecycle.viewerActorId ||
                  view.run.status !== "running"
                }
                onClick={() =>
                  approve.mutate(
                    approve.uncertain && approve.variables
                      ? approve.variables
                      : { batchId: batch.id, expectedDigest: batch.digest },
                  )
                }
              >
                Godkänn importen
              </SetupButton>
            ) : (
              <SetupButton
                disabled={execute.disabled || view.run.status !== "running" || !view.approval}
                onClick={() => {
                  if (view.approval)
                    execute.mutate(
                      execute.uncertain && execute.variables
                        ? execute.variables
                        : {
                            batchId: batch.id,
                            expectedDigest: batch.digest,
                            approvalId: view.approval.id,
                          },
                    );
                }}
              >
                Importera verifikaten
              </SetupButton>
            )}
          </>
        ) : null}
        <AccountingStatus
          locale={locale}
          pending={prepare.isPending || approve.isPending || execute.isPending}
          error={prepare.error ?? approve.error ?? execute.error}
          write
        />
      </SetupBlock>
    </FormDialog>
  );
}
