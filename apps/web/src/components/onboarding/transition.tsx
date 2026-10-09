import {
  SetupBlock,
  SetupInlineAction,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import { useQuery } from "@tanstack/react-query";
import * as Onboarding from "@open-erp/contracts/onboarding";
import * as Closing from "@open-erp/contracts/closing";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import {
  SetupActions,
  SetupButton,
  SetupCaption,
  SetupPageContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { Link } from "@open-erp/ui/components/link";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatDate, formatMinor, formatMoment, useOnboardingCommand } from "./data";
import {
  currentSnapshot,
  hasDecision,
  latestSnapshot,
  personName,
  snapshotInput,
  useSnapshotCapture,
  useSnapshotDecision,
  type Lifecycle,
  type Workspace,
} from "./lifecycle";
import { Breadcrumb, PendingRead, SetupLink, type OpenOnboardingView } from "./shared";

export function OnboardingCutover({
  workspace,
  lifecycle,
  open,
  confirmation = false,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
  confirmation?: boolean;
}) {
  const { book, locale } = useBookWorkspace();
  const snapshot = currentSnapshot(lifecycle, "activation");
  const capture = useSnapshotCapture(() => open("confirmation"));
  const opening = currentSnapshot(lifecycle, "opening");
  const bookZero = currentSnapshot(lifecycle, "book_zero");
  const delta = currentSnapshot(lifecycle, "final_delta");

  const bank = lifecycle.projection.bankStatements.toSorted((a, b) =>
    b.endsOn.localeCompare(a.endsOn),
  )[0];

  const dates = workspace.case.configuration.dates;

  const acceptedLimitations =
    !!bookZero &&
    lifecycle.decisions.some(
      (decision) =>
        decision.decision.kind === "accept_limitation" &&
        ((decision.snapshotId === bookZero.id && decision.snapshotDigest === bookZero.digest) ||
          bookZero.carriedLimitationDecisionIds.includes(decision.id)),
    );

  const gates = [
    {
      label: "Historisk import accepterad",
      passed: hasDecision(lifecycle, opening, "accept_opening"),
      view: "opening",
    },
    {
      label: `${dates.acceptanceEndsOn ? new Intl.DateTimeFormat("sv-SE", { month: "long", timeZone: "Europe/Stockholm" }).format(new Date(`${dates.acceptanceEndsOn}T12:00:00Z`)).replace(/^./, (letter) => letter.toUpperCase()) : "Perioden"} ${acceptedLimitations ? "verifierad med accepterade begränsningar" : "verifierad"}`,
      passed: hasDecision(lifecycle, bookZero, "accept_book_zero"),
      view: "verification",
    },
    {
      label: "Öppna poster uppdaterade",
      passed:
        !!delta &&
        delta.comparisons.some((item) => item.kind === "sales_open_items") &&
        delta.comparisons.some((item) => item.kind === "purchase_open_items") &&
        delta.comparisons
          .filter((item) => item.kind === "sales_open_items" || item.kind === "purchase_open_items")
          .every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n),
      view: "delta",
    },
    {
      label: `Bank importerad till ${formatDate(bank?.endsOn ?? null, false)}`,
      passed: !!bank && dates.historyEndsOn !== null && bank.endsOn >= dates.historyEndsOn,
      view: "sources",
    },
    { label: "Ansvar satt", passed: lifecycle.responsibilities !== null, view: "responsibilities" },
    {
      label: "Säkerhetskopia gjord",
      passed:
        (lifecycle.activation?.operationalProof ?? lifecycle.operationalProof)
          ?.applicationRecovery === "restricted_reads_verified",
      view: "cutover",
    },
    {
      label: "Slutlig deltaimport",
      passed: hasDecision(lifecycle, delta, "accept_final_delta"),
      view: "delta",
    },
  ] as const;

  const ready = snapshot && snapshot.blockers.length === 0 && gates.every((gate) => gate.passed);

  return (
    <>
      <SetupPageContent styleX={setupLayoutStyles(["page", "inset", "cutoverPage"])}>
        <Breadcrumb
          items={[
            { label: book.name },
            { label: "Setup", view: "workspace" },
            { label: "Övergång" },
          ]}
          open={open}
        />
        <SetupBlock layout={["title"]}>
          <SetupTitle>Övergång till Drastic</SetupTitle>
        </SetupBlock>
        <SetupBlock layout={["authority", "section24"]}>
          <SetupBlock as="section" layout={["authorityCard", "authorityIncumbent"]}>
            <SetupText as="h2" layout={["authorityTitle"]}>
              {workspace.case.configuration.incumbentSystem ?? "Tidigare bokföringsprogram"}
            </SetupText>
            <SetupText as="p" layout={["secondary"]}>
              Gällande bokföring till {formatDate(dates.historyEndsOn)}
            </SetupText>
          </SetupBlock>
          <SetupBlock as="section" layout={["authorityCard", "authorityCandidate"]}>
            <SetupText as="h2" layout={["authorityTitle"]}>
              Drastic
            </SetupText>
            <SetupText as="p" layout={["secondary"]}>
              {lifecycle.activation ? "Gällande från" : "Verifierar, gällande från"}{" "}
              {formatDate(lifecycle.activation?.authoritativeFrom ?? dates.candidateLiveOn)}
            </SetupText>
          </SetupBlock>
        </SetupBlock>
        <SetupText as="h2" layout={["section28", "authorityTitle"]}>
          Det som ska vara klart före övergången
        </SetupText>
        <SetupBlock layout={["controls", "tableSpace"]}>
          {gates.map((gate) => (
            <SetupBlock key={gate.label} layout={["gate", !gate.passed && "amberRow"]}>
              <SetupInlineAction
                type="button"
                onClick={() => open(gate.view)}
                layout={["gateTitle", "crumbButton"]}
              >
                {gate.label}
              </SetupInlineAction>
              <SetupText
                layout={[
                  gate.passed && !(gate.view === "verification" && acceptedLimitations)
                    ? "success"
                    : "warning",
                ]}
              >
                {gate.passed
                  ? gate.view === "verification" && acceptedLimitations
                    ? "! Accepterad"
                    : "✓ Klar"
                  : "! Inte gjord"}
              </SetupText>
            </SetupBlock>
          ))}
        </SetupBlock>
        <SetupBlock layout={["section24", "stack8", "cutoverActions"]}>
          <SetupButton
            disabled={confirmation || capture.disabled || (!!snapshot && !ready)}
            onClick={() => {
              if (snapshot) open("confirmation");
              else
                capture.mutate(
                  capture.uncertain && capture.variables
                    ? capture.variables
                    : snapshotInput(workspace, lifecycle, "activation"),
                );
            }}
          >
            Bekräfta övergång
          </SetupButton>
          <SetupCaption>
            {ready
              ? `Slutlig deltaimport gjord, ${lifecycle.projection.counts.importedVouchers} verifikat`
              : snapshot?.blockers.join(", ") ||
                (!gates.at(-1)?.passed
                  ? "Slutlig deltaimport saknas"
                  : "Övergången behöver kontrolleras")}
          </SetupCaption>
          <SetupText as="p" layout={["secondary", "tableSpace"]}>
            Efter övergången är tidigare system skrivskyddat.
          </SetupText>
        </SetupBlock>
        <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
      </SetupPageContent>
      {confirmation ? (
        <ActivationConfirmation workspace={workspace} lifecycle={lifecycle} open={open} />
      ) : null}
    </>
  );
}

function ActivationConfirmation({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { book, locale } = useBookWorkspace();
  const snapshot = currentSnapshot(lifecycle, "activation");
  const confirm = useSnapshotDecision();

  const intent = useOnboardingCommand(
    `${bookPath(book)}/onboarding/activation-intents`,
    Onboarding.RequestOnboardingActivation,
    Onboarding.OnboardingActivationIntent,
  );

  const policy = lifecycle.responsibilities;

  const decisions = lifecycle.decisions.filter(
    (item) =>
      item.snapshotId === snapshot?.id &&
      item.snapshotDigest === snapshot.digest &&
      item.decision.kind === "confirm_activation",
  );

  const required = policy?.assignments.activationConfirmerIds ?? [];
  const waiting = required.filter((id) => !decisions.some((decision) => decision.actorId === id));
  const ownPending = waiting.includes(lifecycle.viewerActorId);

  const proofFresh =
    !!lifecycle.operationalProof && Date.parse(lifecycle.operationalProof.expiresAt) > Date.now();

  const pendingIntent =
    lifecycle.intents.some(
      (item) => item.snapshotId === snapshot?.id && item.snapshotDigest === snapshot.digest,
    ) && !lifecycle.activation;

  const date = workspace.case.configuration.dates.candidateLiveOn;

  const month = workspace.case.configuration.dates.acceptanceEndsOn
    ? new Intl.DateTimeFormat("sv-SE", { month: "long", timeZone: "Europe/Stockholm" }).format(
        new Date(`${workspace.case.configuration.dates.acceptanceEndsOn}T12:00:00Z`),
      )
    : "kontrollperiod";

  if (!snapshot && latestSnapshot(lifecycle, "activation") && !lifecycle.activation)
    return <StaleActivationConfirmation lifecycle={lifecycle} open={open} />;

  return (
    <FormDialog
      size="setup"
      title={`Bekräfta övergång ${formatDate(date)}`}
      closeLabel="Avbryt"
      onClose={() => open("cutover")}
      onEscape={() => {
        if (!confirm.isPending && !intent.isPending && !confirm.uncertain && !intent.uncertain)
          open("cutover");
      }}
    >
      <SetupText as="h2" layout={["dialogHeading", "section"]}>
        Det här händer
      </SetupText>
      <SetupBlock layout={["dialogCopy", "tableSpace"]}>
        <SetupText as="p">Drastic blir gällande från {formatDate(date, false)}.</SetupText>
        <SetupText as="p">Tidigare system blir skrivskyddat.</SetupText>
        <SetupText as="p">
          {month.charAt(0).toUpperCase() + month.slice(1)} och accepterade begränsningar sparas i
          aktiveringskvittot.
        </SetupText>
      </SetupBlock>
      <SetupText as="h2" layout={["dialogHeading", "section20"]}>
        {required.length === 2 ? "Två personer bekräftar" : `${required.length} personer bekräftar`}
      </SetupText>
      <SetupBlock layout={["tableSpace"]}>
        {required.map((id) => {
          const decision = decisions.find((item) => item.actorId === id);

          return (
            <SetupBlock key={id} layout={["gate"]}>
              <SetupInlineAction
                type="button"
                disabled={
                  !!decision ||
                  id !== lifecycle.viewerActorId ||
                  confirm.disabled ||
                  !snapshot ||
                  snapshot.blockers.length > 0
                }
                onClick={() => {
                  if (snapshot)
                    confirm.mutate(
                      confirm.uncertain && confirm.variables
                        ? confirm.variables
                        : {
                            snapshotId: snapshot.id,
                            expectedDigest: snapshot.digest,
                            decision: {
                              kind: "confirm_activation",
                              reason: "Övergången bekräftad i setup",
                            },
                          },
                    );
                }}
                layout={["periodLabel", "crumbButton"]}
              >
                {personName(lifecycle, id)} bekräftar
              </SetupInlineAction>
              <SetupText layout={[decision ? "success" : "warning"]}>
                {decision
                  ? `✓ Bekräftad ${formatMoment(decision.recordedAt).replace(/ \d{4} /, " ")}`
                  : "! Väntar"}
              </SetupText>
            </SetupBlock>
          );
        })}
      </SetupBlock>
      <SetupBlock layout={["section20"]}>
        <SetupActions>
          <SetupButton
            disabled={
              intent.disabled ||
              !proofFresh ||
              waiting.length > 0 ||
              !required.length ||
              !snapshot ||
              snapshot.blockers.length > 0 ||
              pendingIntent
            }
            onClick={() => {
              if (snapshot)
                intent.mutate(
                  intent.uncertain && intent.variables
                    ? intent.variables
                    : { snapshotId: snapshot.id, expectedDigest: snapshot.digest },
                );
            }}
          >
            Gå live
          </SetupButton>
          <SetupButton
            variant="outline"
            disabled={
              confirm.isPending || intent.isPending || confirm.uncertain || intent.uncertain
            }
            onClick={() => open("cutover")}
          >
            Avbryt
          </SetupButton>
        </SetupActions>
      </SetupBlock>
      <SetupBlock layout={["tableSpace"]}>
        <SetupCaption>
          {pendingIntent
            ? "Övergången bearbetas"
            : waiting.length
              ? `Väntar på ${waiting.map((id) => personName(lifecycle, id)).join(" och ")}`
              : lifecycle.activation
                ? "Övergången är genomförd"
                : ""}
        </SetupCaption>
      </SetupBlock>
      {ownPending && snapshot?.blockers.length ? (
        <SetupText as="p" role="status">
          {snapshot.blockers.join(", ")}
        </SetupText>
      ) : null}
      {lifecycle.activation ? (
        <SetupLink onClick={() => open("activation")}>Visa aktiveringskvitto</SetupLink>
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={confirm.isPending || intent.isPending}
        error={confirm.error ?? intent.error}
        write
      />
    </FormDialog>
  );
}

function StaleActivationConfirmation({
  lifecycle,
  open,
}: {
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const previous = latestSnapshot(lifecycle, "activation");
  const required = lifecycle.responsibilities?.assignments.activationConfirmerIds ?? [];

  return (
    <FormDialog
      size="setup"
      title="Övergången kunde inte genomföras"
      closeLabel="Stäng"
      onClose={() => open("cutover")}
      onEscape={() => open("cutover")}
    >
      <SetupText as="p" role="alert" layout={["blocked", "note"]}>
        Underlaget har ändrats. Dina bekräftelser gäller det tidigare läget.
      </SetupText>
      <SetupText layout={["caption", "semibold", "section"]}>
        {required.length === 2 ? "TVÅ PERSONER BEKRÄFTAR" : "PERSONER SOM BEKRÄFTAR"}
      </SetupText>
      <SetupBlock layout={["tableSpace"]}>
        {required.map((id) => {
          const confirmed = lifecycle.decisions.some(
            (decision) =>
              decision.snapshotId === previous?.id &&
              decision.snapshotDigest === previous.digest &&
              decision.actorId === id &&
              decision.decision.kind === "confirm_activation",
          );

          return (
            <SetupBlock key={id} layout={["gate"]}>
              <SetupText layout={["periodLabel"]}>{personName(lifecycle, id)} bekräftar</SetupText>
              <SetupText layout={[confirmed ? "warning" : "secondary"]}>
                {confirmed ? "! Behöver bekräfta på nytt" : "Ej bekräftad"}
              </SetupText>
            </SetupBlock>
          );
        })}
      </SetupBlock>
      <SetupText as="p" layout={["caption", "note"]}>
        Ingenting har aktiverats. Tidigare system är fortfarande det gällande. Granska underlaget,
        verifiera om och bekräfta båda på nytt.
      </SetupText>
      <SetupBlock layout={["section"]}>
        <SetupActions>
          <SetupButton onClick={() => open("verification")}>Granska ändringen</SetupButton>
          <SetupButton variant="outline" onClick={() => open("cutover")}>
            Stäng
          </SetupButton>
        </SetupActions>
      </SetupBlock>
    </FormDialog>
  );
}

export function OnboardingActivation({
  lifecycle,
  open,
}: {
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const receipt = lifecycle.activation;
  const { book } = useBookWorkspace();

  const artifact = useQuery({
    queryKey: [...bookKey(book), "onboarding", "activation-artifact", receipt?.id],
    enabled: !!receipt,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/onboarding/activation-artifact`,
        Onboarding.OnboardingActivationArtifact,
        { signal },
      ),
    retry: false,
  });

  const name = receipt?.projection.companyName ?? lifecycle.projection.companyName;

  const facts =
    receipt?.projection.companyFacts.filter(
      (item) => item.review?.result === "confirmed" && item.revision.value.state === "known",
    ) ?? [];

  const factValues = new Map(
    facts.map((item) => [
      item.revision.factKind,
      item.revision.value.state === "known" ? item.revision.value.value : null,
    ]),
  );

  const ruleFacts = [
    factValues.get("jurisdiction"),
    factValues.get("legal_form") === "aktiebolag" ? "AB" : factValues.get("legal_form"),
    factValues.get("accounting_method") === "accrual"
      ? "fakturametoden"
      : factValues.get("accounting_method"),
    factValues.get("vat_period") === "quarterly" ? "kvartalsmoms" : factValues.get("vat_period"),
    factValues.get("reporting_framework"),
    factValues.get("base_currency"),
  ].filter((value) => typeof value === "string");

  const limitationOrder = [
    "missing_historical_originals",
    "historical_payroll_retained",
    "unreconciled_bank_difference",
    "missing_tax_statement",
  ];

  const accepted = (receipt?.acceptedLimitations ?? []).toSorted(
    (left, right) =>
      limitationOrder.indexOf(
        left.decision.kind === "accept_limitation" ? left.decision.limitation : "",
      ) -
      limitationOrder.indexOf(
        right.decision.kind === "accept_limitation" ? right.decision.limitation : "",
      ),
  );

  const originalControl = lifecycle.controls.find(
    (control) =>
      receipt?.snapshot.controlIds.includes(control.id) && control.kind === "historical_originals",
  );

  const missingOriginals = originalControl?.originalCoverage?.rows.filter(
    (row) => row.occurrenceId === null,
  ).length;

  const taxAccount = lifecycle.projection.accounts.find((account) => account.code === "1630");

  const taxBalance = receipt?.snapshot.comparisons.find(
    (comparison) => comparison.kind === "trial_balance" && comparison.accountId === taxAccount?.id,
  )?.actualMinor;

  const rows = receipt
    ? [
        { label: "Aktiverad", value: formatMoment(receipt.activatedAt) },
        { label: "Gällande från", value: formatDate(receipt.authoritativeFrom) },
        {
          label: "Importerat",
          value: (
            <SetupBlock layout={["stack4"]}>
              {[
                { value: receipt.projection.counts.importedVouchers, label: "verifikat" },
                { value: receipt.projection.counts.customerInvoices, label: "kundfakturor" },
                { value: receipt.projection.counts.supplierInvoices, label: "leverantörsfakturor" },
                { value: receipt.projection.counts.bankObservations, label: "bankhändelser" },
                { value: receipt.projection.counts.retainedOriginals ?? "—", label: "original" },
                ...(receipt.projection.counts.assets === null
                  ? []
                  : [{ value: receipt.projection.counts.assets, label: "anläggningstillgångar" }]),
              ].map((item) => (
                <SetupText as="p" key={item.label}>
                  {item.value} {item.label}
                </SetupText>
              ))}
              <SetupText as="p" layout={["receiptDetail"]}>
                Kontomappning och historiska källor bevarade med övergången.
              </SetupText>
            </SetupBlock>
          ),
        },
        {
          label: "Kontrollperiod",
          value: `${new Intl.DateTimeFormat("sv-SE", { month: "long", year: "numeric" }).format(new Date(`${receipt.snapshot.asOf}T12:00:00Z`)).replace(/^./, (letter) => letter.toUpperCase())}, verifierad med ${accepted.length} accepterade begränsningar`,
        },
        {
          label: "Kända begränsningar",
          value: (
            <SetupBlock layout={["stack4"]}>
              {accepted.map((item) => (
                <SetupText
                  as="p"
                  key={item.id}
                  layout={[
                    item.decision.kind === "accept_limitation" &&
                      (item.decision.limitation === "unreconciled_bank_difference" ||
                        item.decision.limitation === "missing_tax_statement") &&
                      "receiptDetail",
                  ]}
                >
                  {item.decision.kind === "accept_limitation"
                    ? {
                        missing_historical_originals: `${missingOriginals ?? "Historiska"} historiska verifikat saknar original.`,
                        historical_payroll_retained: `Löner före ${formatDate(receipt.authoritativeFrom, false)} kvar i tidigare system.`,
                        unreconciled_bank_difference: `Bank per ${formatDate(receipt.snapshot.asOf, false)}: ${formatMinor((-BigInt(receipt.snapshot.comparisons.find((comparison) => comparison.kind === "bank")?.differenceMinor ?? "0")).toString())}, förklarad men inte avstämd.`,
                        missing_tax_statement: `Skattekonto: kontoutdrag saknas, ${taxBalance ? formatMinor(taxBalance) : "saldo"} ej kontrollerat.`,
                      }[item.decision.limitation]
                    : ""}{" "}
                  {item.actorName}
                  {", "}
                  {formatMoment(item.recordedAt)}
                </SetupText>
              ))}
            </SetupBlock>
          ),
        },
        {
          label: "Regler",
          value: `${ruleFacts.join(", ")}${receipt.projection.ruleReleases.length ? `, regelversion ${receipt.projection.ruleReleases.map((release) => release.version).join(", ")}` : ""}`,
        },
        {
          label: "Godkänt av",
          value: [...new Set(receipt.confirmations.map((item) => item.actorName))].join(" och "),
        },
      ]
    : [];

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page", "inset", "receiptPage"])}>
      <Breadcrumb
        items={[{ label: name }, { label: "Setup", view: "workspace" }, { label: "Aktivering" }]}
        open={open}
      />
      <SetupBlock layout={["headingRow", "title"]}>
        <SetupTitle>Aktivering av {name}</SetupTitle>
        <SetupButton
          variant="outline"
          disabled={!artifact.data}
          onClick={() => {
            if (!artifact.data) return;

            const bytes = Uint8Array.from(atob(artifact.data.contentBase64), (character) =>
              character.charCodeAt(0),
            );

            const uri = URL.createObjectURL(new Blob([bytes], { type: artifact.data.mediaType }));

            const anchor = document.createElement("a");
            anchor.href = uri;
            anchor.download = artifact.data.filename;
            anchor.click();
            URL.revokeObjectURL(uri);
          }}
        >
          Ladda ner aktiveringskvitto (PDF)
        </SetupButton>
      </SetupBlock>
      <SetupText as="p" layout={["subtitle", "mappingSubtitle"]}>
        Exempeldata. Sparad övergång: tidigare system till{" "}
        {receipt ? formatDate(receipt.snapshot.asOf, false) : "—"}, Drastic från{" "}
        {receipt ? formatDate(receipt.authoritativeFrom, false) : "—"}.
      </SetupText>
      <SetupBlock layout={["facts", "section20"]}>
        {rows.map((row) => (
          <SetupBlock key={row.label} layout={["factRow", "receiptRow"]}>
            <SetupText layout={["factLabel"]}>{row.label}</SetupText>
            <SetupBlock
              layout={[row.label === "Kontrollperiod" && accepted.length > 0 && "warning"]}
            >
              {row.value}
            </SetupBlock>
          </SetupBlock>
        ))}
      </SetupBlock>
      {!receipt ? (
        <SetupText as="p" role="status">
          Övergången är inte genomförd. Aktiveringskvitto saknas.
        </SetupText>
      ) : null}
    </SetupPageContent>
  );
}

function useFirstPeriodClosing(
  period: ReturnType<typeof useBookWorkspace>["setup"]["periods"][number] | undefined,
) {
  const { book } = useBookWorkspace();

  const readiness = useQuery({
    queryKey: [...bookKey(book), "closing-readiness", period?.id],
    enabled: !!period,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/periods/${encodeURIComponent(period?.id ?? "")}/closing-readiness`,
        Closing.ClosingReadiness,
        { signal },
      ),
    retry: false,
  });

  const history = useQuery({
    queryKey: [...bookKey(book), "closing-history", period?.id],
    enabled: !!period && period.locked,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/periods/${encodeURIComponent(period?.id ?? "")}/closing-history`,
        Closing.ClosingHistory,
        { signal },
      ),
    retry: false,
  });

  return { readiness, history };
}

function firstPeriodRows(lifecycle: Lifecycle, month: string, locked: boolean) {
  const progress = lifecycle.firstPeriodProgress;

  const historicalBankLimitation = lifecycle.activation?.acceptedLimitations.some(
    (decision) =>
      decision.decision.kind === "accept_limitation" &&
      decision.decision.limitation === "unreconciled_bank_difference",
  );

  const documentsReady = progress?.originalCoverage === true;

  return [
    {
      label: "Bank",
      text: progress?.bankThrough
        ? `Aktuell till ${formatDate(progress.bankThrough, false)}${historicalBankLimitation ? ", historisk bankbegränsning i kvittot" : ""}`
        : "! Underlag saknas",
      ready: false,
      warning: false,
    },
    {
      label: "Dokument",
      text: documentsReady
        ? `✓ ${(month.split(" ")[0] ?? "Perioden").replace(/^./, (letter) => letter.toUpperCase())}: inga luckor, historiska undantag i kvittot`
        : progress?.originalCoverage === false
          ? "! Original saknas"
          : "○ Inte verifierade",
      ready: documentsReady,
      warning: false,
    },
    {
      label: "Bokföring",
      text: progress?.pendingProposals
        ? `! ${progress.pendingProposals} förslag väntar`
        : "○ Väntar på kontroll",
      ready: false,
      warning: (progress?.pendingProposals ?? 0) > 0,
    },
    {
      label: "Kundfakturor",
      text: progress?.salesMatches === true ? "✓ Reskontra stämmer" : "○ Väntar på kontroll",
      ready: progress?.salesMatches === true,
      warning: false,
    },
    {
      label: "Leverantörsfakturor",
      text: progress?.purchaseMatches === true ? "✓ Reskontra stämmer" : "○ Väntar på kontroll",
      ready: progress?.purchaseMatches === true,
      warning: false,
    },
    {
      label: "Period",
      text: `${month.charAt(0).toUpperCase()}${month.slice(1)}, ${locked ? "stängd" : "ej stängd"}`,
      ready: false,
      warning: false,
    },
  ];
}

export function OnboardingFirstPeriod({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const date = workspace.case.configuration.dates.candidateLiveOn;

  const period = setup.periods.find(
    (item) => date !== null && item.startsOn <= date && item.endsOn >= date,
  );

  const { readiness, history } = useFirstPeriodClosing(period);

  const certificate = history.data?.items.find((item) => item.certificateId)?.certificateId;
  const snapshot = currentSnapshot(lifecycle, "first_live");
  const capture = useSnapshotCapture();

  const complete = useOnboardingCommand(
    `${bookPath(book)}/onboarding/first-period-completions`,
    Onboarding.CompleteOnboardingFirstPeriod,
    Onboarding.OnboardingFirstPeriodCompletion,
  );

  const month = date
    ? new Intl.DateTimeFormat("sv-SE", {
        month: "long",
        year: "numeric",
        timeZone: "Europe/Stockholm",
      }).format(new Date(`${date}T12:00:00Z`))
    : "ej angiven";

  const rows = firstPeriodRows(lifecycle, month, period?.locked ?? false);

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page", "inset", "firstPeriodPage"])}>
      <Breadcrumb
        items={[
          { label: book.name },
          { label: "Setup", view: "workspace" },
          { label: "Första perioden" },
        ]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>Första perioden, {month}</SetupTitle>
      </SetupBlock>
      <SetupBlock layout={["banner", "firstPeriodBanner", "section"]}>
        <SetupText as="h2" layout={["firstPeriodTitle"]}>
          Setup
        </SetupText>
        <SetupText as="p" layout={["secondary"]}>
          {lifecycle.completion?.current
            ? "Setup är klar."
            : `Setup är klar när ${month.split(" ")[0]} är stängd och stämmer.`}
        </SetupText>
      </SetupBlock>
      <SetupBlock layout={["controls", "section20"]}>
        {rows.map((row) => (
          <SetupBlock key={row.label} layout={["periodRow", row.warning && "firstPeriodWarning"]}>
            <SetupText layout={["periodLabel", row.warning && "firstPeriodWarningLabel"]}>
              {row.label}
            </SetupText>
            <SetupText layout={[row.warning ? "warning" : row.ready ? "success" : "secondary"]}>
              {row.text}
            </SetupText>
          </SetupBlock>
        ))}
      </SetupBlock>
      <SetupBlock layout={["section20"]}>
        <SetupButton nativeButton={false} render={<Link href={`${workspacePath(book)}/work`} />}>
          Öppna Att göra
        </SetupButton>
      </SetupBlock>
      <PendingRead
        pending={!!period && readiness.isPending}
        error={readiness.error ?? history.error}
        retry={() => {
          void readiness.refetch();
          void history.refetch();
        }}
      />
      {certificate && !snapshot ? (
        <SetupButton
          disabled={capture.disabled || !lifecycle.activation}
          onClick={() =>
            capture.mutate(
              capture.uncertain && capture.variables
                ? capture.variables
                : {
                    ...snapshotInput(workspace, lifecycle, "first_live"),
                    closingCertificateId: certificate,
                  },
            )
          }
        >
          Kontrollera första perioden
        </SetupButton>
      ) : null}
      {certificate && snapshot && !lifecycle.completion?.current ? (
        <SetupButton
          disabled={complete.disabled || snapshot.blockers.length > 0 || !lifecycle.activation}
          onClick={() =>
            complete.mutate(
              complete.uncertain && complete.variables
                ? complete.variables
                : { snapshotId: snapshot.id, expectedDigest: snapshot.digest },
            )
          }
        >
          Slutför Setup
        </SetupButton>
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={capture.isPending || complete.isPending}
        error={capture.error ?? complete.error}
        write
      />
    </SetupPageContent>
  );
}
