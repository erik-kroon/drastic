import { useQuery } from "@tanstack/react-query";
import * as stylex from "@stylexjs/stylex";
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
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { Link } from "@open-erp/ui/components/link";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { formatDate, formatMoment, useOnboardingCommand } from "./data";
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
import { styles } from "./styles";

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
  const gates = [
    {
      label: "Historisk import accepterad",
      passed: hasDecision(lifecycle, opening, "accept_opening"),
      view: "opening",
    },
    {
      label: `${dates.acceptanceEndsOn ? new Intl.DateTimeFormat("sv-SE", { month: "long", timeZone: "Europe/Stockholm" }).format(new Date(`${dates.acceptanceEndsOn}T12:00:00Z`)) : "Perioden"} verifierad`,
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
        lifecycle.activation?.operationalProof.applicationRecovery === "restricted_reads_verified",
      view: "cutover",
    },
    {
      label: "Slutlig deltaimport",
      passed: hasDecision(lifecycle, delta, "accept_final_delta"),
      view: "delta",
    },
  ] as const;
  const ready = snapshot && snapshot.blockers.length === 0;
  return (
    <>
      <SetupPageContent styleX={[styles.page, styles.inset]}>
        <Breadcrumb
          items={[
            { label: book.name },
            { label: "Setup", view: "workspace" },
            { label: "Övergång" },
          ]}
          open={open}
        />
        <div {...stylex.props(styles.title)}>
          <SetupTitle>Övergång till OpenERP</SetupTitle>
        </div>
        <div {...stylex.props(styles.authority, styles.section24)}>
          <section {...stylex.props(styles.authorityCard)}>
            <h2 {...stylex.props(styles.medium)}>
              {workspace.case.configuration.incumbentSystem ?? "Tidigare bokföringsprogram"}
            </h2>
            <p {...stylex.props(styles.secondary)}>
              Gällande bokföring till {formatDate(dates.historyEndsOn)}
            </p>
          </section>
          <section {...stylex.props(styles.authorityCard)}>
            <h2 {...stylex.props(styles.medium)}>OpenERP</h2>
            <p {...stylex.props(styles.secondary)}>
              {lifecycle.activation ? "Gällande från" : "Verifierar, gällande från"}{" "}
              {formatDate(lifecycle.activation?.authoritativeFrom ?? dates.candidateLiveOn)}
            </p>
          </section>
        </div>
        <h2 {...stylex.props(styles.section24, styles.semibold)}>
          Det som ska vara klart före övergången
        </h2>
        <div {...stylex.props(styles.controls, styles.tableSpace)}>
          {gates.map((gate) => (
            <div key={gate.label} {...stylex.props(styles.gate, !gate.passed && styles.amberRow)}>
              <button
                type="button"
                onClick={() => open(gate.view)}
                {...stylex.props(styles.gateTitle, styles.crumbButton)}
              >
                {gate.label}
              </button>
              <span {...stylex.props(gate.passed ? styles.success : styles.warning)}>
                {gate.passed ? "✓ Klar" : "! Inte gjord"}
              </span>
            </div>
          ))}
        </div>
        <div {...stylex.props(styles.section24, styles.stack8)}>
          <SetupButton
            disabled={capture.disabled || (!!snapshot && !ready)}
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
          {!ready ? (
            <SetupCaption>
              {snapshot?.blockers.join(", ") ||
                (!gates.at(-1)?.passed
                  ? "Slutlig deltaimport saknas"
                  : "Övergången behöver kontrolleras")}
            </SetupCaption>
          ) : null}
          <p {...stylex.props(styles.secondary, styles.tableSpace)}>
            Efter övergången är tidigare system skrivskyddat.
          </p>
        </div>
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
      <h2 {...stylex.props(styles.dialogHeading, styles.section)}>Det här händer</h2>
      <div {...stylex.props(styles.dialogCopy, styles.tableSpace)}>
        <p>OpenERP blir gällande från {formatDate(date, false)}.</p>
        <p>Tidigare system blir skrivskyddat.</p>
        <p>Verifierad {month} sparas som kvitto: Aktiveringskvitto.</p>
      </div>
      <h2 {...stylex.props(styles.dialogHeading, styles.section20)}>
        {required.length === 2 ? "Två personer bekräftar" : `${required.length} personer bekräftar`}
      </h2>
      <div {...stylex.props(styles.tableSpace)}>
        {required.map((id) => {
          const decision = decisions.find((item) => item.actorId === id);
          return (
            <div key={id} {...stylex.props(styles.gate)}>
              <button
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
                {...stylex.props(styles.periodLabel, styles.crumbButton)}
              >
                {personName(lifecycle, id)} bekräftar
              </button>
              <span {...stylex.props(decision ? styles.success : styles.warning)}>
                {decision
                  ? `✓ Bekräftad ${formatMoment(decision.recordedAt).replace(/ \d{4} /, " ")}`
                  : "! Väntar"}
              </span>
            </div>
          );
        })}
      </div>
      <div {...stylex.props(styles.section20)}>
        <SetupActions>
          <SetupButton
            disabled={
              intent.disabled ||
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
      </div>
      <div {...stylex.props(styles.tableSpace)}>
        <SetupCaption>
          {pendingIntent
            ? "Övergången bearbetas"
            : waiting.length
              ? `Väntar på ${waiting.map((id) => personName(lifecycle, id)).join(" och ")}`
              : lifecycle.activation
                ? "Övergången är genomförd"
                : ""}
        </SetupCaption>
      </div>
      {ownPending && snapshot?.blockers.length ? (
        <p role="status">{snapshot.blockers.join(", ")}</p>
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
  const snapshot = currentSnapshot(lifecycle, "final_delta");
  const retained = snapshot ?? latestSnapshot(lifecycle, "final_delta");
  const capture = useSnapshotCapture();
  const decision = useSnapshotDecision();
  const accepted = hasDecision(lifecycle, snapshot, "accept_final_delta");
  return (
    <SetupPageContent styleX={[styles.page, styles.inset]}>
      <Breadcrumb
        items={[
          { label: book.name },
          { label: "Setup", view: "workspace" },
          { label: "Slutlig deltaimport" },
        ]}
        open={open}
      />
      <div {...stylex.props(styles.title)}>
        <SetupTitle>Slutlig deltaimport</SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Det som ändrats i tidigare system sedan förra importen.
      </p>
      <div {...stylex.props(styles.section24)}>
        <SetupTable
          title="Ändringar sedan tidigare import"
          width={tokens.setupInnerWidth}
          columns={[
            { id: "voucher", label: "Verifikat", width: tokens.setupColumn96 },
            { id: "date", label: "Datum", width: tokens.setupColumn96 },
            { id: "text", label: "Text", width: tokens.setupColumn300 },
            { id: "amount", label: "Belopp", width: tokens.setupColumn120, numeric: true },
            { id: "decision", label: "Beslut", width: tokens.setupDeltaDecisionWidth },
          ]}
          rows={[]}
        />
      </div>
      <p {...stylex.props(styles.note, styles.secondary)}>
        Samma källor och mappningar används, så inget dubbleras.
      </p>
      <div {...stylex.props(styles.section20)}>
        {snapshot ? (
          <SetupButton
            disabled={decision.disabled || snapshot.blockers.length > 0 || accepted}
            onClick={() =>
              decision.mutate(
                decision.uncertain && decision.variables
                  ? decision.variables
                  : {
                      snapshotId: snapshot.id,
                      expectedDigest: snapshot.digest,
                      decision: {
                        kind: "accept_final_delta",
                        reason: "Slutlig deltaimport kontrollerad i setup",
                      },
                    },
              )
            }
          >
            Acceptera deltaimporten
          </SetupButton>
        ) : (
          <SetupButton
            disabled={capture.disabled}
            onClick={() =>
              capture.mutate(
                capture.uncertain && capture.variables
                  ? capture.variables
                  : snapshotInput(workspace, lifecycle, "final_delta"),
              )
            }
          >
            Kontrollera deltaimporten
          </SetupButton>
        )}
      </div>
      {retained ? (
        <div {...stylex.props(styles.section20, styles.stack4)}>
          <p {...stylex.props(accepted ? styles.success : styles.warning)}>
            {accepted ? "✓ Accepterad" : "! Behöver beslut"} {formatMoment(retained.capturedAt)}
          </p>
          <p {...stylex.props(styles.secondary)}>{retained.blockers.join(", ")}</p>
        </div>
      ) : null}
      <p role="status">Ändrade och borttagna källposter behöver granskas i importen.</p>
      <Link href={`${workspacePath(book)}/history`}>Öppna historisk import</Link>
      <AccountingStatus
        locale={locale}
        pending={capture.isPending || decision.isPending}
        error={capture.error ?? decision.error}
        write
      />
    </SetupPageContent>
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
  const name = receipt?.projection.companyName ?? lifecycle.projection.companyName;
  const facts =
    receipt?.projection.companyFacts.filter(
      (item) => item.review?.result === "confirmed" && item.revision.value.state === "known",
    ) ?? [];
  const ruleFacts = facts
    .map((item) => {
      const value = item.revision.value;
      if (value.state !== "known") return "";
      return typeof value.value === "object" ? "" : String(value.value);
    })
    .filter(Boolean);
  const accepted = receipt
    ? lifecycle.decisions.filter(
        (item) =>
          item.snapshotId === receipt.snapshot.id &&
          item.snapshotDigest === receipt.snapshot.digest &&
          item.decision.kind === "accept_limitation",
      )
    : [];
  const rows = receipt
    ? [
        { label: "Aktiverad", value: formatMoment(receipt.activatedAt) },
        { label: "Gällande från", value: formatDate(receipt.authoritativeFrom) },
        {
          label: "Importerat",
          value: (
            <div {...stylex.props(styles.stack4)}>
              {[
                { value: receipt.projection.counts.importedVouchers, label: "verifikat" },
                { value: receipt.projection.counts.customerInvoices, label: "kundfakturor" },
                { value: receipt.projection.counts.supplierInvoices, label: "leverantörsfakturor" },
                { value: receipt.projection.counts.bankObservations, label: "bankhändelser" },
                { value: receipt.projection.counts.retainedOriginals, label: "original" },
                ...(receipt.projection.counts.assets === null
                  ? []
                  : [{ value: receipt.projection.counts.assets, label: "anläggningstillgångar" }]),
              ].map((item) => (
                <p key={item.label}>
                  {item.value} {item.label}
                </p>
              ))}
            </div>
          ),
        },
        { label: "Kontrollperiod", value: `✓ ${formatDate(receipt.snapshot.asOf)}, verifierad` },
        {
          label: "Kända begränsningar",
          value: (
            <div {...stylex.props(styles.stack4)}>
              {accepted.map((item) => (
                <p key={item.id}>
                  {item.decision.kind === "accept_limitation" ? item.decision.reason : ""}
                </p>
              ))}
              <p>Exempeldata. Ingen myndighetsinlämning har genomförts.</p>
            </div>
          ),
        },
        {
          label: "Regler",
          value: `${ruleFacts.join(", ")}${receipt.projection.ruleReleases.length ? `, regelversion ${receipt.projection.ruleReleases.map((release) => release.version).join(", ")}` : ""}`,
        },
        {
          label: "Godkänt av",
          value: [
            ...new Set(receipt.confirmations.map((item) => personName(lifecycle, item.actorId))),
          ].join(" och "),
        },
      ]
    : [];
  return (
    <SetupPageContent styleX={[styles.page, styles.inset]}>
      <Breadcrumb
        items={[{ label: name }, { label: "Setup", view: "workspace" }, { label: "Aktivering" }]}
        open={open}
      />
      <div {...stylex.props(styles.headingRow, styles.title)}>
        <SetupTitle>Aktivering av {name}</SetupTitle>
        <SetupButton
          variant="outline"
          disabled={!receipt}
          onClick={() => {
            if (!receipt) return;
            const uri = URL.createObjectURL(
              new Blob([JSON.stringify(receipt, null, 2)], { type: "application/json" }),
            );
            const anchor = document.createElement("a");
            anchor.href = uri;
            anchor.download = "aktiveringskvitto.json";
            anchor.click();
            URL.revokeObjectURL(uri);
          }}
        >
          Ladda ner
        </SetupButton>
      </div>
      <p {...stylex.props(styles.subtitle)}>Sparad uppgift om övergången. Den ändras inte.</p>
      <div {...stylex.props(styles.facts, styles.section24)}>
        {rows.map((row) => (
          <div key={row.label} {...stylex.props(styles.factRow)}>
            <span {...stylex.props(styles.factLabel)}>{row.label}</span>
            <div>{row.value}</div>
          </div>
        ))}
      </div>
      {!receipt ? (
        <p role="status">Övergången är inte genomförd. Aktiveringskvitto saknas.</p>
      ) : null}
    </SetupPageContent>
  );
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
  const bank = lifecycle.projection.bankStatements.toSorted((a, b) =>
    b.endsOn.localeCompare(a.endsOn),
  )[0];
  const bankReady = !!bank && !!date && bank.endsOn >= date;
  const rows = [
    {
      label: "Bank",
      text: bank
        ? `${bankReady ? "✓ Aktuell" : "! Underlag saknas"} till ${formatDate(bank.endsOn, false)}`
        : "! Underlag saknas",
      ready: bankReady,
    },
    { label: "Dokument", text: "○ Inte verifierade", ready: false },
    {
      label: "Bokföring",
      text:
        readiness.data?.checks
          .filter((item) => !item.passed)
          .map((item) => item.detail)
          .join(", ") || "○ Väntar på kontroll",
      ready: readiness.data?.technicalCloseAllowed ?? false,
    },
    {
      label: "Kundfakturor",
      text:
        snapshot?.comparisons.some((item) => item.kind === "sales_open_items") &&
        snapshot.comparisons
          .filter((item) => item.kind === "sales_open_items")
          .every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n)
          ? "✓ Reskontra stämmer"
          : "○ Väntar på kontroll",
      ready:
        snapshot?.comparisons.some((item) => item.kind === "sales_open_items") &&
        snapshot.comparisons
          .filter((item) => item.kind === "sales_open_items")
          .every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n),
    },
    {
      label: "Leverantörsfakturor",
      text:
        snapshot?.comparisons.some((item) => item.kind === "purchase_open_items") &&
        snapshot.comparisons
          .filter((item) => item.kind === "purchase_open_items")
          .every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n)
          ? "✓ Reskontra stämmer"
          : "○ Väntar på kontroll",
      ready:
        snapshot?.comparisons.some((item) => item.kind === "purchase_open_items") &&
        snapshot.comparisons
          .filter((item) => item.kind === "purchase_open_items")
          .every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n),
    },
    {
      label: "Period",
      text: `${month.charAt(0).toUpperCase()}${month.slice(1)}, ${period?.locked ? "stängd" : "ej stängd"}`,
      ready: false,
    },
  ];
  return (
    <SetupPageContent styleX={[styles.page, styles.inset]}>
      <Breadcrumb
        items={[
          { label: book.name },
          { label: "Setup", view: "workspace" },
          { label: "Första perioden" },
        ]}
        open={open}
      />
      <div {...stylex.props(styles.title)}>
        <SetupTitle>Första perioden, {month}</SetupTitle>
      </div>
      <div {...stylex.props(styles.banner, styles.section24)}>
        <h2 {...stylex.props(styles.medium)}>Setup</h2>
        <p {...stylex.props(styles.secondary)}>
          {lifecycle.completion?.current
            ? "Setup är klar."
            : `Setup är klar när ${month.split(" ")[0]} är stängd och stämmer.`}
        </p>
      </div>
      <div {...stylex.props(styles.controls, styles.section24)}>
        {rows.map((row) => (
          <div key={row.label} {...stylex.props(styles.periodRow)}>
            <span {...stylex.props(styles.periodLabel)}>{row.label}</span>
            <span {...stylex.props(row.ready ? styles.success : styles.secondary)}>{row.text}</span>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.section24)}>
        <Link href={`${workspacePath(book)}/work`}>Öppna Att göra</Link>
      </div>
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
      {snapshot && !lifecycle.completion?.current ? (
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
