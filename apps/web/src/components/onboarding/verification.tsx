import {
  SetupBlock,
  SetupInlineAction,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import { useState } from "react";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { InputField } from "@open-erp/ui/components/field";
import {
  SetupActions,
  SetupButton,
  SetupCaption,
  SetupPageContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { formatDate, formatMinor, formatMoment } from "./data";
import {
  currentSnapshot,
  hasDecision,
  latestSnapshot,
  snapshotInput,
  useSnapshotCapture,
  useSnapshotDecision,
  type Lifecycle,
  type Snapshot,
  type Workspace,
} from "./lifecycle";
import { Breadcrumb, type OpenOnboardingView } from "./shared";
import { useSieSource } from "./sources";

function openingInvoiceDetails(
  plan: ReturnType<typeof useSieSource>["plan"]["data"],
  accountId: string | undefined,
  snapshot: Snapshot | undefined,
) {
  const sourceAccounts =
    plan?.input.mappings
      .filter((mapping) => mapping.accountId === accountId)
      .map((mapping) => mapping.sourceAccount) ?? [];

  const sourceItems =
    plan?.input.openItems.filter((item) => sourceAccounts.includes(item.sourceAccount)) ?? [];

  const known =
    !!snapshot &&
    !!plan &&
    snapshot.sourceImportPlanIds?.includes(plan.id) === true &&
    sourceAccounts.length > 0 &&
    sourceItems.every((item) => item.asOf === snapshot.asOf) &&
    sourceAccounts.every((sourceAccount) =>
      plan.input.openItemControls.some((control) => control.sourceAccount === sourceAccount),
    );

  return { known, items: sourceItems.filter((item) => item.asOf === snapshot?.asOf) };
}

function openingSourceText(
  details: ReturnType<typeof openingInvoiceDetails>,
  code: string | undefined,
  provenance: string | undefined,
) {
  if (details.known) return `${details.items.length} öppna fakturor`;

  if (code === "1630") return "Slutsaldo, utdrag saknas";

  return provenance ?? "Källa saknas";
}

export function OnboardingOpening({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { setup, locale } = useBookWorkspace();
  const snapshot = currentSnapshot(lifecycle, "opening");
  const retained = snapshot ?? latestSnapshot(lifecycle, "opening");
  const capture = useSnapshotCapture();
  const sie = useSieSource(workspace);
  const balances = retained?.comparisons.filter((item) => item.kind === "trial_balance") ?? [];
  const [selection, setSelection] = useState<string | null>(null);

  const receivable = lifecycle.controls.find((control) => control.kind === "sales_open_items")
    ?.facts[0]?.accountId;

  const selected = selection ?? receivable ?? balances[0]?.accountId;
  const account = setup.accounts.find((item) => item.id === selected);

  const invoiceDetails = openingInvoiceDetails(sie.plan.data, selected, retained);

  const debit = balances.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) > 0n ? BigInt(item.expectedMinor) : 0n),
    0n,
  );

  const credit = balances.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) < 0n ? -BigInt(item.expectedMinor) : 0n),
    0n,
  );

  const difference = debit - credit;

  const namedGroups = [
    { code: "1930", label: "BANK" },
    { code: "1510", label: "KUNDFORDRINGAR" },
    { code: "2440", label: "LEVERANTÖRSSKULDER" },
    { code: "2650", label: "MOMS" },
    { code: "1630", label: "SKATTEKONTO" },
  ];

  const otherBalances = balances.filter(
    (item) =>
      !namedGroups.some(
        (group) =>
          setup.accounts.find((candidate) => candidate.id === item.accountId)?.code === group.code,
      ),
  );

  const shownBalances = namedGroups.flatMap((group) => {
    const item = balances.find(
      (balance) =>
        setup.accounts.find((candidate) => candidate.id === balance.accountId)?.code === group.code,
    );

    return item ? [{ ...item, group: group.label }] : [];
  });

  return (
    <SetupPageContent styleX={setupLayoutStyles(["openingPage"])}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Ingående balanser" }]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>
          Ingående balanser per{" "}
          {formatDate(retained?.asOf ?? workspace.case.configuration.dates.openingOn)}
        </SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["openingSubtitle"]}>
        Slutsaldon i tidigare bokföring vid kontrollpunkten.
        {workspace.case.recordClass === "synthetic" ? " Exempeldata." : ""}
        {retained?.sourceImportPlanIds?.length &&
        !hasDecision(lifecycle, snapshot, "accept_opening") &&
        lifecycle.projection.counts.importedVouchers === 0
          ? " Inget är bokfört än."
          : ""}
      </SetupText>
      <SetupBlock layout={["openingColumns", "section24"]}>
        <SetupBlock layout={["stack"]}>
          <SetupTable
            title="Ingående balanser"
            width={tokens.setupOpeningWidth}
            density="compact"
            layout="opening"
            columns={[
              { id: "account", label: "Konto", width: tokens.setupColumn60 },
              { id: "name", label: "Namn", width: tokens.setupColumn150 },
              { id: "debit", label: "Debet", width: tokens.setupColumn100, numeric: true },
              { id: "credit", label: "Kredit", width: tokens.setupColumn100, numeric: true },
              { id: "source", label: "Källa", width: tokens.setupOpeningSourceWidth },
            ]}
            rows={[
              ...shownBalances.flatMap((item) => {
                const name = setup.accounts.find((candidate) => candidate.id === item.accountId);
                const source = lifecycle.controls.find((control) => control.id === item.controlId);

                const details = openingInvoiceDetails(sie.plan.data, item.accountId, retained);

                return [
                  { id: `group-${item.accountId}`, group: item.group, cells: [] },
                  {
                    id: `${item.controlId}-${item.accountId}`,
                    tone: selected === item.accountId ? ("selected" as const) : undefined,
                    cells: [
                      <SetupInlineAction
                        type="button"
                        key="select"
                        layout={["crumbButton"]}
                        onClick={() => setSelection(item.accountId)}
                      >
                        {name?.code ?? "Okänt konto"}
                      </SetupInlineAction>,
                      name?.name ?? "Uppgift saknas",
                      BigInt(item.expectedMinor) > 0n ? formatMinor(item.expectedMinor) : "",
                      BigInt(item.expectedMinor) < 0n
                        ? formatMinor((-BigInt(item.expectedMinor)).toString())
                        : "",
                      openingSourceText(details, name?.code, source?.provenance),
                    ],
                  },
                ];
              }),
              ...(otherBalances.length
                ? [
                    { id: "other-group", group: "ÖVRIGA KONTON", cells: [] },
                    {
                      id: "other",
                      cells: [
                        "",
                        "Övriga konton",
                        formatMinor(
                          otherBalances
                            .reduce(
                              (sum, item) =>
                                sum +
                                (BigInt(item.expectedMinor) > 0n ? BigInt(item.expectedMinor) : 0n),
                              0n,
                            )
                            .toString(),
                        ),
                        formatMinor(
                          otherBalances
                            .reduce(
                              (sum, item) =>
                                sum +
                                (BigInt(item.expectedMinor) < 0n
                                  ? -BigInt(item.expectedMinor)
                                  : 0n),
                              0n,
                            )
                            .toString(),
                        ),
                        "Tillgångar, eget kapital, resultat",
                      ],
                    },
                  ]
                : []),
              {
                id: "sum",
                cells: [
                  "",
                  "Summa",
                  retained ? formatMinor(debit.toString()) : "—",
                  retained ? formatMinor(credit.toString()) : "—",
                  "",
                ],
              },
              {
                id: "difference",
                cells: [
                  "",
                  "Differens",
                  retained ? formatMinor(difference.toString()) : "—",
                  "",
                  retained ? (
                    <SetupText key="balance" layout={[difference === 0n ? "success" : "warning"]}>
                      {difference === 0n ? "✓ I balans" : "! Differens"}
                    </SetupText>
                  ) : (
                    "Ej kontrollerat"
                  ),
                ],
              },
            ]}
          />
          <SetupText as="p" layout={["openingNote"]}>
            I balans är bara första villkoret. Nästa steg visar varifrån varje belopp kommer och
            jämför med oberoende kontroller.
          </SetupText>
        </SetupBlock>
        <OpeningInvoices
          details={invoiceDetails}
          label={account ? `${account.code} ${account.name}` : "Öppna fakturor"}
          synthetic={workspace.case.recordClass === "synthetic"}
          asOf={retained?.asOf ?? workspace.case.configuration.dates.openingOn}
        />
      </SetupBlock>
      {!snapshot ? (
        <SetupBlock layout={["section20"]}>
          <SetupButton
            disabled={capture.disabled}
            onClick={() =>
              capture.mutate(
                capture.uncertain && capture.variables
                  ? capture.variables
                  : snapshotInput(workspace, lifecycle, "opening"),
              )
            }
          >
            Kontrollera ingående balanser
          </SetupButton>
        </SetupBlock>
      ) : null}
      {snapshot ? (
        <OpeningAcceptance snapshot={snapshot} lifecycle={lifecycle} open={open} />
      ) : null}
      <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
    </SetupPageContent>
  );
}

function OpeningInvoices({
  details,
  label,
  synthetic,
  asOf,
}: {
  details: ReturnType<typeof openingInvoiceDetails>;
  label: string;
  synthetic: boolean;
  asOf: string | null;
}) {
  const openItems = details.items;

  return (
    <SetupBlock as="aside" layout={["openingDetail"]}>
      <SetupText as="h2" layout={["openingDetailTitle", "semibold"]}>
        {label}
      </SetupText>
      <SetupText as="p" layout={["secondary", "openingSubtitle"]}>
        {details.known ? openItems.length : "—"} öppna fakturor
        {openItems.length
          ? `, ${formatMinor(openItems.reduce((sum, item) => sum + BigInt(item.outstandingMinor), 0n).toString())}`
          : ""}
      </SetupText>
      <SetupBlock layout={["rule", "section"]}>
        {openItems.map((item) => (
          <SetupBlock key={item.sourceIdentity} layout={["openingInvoice"]}>
            <SetupBlock layout={["openingInvoiceText"]}>
              <SetupText layout={["primary"]}>{item.sourceIdentity}</SetupText>
              {item.counterpartyName ? (
                <SetupText layout={["caption"]}>{item.counterpartyName}</SetupText>
              ) : null}
            </SetupBlock>
            <SetupText>{formatMinor(item.outstandingMinor)}</SetupText>
          </SetupBlock>
        ))}
        {details.known ? (
          <SetupBlock layout={["openingInvoiceSum"]}>
            <SetupText>Summa</SetupText>
            <SetupText>
              {formatMinor(
                openItems.reduce((sum, item) => sum + BigInt(item.outstandingMinor), 0n).toString(),
              )}
            </SetupText>
          </SetupBlock>
        ) : null}
      </SetupBlock>
      {synthetic ? (
        <SetupCaption>Exempeldata. Fakturorna är öppna per {formatDate(asOf, false)}.</SetupCaption>
      ) : null}
    </SetupBlock>
  );
}

function OpeningAcceptance({
  snapshot,
  lifecycle,
  open,
}: {
  snapshot: NonNullable<ReturnType<typeof currentSnapshot>>;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { locale } = useBookWorkspace();
  const decide = useSnapshotDecision(() => open("import"));

  return (
    <SetupBlock layout={["section28", "actions8"]}>
      <SetupButton
        disabled={
          decide.disabled ||
          snapshot.blockers.length > 0 ||
          lifecycle.responsibilities?.assignments.bookkeepingApproverId !==
            lifecycle.viewerActorId ||
          hasDecision(lifecycle, snapshot, "accept_opening")
        }
        onClick={() =>
          decide.mutate(
            decide.uncertain && decide.variables
              ? decide.variables
              : {
                  snapshotId: snapshot.id,
                  expectedDigest: snapshot.digest,
                  decision: {
                    kind: "accept_opening",
                    reason: "Granskat öppningsläget mot oberoende kontroller",
                  },
                },
          )
        }
      >
        Godkänn öppningsläget
      </SetupButton>
      <AccountingStatus locale={locale} pending={decide.isPending} error={decide.error} write />
    </SetupBlock>
  );
}

const controlLabels = {
  trial_balance: "BÖCKER",
  bank: "BANK",
  sales_open_items: "KUNDER",
  purchase_open_items: "LEVERANTÖRER",
  vat: "MOMS",
  tax: "SKATTEKONTO",
};

const controlTitles = {
  trial_balance: "Ingående balans",
  bank: "Bank",
  sales_open_items: "Kundreskontran",
  purchase_open_items: "Leverantörsreskontran",
  vat: "Kontrollkonton",
  tax: "Skattekonto",
};

function hasLimitation(
  lifecycle: Lifecycle,
  snapshot: NonNullable<ReturnType<typeof currentSnapshot>>,
  limitation: NonNullable<(typeof snapshot.permittedLimitations)[number]>,
) {
  return lifecycle.decisions.some(
    (item) =>
      ((item.snapshotId === snapshot.id && item.snapshotDigest === snapshot.digest) ||
        snapshot.carriedLimitationDecisionIds.includes(item.id)) &&
      item.decision.kind === "accept_limitation" &&
      item.decision.limitation === limitation,
  );
}

function snapshotNeedsLimitations(
  lifecycle: Lifecycle,
  snapshot: NonNullable<ReturnType<typeof currentSnapshot>>,
) {
  return snapshot.permittedLimitations.some(
    (limitation) => !hasLimitation(lifecycle, snapshot, limitation),
  );
}

function controlReady(
  group: { current: boolean; accepted?: Lifecycle["decisions"][number] } | undefined,
) {
  return Boolean(group?.current || group?.accepted);
}

function originalCoverageSummary(
  lifecycle: Lifecycle,
  retained: ReturnType<typeof currentSnapshot>,
) {
  const originalCoverage = lifecycle.controls.find(
    (control) =>
      retained?.controlIds.includes(control.id) && control.kind === "historical_originals",
  )?.originalCoverage;

  const missingOriginals = originalCoverage?.rows.filter((row) => row.occurrenceId === null).length;

  return originalCoverage
    ? `${originalCoverage.rows.length - (missingOriginals ?? 0)} av ${originalCoverage.rows.length} original. ${missingOriginals} historiska verifikat saknar original.`
    : "Historiska original har inte verifierats.";
}

export function OnboardingVerification({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { locale } = useBookWorkspace();
  const snapshot = currentSnapshot(lifecycle, "book_zero");
  const retained = snapshot ?? latestSnapshot(lifecycle, "book_zero");
  const capture = useSnapshotCapture();
  const decide = useSnapshotDecision();

  const [limitation, setLimitation] = useState<
    "missing_tax_statement" | "missing_historical_originals" | "unreconciled_bank_difference" | null
  >(null);

  const [reason, setReason] = useState("");

  const opening = currentSnapshot(lifecycle, "opening");

  const groups = (
    ["trial_balance", "bank", "sales_open_items", "purchase_open_items", "vat", "tax"] as const
  ).map((typed) => {
    const label = controlLabels[typed];

    const items =
      (typed === "trial_balance" ? opening : retained)?.comparisons.filter(
        (item) => item.kind === typed,
      ) ?? [];

    const current = items.length > 0 && items.every((item) => BigInt(item.differenceMinor) === 0n);

    const accepted = retained
      ? lifecycle.decisions.find(
          (entry) =>
            ((entry.snapshotId === retained.id && entry.snapshotDigest === retained.digest) ||
              retained.carriedLimitationDecisionIds.includes(entry.id)) &&
            entry.decision.kind === "accept_limitation" &&
            entry.decision.limitation ===
              (typed === "bank" ? "unreconciled_bank_difference" : "missing_tax_statement"),
        )
      : undefined;

    return {
      kind: typed,
      label,
      items,
      current,
      accepted: typed === "bank" || typed === "tax" ? accepted : undefined,
    };
  });

  const documentDecision = retained
    ? lifecycle.decisions.find(
        (decision) =>
          ((decision.snapshotId === retained.id && decision.snapshotDigest === retained.digest) ||
            retained.carriedLimitationDecisionIds.includes(decision.id)) &&
          decision.decision.kind === "accept_limitation" &&
          decision.decision.limitation === "missing_historical_originals",
      )
    : undefined;

  const complete = groups.filter((item) => item.current).length;
  const acceptedCount = groups.filter((item) => item.accepted).length + Number(!!documentDecision);
  const verified = hasDecision(lifecycle, snapshot, "accept_book_zero");
  const period = workspace.case.configuration.dates.acceptanceEndsOn;

  const periodName = period
    ? new Intl.DateTimeFormat("sv-SE", {
        month: "long",
        year: "numeric",
        timeZone: "Europe/Stockholm",
      }).format(new Date(`${period}T12:00:00Z`))
    : "perioden";

  return (
    <SetupPageContent styleX={setupLayoutStyles(["verificationPage", "focusedEarly"])}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Verifiera" }]}
        open={open}
      />
      <SetupBlock layout={["earlyTitle"]}>
        <SetupTitle>Verifiera bokföringen</SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["openingSubtitle"]}>
        {workspace.case.recordClass === "synthetic" ? "Exempeldata. " : ""}Book Zero, {periodName},
        kontroll före slutlig deltaimport.
      </SetupText>
      <SetupText as="p" layout={["verificationSummary"]}>
        {complete} kontroller stämmer, {acceptedCount} begränsningar accepterade.
        {controlReady(groups.at(-1)) ? "" : " Skattekonto blockerar."}
      </SetupText>
      <SetupBlock layout={["controls"]}>
        {groups.slice(0, 5).map((group) => (
          <VerificationControl
            key={group.kind}
            group={group}
            lifecycle={lifecycle}
            snapshot={retained}
            opening={opening}
            open={open}
          />
        ))}
        <SetupBlock layout={["controlRow", "verificationRow", "verificationTall"]}>
          <SetupText layout={["verificationLabel"]}>DOKUMENT</SetupText>
          <SetupBlock layout={["verificationDetail"]}>
            <SetupText layout={["warning", "verificationHeading"]}>
              {documentDecision
                ? "! Accepterad dokumentbegränsning"
                : "! Begränsningen behöver beslut"}
            </SetupText>
            <SetupText layout={["verificationCaption"]}>
              {originalCoverageSummary(lifecycle, retained)}
              {documentDecision ? (
                <>
                  <br />
                  {documentDecision.actorName} accepterade{" "}
                  {formatMoment(documentDecision.recordedAt)}.
                </>
              ) : null}
            </SetupText>
          </SetupBlock>
          <SetupButton
            variant="ghost"
            styleX={setupLayoutStyles(["plainAction", "verificationAction"])}
            onClick={() => open("sources")}
          >
            Visa underlag
          </SetupButton>
        </SetupBlock>
        {groups.slice(5).map((group) => (
          <VerificationControl
            key={group.kind}
            group={group}
            lifecycle={lifecycle}
            snapshot={retained}
            opening={opening}
            open={open}
          />
        ))}
      </SetupBlock>
      <SetupBlock layout={["section24", "stack8"]}>
        <SetupBlock layout={["actions12"]}>
          <SetupButton
            disabled={
              decide.disabled ||
              !snapshot ||
              snapshot.blockers.length > 0 ||
              snapshotNeedsLimitations(lifecycle, snapshot) ||
              verified
            }
            onClick={() => {
              if (snapshot)
                decide.mutate(
                  decide.uncertain && decide.variables
                    ? decide.variables
                    : {
                        snapshotId: snapshot.id,
                        expectedDigest: snapshot.digest,
                        decision: {
                          kind: "accept_book_zero",
                          reason: "Kontrollperioden verifierad i setup",
                        },
                      },
                );
            }}
          >
            Spara verifiering med begränsningar
          </SetupButton>
          <SetupButton
            variant="outline"
            disabled={
              decide.disabled || !snapshot?.permittedLimitations.includes("missing_tax_statement")
            }
            onClick={() => {
              setReason("");
              setLimitation("missing_tax_statement");
            }}
          >
            Acceptera utan kontoutdrag
          </SetupButton>
        </SetupBlock>
        <SetupCaption>
          Skattekonto saknar kontoutdrag. Att acceptera utan kontoutdrag sparas med namn och datum.
        </SetupCaption>
      </SetupBlock>
      {!snapshot ? (
        <SetupButton
          disabled={capture.disabled}
          onClick={() =>
            capture.mutate(
              capture.uncertain && capture.variables
                ? capture.variables
                : snapshotInput(workspace, lifecycle, "book_zero"),
            )
          }
        >
          Kontrollera perioden
        </SetupButton>
      ) : null}
      {snapshot?.permittedLimitations.includes("unreconciled_bank_difference") &&
      !lifecycle.decisions.some(
        (item) =>
          ((item.snapshotId === snapshot.id && item.snapshotDigest === snapshot.digest) ||
            snapshot.carriedLimitationDecisionIds.includes(item.id)) &&
          item.decision.kind === "accept_limitation" &&
          item.decision.limitation === "unreconciled_bank_difference",
      ) ? (
        <SetupButton
          variant="outline"
          disabled={decide.disabled}
          onClick={() => {
            setReason("");
            setLimitation("unreconciled_bank_difference");
          }}
        >
          Acceptera ej avstämd bankdifferens
        </SetupButton>
      ) : null}
      {snapshot?.permittedLimitations.includes("missing_historical_originals") &&
      !documentDecision ? (
        <SetupButton
          variant="outline"
          onClick={() => {
            setReason("");
            setLimitation("missing_historical_originals");
          }}
        >
          Acceptera begränsningen för original
        </SetupButton>
      ) : null}
      <AccountingStatus
        locale={locale}
        pending={capture.isPending || decide.isPending}
        error={capture.error ?? decide.error}
        write
      />
      {limitation && snapshot ? (
        <FormDialog
          size="setupDecision"
          title={
            {
              missing_tax_statement: "Acceptera utan kontoutdrag",
              unreconciled_bank_difference: "Acceptera ej avstämd bankdifferens",
              missing_historical_originals: "Acceptera saknade historiska original",
            }[limitation]
          }
          closeLabel="Avbryt"
          onClose={() => setLimitation(null)}
          onEscape={() => {
            if (!decide.isPending && !decide.uncertain) setLimitation(null);
          }}
        >
          <SetupBlock
            as="form"
            layout={["stack12"]}
            onSubmit={(event) => {
              event.preventDefault();
              decide.mutate(
                decide.uncertain && decide.variables
                  ? decide.variables
                  : {
                      snapshotId: snapshot.id,
                      expectedDigest: snapshot.digest,
                      decision: { kind: "accept_limitation", limitation, reason },
                    },
              );
            }}
          >
            <LimitationDetails lifecycle={lifecycle} snapshot={snapshot} limitation={limitation} />
            <InputField
              compact
              label="Skäl, krävs"
              placeholder={
                limitation === "missing_tax_statement"
                  ? "Skriv varför du går vidare utan utdraget"
                  : "Skriv varför du accepterar begränsningen"
              }
              required
              value={reason}
              disabled={decide.isPending || decide.uncertain}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <SetupActions>
              <SetupButton
                type="submit"
                disabled={decide.disabled || (!decide.uncertain && !reason.trim())}
              >
                Acceptera begränsningen
              </SetupButton>
              <SetupButton
                type="button"
                variant="outline"
                disabled={decide.isPending || decide.uncertain}
                onClick={() => setLimitation(null)}
              >
                Avbryt
              </SetupButton>
            </SetupActions>
            <AccountingStatus
              locale={locale}
              pending={decide.isPending}
              error={decide.error}
              write
            />
          </SetupBlock>
        </FormDialog>
      ) : null}
    </SetupPageContent>
  );
}

function LimitationDetails({
  lifecycle,
  snapshot,
  limitation,
}: {
  lifecycle: Lifecycle;
  snapshot: NonNullable<ReturnType<typeof currentSnapshot>>;
  limitation:
    | "missing_tax_statement"
    | "missing_historical_originals"
    | "unreconciled_bank_difference";
}) {
  const { setup } = useBookWorkspace();
  const person = lifecycle.people.find((item) => item.id === lifecycle.viewerActorId);
  const account = setup.accounts.find((item) => item.code === "1630");

  const balance = snapshot.comparisons.find(
    (item) => item.kind === "trial_balance" && item.accountId === account?.id,
  );

  return (
    <SetupBlock layout={["stack4"]}>
      {limitation === "missing_tax_statement" ? (
        <SetupText layout={["caption"]}>
          Skattekonto 1630, saldo {balance ? formatMinor(balance.actualMinor) : "okänt"} per{" "}
          {formatDate(snapshot.asOf, false)}
        </SetupText>
      ) : null}
      <SetupText layout={["caption", "semibold", "section"]}>DET HÄR SPARAS</SetupText>
      <SetupText>Av: {person?.name ?? "Uppgift saknas"}</SetupText>
      <SetupText>Tid: när du sparar</SetupText>
      <SetupText layout={["caption", "note"]}>
        {limitation === "missing_tax_statement"
          ? "Saldot förblir okontrollerat och visas så i verifieringen. Begränsningen följer med in i aktiveringskvittot. Skickas ett utdrag senare kan kontrollen göras om."
          : "Begränsningen sparas med ditt namn, tid och skäl och följer med in i aktiveringskvittot."}
      </SetupText>
    </SetupBlock>
  );
}

function VerificationControl(props: {
  group: {
    kind: keyof typeof controlLabels;
    label: string;
    items: Snapshot["comparisons"];
    current: boolean;
    accepted?: Lifecycle["decisions"][number];
  };
  lifecycle: Lifecycle;
  snapshot: Snapshot | undefined;
  opening: Snapshot | undefined;
  open: OpenOnboardingView;
}) {
  const { group, lifecycle, snapshot, opening } = props;
  const { setup } = useBookWorkspace();
  const expected = group.items.reduce((sum, item) => sum + BigInt(item.expectedMinor), 0n);
  const actual = group.items.reduce((sum, item) => sum + BigInt(item.actualMinor), 0n);
  const positive = (value: bigint) => formatMinor((value < 0n ? -value : value).toString());

  const controls = lifecycle.controls.filter((control) =>
    group.items.some((item) => item.controlId === control.id),
  );

  const identities = controls.flatMap(
    (control) =>
      control.openItemDetails
        ?.filter((item) => BigInt(item.outstandingMinor) !== 0n)
        .map((item) => item.sourceIdentity) ?? [],
  );

  const first = identities[0];
  const prefix = first?.slice(0, first.lastIndexOf("-") + 1);

  const names = identities
    .map((identity, index) =>
      index && prefix && identity.startsWith(prefix) ? identity.slice(prefix.length) : identity,
    )
    .join(", ");

  const accounts = group.items
    .map((item) => setup.accounts.find((account) => account.id === item.accountId))
    .filter((account) => !!account);

  const tax = snapshot?.comparisons.find(
    (item) =>
      item.kind === "trial_balance" &&
      setup.accounts.find((account) => account.id === item.accountId)?.code === "1630",
  );

  const debit = group.items.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) > 0n ? BigInt(item.expectedMinor) : 0n),
    0n,
  );

  const credit = group.items.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) < 0n ? -BigInt(item.expectedMinor) : 0n),
    0n,
  );

  const title = group.accepted
    ? group.kind === "bank"
      ? "! Accepterad bankbegränsning, inte avstämd"
      : "! Accepterad skattekontobegränsning"
    : group.current
      ? `✓ ${controlTitles[group.kind]} stämmer${group.kind === "vat" ? " mot källan" : ""}`
      : group.items.length
        ? `! ${controlTitles[group.kind]} har en differens`
        : "! Kontoutdrag saknas";

  return (
    <SetupBlock
      layout={[
        "controlRow",
        "verificationRow",
        group.kind === "bank" && "verificationTall",
        group.kind === "tax" && !group.current && "verificationTax",
      ]}
    >
      <SetupText
        layout={[
          "verificationLabel",
          group.kind === "tax" && !group.current && "verificationTaxLabel",
        ]}
      >
        {group.label}
      </SetupText>
      <SetupBlock layout={["verificationDetail"]}>
        <SetupText
          layout={[group.current && !group.accepted ? "success" : "warning", "verificationHeading"]}
        >
          {title}
        </SetupText>
        <SetupText layout={["verificationCaption"]}>
          {group.kind === "trial_balance" ? (
            `Debet ${formatMinor(debit.toString())}, kredit ${formatMinor(credit.toString())}, differens ${formatMinor((debit - credit).toString())} per ${opening ? formatDate(opening.asOf, false) : "kontrollpunkten"}`
          ) : group.kind === "sales_open_items" || group.kind === "purchase_open_items" ? (
            `Reskontra ${positive(actual)}, öppna fakturor ${positive(expected)}${names ? ` (${names})` : ""}`
          ) : group.kind === "vat" ? (
            `${accounts.map((account) => `${account.name} ${account.code}`).join(", ")} jämförd med källan`
          ) : group.kind === "bank" ? (
            <>
              {" "}
              {snapshot ? formatDate(snapshot.asOf, false) : "Kontrollpunkten"}: bokfört{" "}
              {formatMinor(actual.toString())}, bank {formatMinor(expected.toString())}, differens{" "}
              {formatMinor((expected - actual).toString())}.<br />
              {group.items.some((item) => BigInt(item.explainedMinor) !== 0n)
                ? "Utbetalning förklarar, men är inte avstämd. "
                : ""}
              {group.accepted
                ? `${group.accepted.actorName} accepterade ${formatMoment(group.accepted.recordedAt)}.`
                : "Beslut om begränsningen saknas."}
            </>
          ) : (
            `Skattekonto 1630 saldo ${tax ? formatMinor(tax.actualMinor) : "okänt"} kan inte jämföras. ${group.accepted ? "Accepterad begränsning, saldot förblir okontrollerat." : "Blockerar tills utdrag mottagits eller medvetet accepterats."}`
          )}
        </SetupText>
      </SetupBlock>
      <SetupButton
        variant="ghost"
        styleX={setupLayoutStyles(["plainAction", "verificationAction"])}
        onClick={() => props.open("sources")}
      >
        Visa underlag
      </SetupButton>
    </SetupBlock>
  );
}
