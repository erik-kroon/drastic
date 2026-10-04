import { useState } from "react";
import * as stylex from "@stylexjs/stylex";
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
import { formatDate, formatMinor } from "./data";
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
import { Breadcrumb, type OpenOnboardingView } from "./shared";
import { useSieSource } from "./sources";
import { styles } from "./styles";

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
  const openItems =
    sie.plan.data?.input.openItems.filter((item) => item.sourceAccount === account?.code) ?? [];
  const debit = balances.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) > 0n ? BigInt(item.expectedMinor) : 0n),
    0n,
  );
  const credit = balances.reduce(
    (sum, item) => sum + (BigInt(item.expectedMinor) < 0n ? -BigInt(item.expectedMinor) : 0n),
    0n,
  );
  const difference = debit - credit;
  return (
    <SetupPageContent styleX={styles.page}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Ingående balanser" }]}
        open={open}
      />
      <div {...stylex.props(styles.title)}>
        <SetupTitle>
          Ingående balanser per{" "}
          {formatDate(retained?.asOf ?? workspace.case.configuration.dates.openingOn)}
        </SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Slutsaldon i tidigare bokföring vid kontrollpunkten.
        {workspace.case.recordClass === "synthetic" ? " Exempeldata." : ""}
      </p>
      <div {...stylex.props(styles.openingColumns, styles.section24)}>
        <div {...stylex.props(styles.stack)}>
          <SetupTable
            title="Ingående balanser"
            width={tokens.setupOpeningWidth}
            density="compact"
            columns={[
              { id: "account", label: "Konto", width: tokens.setupColumn60 },
              { id: "name", label: "Namn", width: tokens.setupColumn150 },
              { id: "debit", label: "Debet", width: tokens.setupColumn100, numeric: true },
              { id: "credit", label: "Kredit", width: tokens.setupColumn100, numeric: true },
              { id: "source", label: "Källa", width: tokens.setupOpeningSourceWidth },
            ]}
            rows={[
              ...balances.map((item) => {
                const name = setup.accounts.find((candidate) => candidate.id === item.accountId);
                const source = lifecycle.controls.find((control) => control.id === item.controlId);
                return {
                  id: `${item.controlId}-${item.accountId}`,
                  tone: selected === item.accountId ? "selected" : undefined,
                  cells: [
                    <button
                      type="button"
                      key="select"
                      {...stylex.props(styles.crumbButton)}
                      onClick={() => setSelection(item.accountId)}
                    >
                      {name?.code ?? "Okänt konto"}
                    </button>,
                    name?.name ?? "Uppgift saknas",
                    BigInt(item.expectedMinor) > 0n ? formatMinor(item.expectedMinor) : "",
                    BigInt(item.expectedMinor) < 0n
                      ? formatMinor((-BigInt(item.expectedMinor)).toString())
                      : "",
                    source?.provenance ?? "Källa saknas",
                  ],
                };
              }),
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
                    <span
                      key="balance"
                      {...stylex.props(difference === 0n ? styles.success : styles.warning)}
                    >
                      {difference === 0n ? "✓ I balans" : "! Differens"}
                    </span>
                  ) : (
                    "Ej kontrollerat"
                  ),
                ],
              },
            ]}
          />
          <div {...stylex.props(styles.section)}>
            <SetupCaption>
              I balans är bara första villkoret. Nästa steg visar varifrån saldona kommer.
            </SetupCaption>
          </div>
        </div>
        <aside {...stylex.props(styles.stack4)}>
          <h2 {...stylex.props(styles.semibold)}>
            {account ? `${account.code} ${account.name}` : "Öppna fakturor"}
          </h2>
          <p {...stylex.props(styles.secondary)}>
            {openItems.length} öppna fakturor
            {openItems.length
              ? `, ${formatMinor(openItems.reduce((sum, item) => sum + BigInt(item.outstandingMinor), 0n).toString())}`
              : ""}
          </p>
          <div {...stylex.props(styles.rule, styles.section)}>
            {openItems.map((item) => (
              <div key={item.sourceIdentity} {...stylex.props(styles.row)}>
                <div {...stylex.props(styles.stack4)}>
                  <span>{item.sourceIdentity}</span>
                  <span {...stylex.props(styles.caption)}>{item.basis}</span>
                </div>
                <span>{formatMinor(item.outstandingMinor)}</span>
              </div>
            ))}
          </div>
          {workspace.case.recordClass === "synthetic" ? (
            <SetupCaption>
              Exempeldata. Fakturorna är öppna per{" "}
              {formatDate(retained?.asOf ?? workspace.case.configuration.dates.openingOn, false)}.
            </SetupCaption>
          ) : null}
        </aside>
      </div>
      {!snapshot ? (
        <div {...stylex.props(styles.section20)}>
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
        </div>
      ) : null}
      <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
    </SetupPageContent>
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
    "missing_tax_statement" | "missing_historical_originals" | null
  >(null);
  const [reason, setReason] = useState("");
  const groups = Object.entries(controlLabels).map(([kind, label]) => {
    const typed =
      kind === "trial_balance"
        ? "trial_balance"
        : kind === "bank"
          ? "bank"
          : kind === "sales_open_items"
            ? "sales_open_items"
            : kind === "purchase_open_items"
              ? "purchase_open_items"
              : kind === "vat"
                ? "vat"
                : "tax";
    const items = retained?.comparisons.filter((item) => item.kind === typed) ?? [];
    const current =
      items.length > 0 && items.every((item) => BigInt(item.unexplainedDifferenceMinor) === 0n);
    return { kind: typed, label, items, current };
  });
  const documentDecision = retained
    ? lifecycle.decisions.find(
        (decision) =>
          decision.snapshotId === retained.id &&
          decision.snapshotDigest === retained.digest &&
          decision.decision.kind === "accept_limitation" &&
          decision.decision.limitation === "missing_historical_originals",
      )
    : undefined;
  const complete = groups.filter((item) => item.current).length + (documentDecision ? 1 : 0);
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
    <SetupPageContent styleX={[styles.page, styles.focusedEarly]}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Verifiera" }]}
        open={open}
      />
      <div {...stylex.props(styles.earlyTitle)}>
        <SetupTitle>Verifiera bokföringen</SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Book Zero, {periodName}. Jämför det importerade mot oberoende underlag.
      </p>
      <p {...stylex.props(styles.section20, styles.medium)}>
        {complete} av 7 kontroller klara.
        {groups.find((item) => item.kind === "tax")?.current ? "" : " Skattekonto blockerar."}
      </p>
      <div {...stylex.props(styles.controls, styles.section)}>
        {groups.slice(0, 5).map((group) => (
          <VerificationControl key={group.kind} group={group} open={open} />
        ))}
        <div {...stylex.props(styles.controlRow)}>
          <span {...stylex.props(styles.controlTitle)}>DOKUMENT</span>
          <div {...stylex.props(styles.stack4)}>
            <span {...stylex.props(documentDecision ? styles.success : styles.warning)}>
              {documentDecision ? "✓ Accepterad begränsning" : "! Begränsningen behöver beslut"}
            </span>
            <span {...stylex.props(styles.caption)}>
              {documentDecision
                ? `${personName(lifecycle, documentDecision.actorId)}, ${formatDate(documentDecision.recordedAt)}`
                : "Historiska original har inte verifierats."}
            </span>
          </div>
          <SetupButton variant="ghost" styleX={styles.plainAction} onClick={() => open("sources")}>
            Visa underlag
          </SetupButton>
        </div>
        {groups.slice(5).map((group) => (
          <VerificationControl key={group.kind} group={group} open={open} />
        ))}
      </div>
      <div {...stylex.props(styles.section24, styles.stack8)}>
        <div {...stylex.props(styles.actions12)}>
          <SetupButton
            disabled={decide.disabled || !snapshot || snapshot.blockers.length > 0 || verified}
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
            Markera {periodName.split(" ")[0]} som verifierad
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
        </div>
        <SetupCaption>
          Skattekonto saknar kontoutdrag. Att acceptera utan kontoutdrag sparas med namn och datum.
        </SetupCaption>
      </div>
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
          size="compact"
          title={
            limitation === "missing_tax_statement"
              ? "Acceptera utan kontoutdrag"
              : "Acceptera saknade historiska original"
          }
          closeLabel="Avbryt"
          onClose={() => setLimitation(null)}
          onEscape={() => {
            if (!decide.isPending && !decide.uncertain) setLimitation(null);
          }}
        >
          <form
            {...stylex.props(styles.stack12)}
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
            <InputField
              compact
              label="Skäl"
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
                Acceptera
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
          </form>
        </FormDialog>
      ) : null}
    </SetupPageContent>
  );
}

function VerificationControl({
  group,
  open,
}: {
  group: {
    kind: keyof typeof controlLabels;
    label: string;
    items: readonly {
      expectedMinor: string;
      actualMinor: string;
      differenceMinor: string;
      explainedMinor: string;
    }[];
    current: boolean;
  };
  open: OpenOnboardingView;
}) {
  const expected = group.items.reduce((sum, item) => sum + BigInt(item.expectedMinor), 0n);
  const actual = group.items.reduce((sum, item) => sum + BigInt(item.actualMinor), 0n);
  const explained = group.items.reduce((sum, item) => sum + BigInt(item.explainedMinor), 0n);
  return (
    <div {...stylex.props(styles.controlRow, !group.current && styles.amberRow)}>
      <span {...stylex.props(styles.controlTitle)}>{group.label}</span>
      <div {...stylex.props(styles.stack4)}>
        <span {...stylex.props(group.current ? styles.success : styles.warning)}>
          {group.current
            ? group.kind === "bank" && explained !== 0n
              ? "✓ Bankdifferensen är förklarad"
              : `✓ ${controlTitles[group.kind]} stämmer`
            : group.items.length
              ? `! ${controlTitles[group.kind]} har en differens`
              : "! Kontoutdrag saknas"}
        </span>
        <span {...stylex.props(styles.caption)}>
          {group.items.length
            ? `Bokfört ${formatMinor(actual.toString())}, underlag ${formatMinor(expected.toString())}, skillnad ${formatMinor((expected - actual).toString())}${explained !== 0n ? `, förklarat ${formatMinor(explained.toString())}` : ""}`
            : "Kan inte jämföras. Blockerar verifieringen."}
        </span>
      </div>
      <SetupButton variant="ghost" styleX={styles.plainAction} onClick={() => open("sources")}>
        Visa underlag
      </SetupButton>
    </div>
  );
}
