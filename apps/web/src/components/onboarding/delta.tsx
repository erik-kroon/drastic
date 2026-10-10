import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useState } from "react";
import { DeltaEffectsDialog } from "./delta-effects";
import { useQuery } from "@tanstack/react-query";
import * as Delta from "@open-erp/contracts/onboarding-deltas";
import { SetupBlock, SetupText, setupLayoutStyles } from "@open-erp/ui/components/setup-parts";
import { SetupButton, SetupPageContent, SetupTitle } from "@open-erp/ui/components/setup-workspace";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { Breadcrumb, type OpenOnboardingView } from "./shared";
import { formatDate, formatMoment, useOnboardingCommand } from "./data";
import {
  currentSnapshot,
  hasDecision,
  snapshotInput,
  useSnapshotCapture,
  useSnapshotDecision,
  type Lifecycle,
  type Workspace,
} from "./lifecycle";
import { useSieSource } from "./sources";
import { sourceAmount } from "./import";
import { onboardingBlocker } from "./blockers";

function DeltaChoice({
  view,
  row,
}: {
  view: typeof Delta.OnboardingDeltaView.Type;
  row: typeof Delta.OnboardingDeltaRow.Type;
}) {
  const { book } = useBookWorkspace();

  const command = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/source-delta-decisions`,
      execute: (client, requestOptions) =>
        client.onboardingDeltas.decideOnboardingDelta(
          httpRequest(
            Api.groups.onboardingDeltas.endpoints.decideOnboardingDelta,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    Delta.DecideOnboardingDelta,
    Delta.OnboardingDeltaDecision,
  );

  const saved = view.decisions
    .filter((entry) => entry.sourceReference === row.sourceReference)
    .at(-1);

  const choose = (choice: "use_change" | "keep_previous") =>
    command.mutate(
      command.uncertain && command.variables
        ? command.variables
        : {
            deltaId: view.delta.id,
            expectedDigest: view.delta.digest,
            sourceReference: row.sourceReference,
            choice,
            reason:
              choice === "use_change"
                ? "Använd ändringen vald i slutlig deltaimport"
                : "Behåll tidigare vald i slutlig deltaimport",
          },
    );

  if (row.kind === "new" && saved?.choice === "use_change")
    return <SetupText layout={["secondary"]}>Ny, importeras</SetupText>;

  return (
    <SetupBlock layout={["actions8"]}>
      <SetupButton
        variant="outline"
        layout={["deltaChoice", saved?.choice === "use_change" && "deltaChosen"]}
        disabled={
          command.disabled ||
          !view.current ||
          view.effects.some((effect) => effect.sourceReference === row.sourceReference)
        }
        aria-pressed={saved?.choice === "use_change"}
        onClick={() => choose("use_change")}
      >
        Använd ändringen
      </SetupButton>
      {row.kind !== "new" ? (
        <SetupButton
          layout={["deltaChoice", saved?.choice === "keep_previous" && "deltaChosen"]}
          variant="outline"
          disabled={
            command.disabled ||
            !view.current ||
            view.effects.some((effect) => effect.sourceReference === row.sourceReference)
          }
          aria-pressed={saved?.choice === "keep_previous"}
          onClick={() => choose("keep_previous")}
        >
          Behåll tidigare
        </SetupButton>
      ) : null}
      <AccountingStatus locale="sv" pending={command.isPending} error={command.error} write />
    </SetupBlock>
  );
}

function useDeltaReview(workspace: Workspace) {
  const { book } = useBookWorkspace();
  const source = useSieSource(workspace);

  const inventory = useQuery({
    queryKey: [...bookKey(book), "onboarding", "source-deltas"],
    queryFn: ({ signal }) =>
      readAccounting(
        (client) =>
          client.onboardingDeltas.listOnboardingDeltas({ params: { ...bookScope(book) } }),
        Delta.OnboardingDeltaInventory,
        {
          signal,
        },
      ),
    retry: false,
  });

  const latest = inventory.data?.items.find(
    (entry) => entry.candidatePreviewId === source.preview.data?.id,
  );

  const review = useQuery({
    queryKey: [...bookKey(book), "onboarding", "source-delta", latest?.id],
    enabled: !!latest,
    queryFn: ({ signal }) =>
      readAccounting(
        (client) =>
          client.onboardingDeltas.getOnboardingDelta({
            params: { ...bookScope(book), id: latest?.id ?? "" },
          }),
        Delta.OnboardingDeltaView,
        { signal },
      ),
    retry: false,
  });

  const compare = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/source-deltas`,
      execute: (client, requestOptions) =>
        client.onboardingDeltas.compareOnboardingDelta(
          httpRequest(
            Api.groups.onboardingDeltas.endpoints.compareOnboardingDelta,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    Delta.CompareOnboardingDelta,
    Delta.OnboardingDelta,
  );

  return { source, inventory, review, compare };
}

function deltaChoicesReady(view: typeof Delta.OnboardingDeltaView.Type) {
  return (
    view.current &&
    view.delta.rows
      .filter((row) => row.kind !== "unchanged")
      .every((row) =>
        view.decisions.some((decision) => decision.sourceReference === row.sourceReference),
      )
  );
}

export function OnboardingDelta({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { book, locale } = useBookWorkspace();
  const [importing, setImporting] = useState(false);
  const { source, inventory, review, compare } = useDeltaReview(workspace);
  const capture = useSnapshotCapture();
  const accept = useSnapshotDecision();
  const snapshot = currentSnapshot(lifecycle, "final_delta");
  const completed = hasDecision(lifecycle, snapshot, "accept_final_delta");
  const view = review.data;
  const changes = view?.delta.rows.filter((row) => row.kind !== "unchanged") ?? [];
  const baselineCount = view?.delta.rows.filter((row) => row.previous !== null).length ?? 0;
  const newCount = changes.filter((row) => row.kind === "new").length;
  const removedCount = changes.filter((row) => row.kind === "removed").length;
  const updatedCount = changes.filter((row) => row.kind === "changed").length;

  return (
    <SetupPageContent styleX={setupLayoutStyles(["deltaPage", "inset"])}>
      <Breadcrumb
        items={[
          { label: book.name },
          { label: "Setup", view: "workspace" },
          { label: "Slutlig deltaimport" },
        ]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>
          {completed ? "Slutlig deltaimport, klar" : "Slutlig deltaimport, granska före import"}
        </SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["openingSubtitle"]}>
        Exempeldata. Ändringar sedan förra importen. Endast bokföringsdatum till{" "}
        {formatDate(workspace.case.configuration.dates.historyEndsOn, false)}.
      </SetupText>
      {view ? (
        <SetupText as="p" layout={["deltaSummary"]}>
          {newCount} nya, {updatedCount} ändrade, {removedCount} borttagna. {baselineCount} +{" "}
          {newCount} = {baselineCount + newCount - removedCount} verifikat efter import.
        </SetupText>
      ) : null}
      {completed && snapshot ? (
        <SetupBlock layout={["banner", "section24"]}>
          <SetupText>Importen är accepterad, {formatMoment(snapshot.capturedAt)}.</SetupText>
          <SetupText>
            Bokföring till {formatDate(snapshot.asOf)}. Oktober hanteras i Drastic.
          </SetupText>
        </SetupBlock>
      ) : (
        <SetupBlock layout={["section"]}>
          <SetupTable
            title="Ändringar sedan tidigare import"
            width={tokens.setupInnerWidth}
            layout="delta"
            columns={[
              { id: "voucher", label: "Verifikat", width: tokens.setupColumn96 },
              { id: "date", label: "Datum", width: tokens.setupColumn96 },
              { id: "text", label: "Text", width: tokens.setupColumn300 },
              { id: "amount", label: "Belopp", width: tokens.setupColumn120, numeric: true },
              { id: "decision", label: "Beslut", width: tokens.setupDeltaDecisionWidth },
            ]}
            rows={[
              ...changes.filter((row) => row.kind === "new").slice(0, 2),
              ...changes.filter((row) => row.kind === "changed").toReversed(),
              ...changes.filter((row) => row.kind !== "changed").slice(2),
            ]
              .slice(0, 4)
              .map((row) => {
                const voucher = row.candidate ?? row.previous;

                return {
                  id: row.sourceReference,
                  cells: [
                    row.sourceReference.replace(":", ""),
                    formatDate(
                      voucher
                        ? `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`
                        : null,
                      false,
                    ),
                    source.preview.data?.records.find(
                      (record) => record.ordinal === voucher?.recordOrdinal,
                    )?.fields[3] ?? "",
                    sourceAmount(
                      voucher?.transactions.find((line) => line.account === "1930")?.amount ??
                        voucher?.transactions[0]?.amount ??
                        "0",
                    ),
                    view ? <DeltaChoice key={row.sourceReference} view={view} row={row} /> : null,
                  ],
                };
              })}
          />
          <SetupText as="p" layout={["note", "secondary"]}>
            Visar {Math.min(4, changes.length)} av {changes.length} ändringar. Samma källidentiteter
            och mappningar. Från{" "}
            {formatDate(workspace.case.configuration.dates.candidateLiveOn, false)} hör allt till
            Drastic.
          </SetupText>
        </SetupBlock>
      )}
      {!completed ? (
        <SetupBlock layout={["section"]}>
          {view?.blockers.includes("source_change_not_posted") ? (
            <SetupButton
              layout={["deltaPrimary"]}
              disabled={!deltaChoicesReady(view)}
              onClick={() => setImporting(true)}
            >
              Importera ändringarna
            </SetupButton>
          ) : snapshot && view ? (
            <SetupButton
              disabled={accept.disabled || snapshot.blockers.length > 0}
              onClick={() =>
                accept.mutate(
                  accept.uncertain && accept.variables
                    ? accept.variables
                    : {
                        snapshotId: snapshot.id,
                        expectedDigest: snapshot.digest,
                        decision: {
                          kind: "accept_final_delta",
                          reason: "Slutlig deltaimport kontrollerad och accepterad",
                        },
                      },
                )
              }
            >
              Acceptera deltaimporten
            </SetupButton>
          ) : view ? (
            <SetupButton
              disabled={capture.disabled || !view.current || view.blockers.length > 0}
              onClick={() =>
                capture.mutate(
                  capture.uncertain && capture.variables
                    ? capture.variables
                    : {
                        ...snapshotInput(workspace, lifecycle, "final_delta"),
                        deltaId: view.delta.id,
                      },
                )
              }
            >
              Kontrollera importerade ändringar
            </SetupButton>
          ) : (
            <SetupButton
              disabled={compare.disabled || !source.preview.data}
              onClick={() => {
                if (source.preview.data)
                  compare.mutate(
                    compare.uncertain && compare.variables
                      ? compare.variables
                      : {
                          candidatePreviewId: source.preview.data.id,
                          expectedPreviewDigest: source.preview.data.digest,
                        },
                  );
              }}
            >
              Kontrollera deltaimporten
            </SetupButton>
          )}
          {view?.blockers
            .filter((blocker) => blocker !== "source_change_not_posted")
            .map((blocker) => (
              <SetupText as="p" key={blocker} layout={["warning"]}>
                {onboardingBlocker(blocker).label}
              </SetupText>
            ))}
        </SetupBlock>
      ) : null}
      <DeltaCompletionExample completed={completed} recordClass={workspace.case.recordClass} />
      {importing && view ? (
        <DeltaEffectsDialog
          view={view}
          plan={source.plan.data}
          lifecycle={lifecycle}
          close={() => setImporting(false)}
        />
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={
          inventory.isPending ||
          review.isFetching ||
          compare.isPending ||
          capture.isPending ||
          accept.isPending
        }
        error={inventory.error ?? review.error ?? compare.error ?? capture.error ?? accept.error}
        write
      />
    </SetupPageContent>
  );
}

function DeltaCompletionExample({
  completed,
  recordClass,
}: {
  completed: boolean;
  recordClass: Workspace["case"]["recordClass"];
}) {
  if (completed || recordClass !== "synthetic") return null;

  return (
    <SetupBlock layout={["deltaExample"]}>
      <SetupText layout={["semibold", "secondary"]}>
        Exempel: klart efter import, ersätter granskningen
      </SetupText>
      <SetupText>
        Importerat 2 okt 09:40. Totalt 434 verifikat, 2 uppdaterade.
        <br />
        A412 och A398: ändringen använd, Elin Sund 2 okt 09:40.
        <br />
        September kontrollerad igen, accepterade begränsningar kvar.
        <br />
        Bokföring till 30 sep. Oktober hanteras i Drastic.
      </SetupText>
    </SetupBlock>
  );
}
