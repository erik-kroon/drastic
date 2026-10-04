import { factText } from "./profile";
import { importReadiness, missingSourceAccounts } from "./import-readiness";
import { originalCoverage, sourceScope } from "./source-inventory";
import { useSieSource } from "./sources";

import {
  SetupBlock,
  SetupInlineAction,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { SetupButton, SetupPageContent, SetupTitle } from "@open-erp/ui/components/setup-workspace";
import { useBookWorkspace } from "@/lib/book-context";
import { formatDate, useOnboardingFacts } from "./data";
import { Breadcrumb, type OpenOnboardingView } from "./shared";
import { sourceLabels } from "./sources";

function profileSummary(facts: ReturnType<typeof useOnboardingFacts>["data"]) {
  const kinds = [
    "jurisdiction",
    "legal_form",
    "reporting_framework",
    "accounting_method",
    "base_currency",
  ] as const;

  const values: string[] = [];

  const labels = new Map([
    ["SE", "Sverige"],
    ["Aktiebolag", "AB"],
    ["Fakturametoden", "fakturametoden"],
  ]);

  for (const kind of kinds) {
    const fact = facts?.find((entry) => entry.revision.factKind === kind);

    if (!fact || fact.review?.result !== "confirmed") return "Företagsfakta behöver bekräftas";
    const text = factText(fact);
    values.push(labels.get(text) ?? text);
  }

  return values.join(", ");
}

function workspaceRowStatus(
  row: { label: string; state: typeof Onboarding.OnboardingTask.Type.state },
  group: string,
  missingOriginals: number | undefined,
  decisions: number | null,
  blockerCount: number,
  hasImports: boolean,
) {
  return row.label === "Bokföringsprofil" && row.state === "complete"
    ? "✓ Bekräftad"
    : row.label === "Dokument" && missingOriginals
      ? `! ${missingOriginals} saknar original`
      : row.label === "Skattekonto" && group === "Källor"
        ? "! Ej levererat"
        : row.label === "Historisk import" && decisions
          ? `! ${decisions} undantag`
          : row.label === "Övergång" && blockerCount
            ? `Blockerad av ${blockerCount} saker`
            : row.label === "Ingående balanser" && !hasImports
              ? "○ Väntar på import"
              : group === "Verifiering" && !hasImports
                ? "○ Väntar"
                : group === "Källor" && row.state === "complete"
                  ? "✓ Mottagen"
                  : {
                      complete: "✓ Klar",
                      blocked: "! Blockerad",
                      in_progress: "○ Pågår",
                      needs_information: "○ Ej påbörjad",
                      not_started: "○ Ej påbörjad",
                    }[row.state];
}

function workspaceGroups(
  workspace: typeof Onboarding.OnboardingWorkspace.Type,
  lifecycle: typeof Onboarding.OnboardingLifecycle.Type,
  book: { name: string },
  facts: ReturnType<typeof useOnboardingFacts>,
  sie: ReturnType<typeof useSieSource>,
  readiness: ReturnType<typeof importReadiness>,
  coverage: ReturnType<typeof originalCoverage>,
  missingOriginals: number | undefined,
  companyConfirmed: boolean,
) {
  function task(id: typeof Onboarding.OnboardingTask.Type.id) {
    return workspace.tasks.find((item) => item.id === id);
  }

  const groups: Array<{
    label: string;
    rows: Array<{
      label: string;
      detail: string;
      state: typeof Onboarding.OnboardingTask.Type.state;
      view: Parameters<OpenOnboardingView>[0];
    }>;
  }> = [
    {
      label: "Företag",
      rows: [
        {
          label: "Identitet",
          detail: book.name,
          state: companyConfirmed ? "complete" : "needs_information",
          view: "profile",
        },
        {
          label: "Bokföringsprofil",
          detail: profileSummary(facts.data),
          state: companyConfirmed ? "complete" : "needs_information",
          view: "profile",
        },
        {
          label: "Kompatibilitet",
          detail: workspace.qualification.filter((item) => item.state === "supported_with_handoff")
            .length
            ? `Fakta, stöd och ${workspace.qualification.filter((item) => item.state === "supported_with_handoff").length} överlämningar`
            : "",
          state: workspace.qualification.length ? "complete" : "needs_information",
          view: "compatibility",
        },
      ],
    },
    {
      label: "Människor",
      rows: [
        {
          label: "Ansvar",
          detail: lifecycle.responsibilities
            ? "Ansvar är satt"
            : "Vem bereder och godkänner är inte satt",
          state: lifecycle.responsibilities ? "complete" : "needs_information",
          view: "responsibilities",
        },
      ],
    },
    {
      label: "Källor",
      rows: (["previous_books", "bank", "other", "tax"] as const).map((category) => ({
        label: sourceLabels[category],
        detail:
          category === "other" && coverage
            ? `${coverage.rows.length - (missingOriginals ?? 0)} av ${coverage.rows.length} original bevarade`
            : category === "previous_books" && sie.preview.data
              ? `${sie.source?.occurrence.filename}, ${sie.preview.data.vouchers.length} verifikat`
              : category === "bank"
                ? `Konto ${lifecycle.projection.accounts.find((account) => account.id === lifecycle.projection.bankStatements[0]?.accountId)?.code ?? ""}, ${lifecycle.projection.bankStatements.reduce((total, statement) => total + statement.rows.length, 0)} bankhändelser`
                : sourceScope(category, workspace, lifecycle) || "Kontoutdrag har inte levererats",
        state:
          category === "other" && missingOriginals
            ? "blocked"
            : workspace.sources.some((item) => item.category === category)
              ? "complete"
              : "needs_information",
        view: "sources",
      })),
    },
    {
      label: "Migrering",
      rows: [
        {
          label: "Historisk import",
          detail:
            readiness.total === null
              ? ""
              : `${readiness.ready} av ${readiness.total} verifikat klara`,
          state: readiness.decisions ? "blocked" : (task("import")?.state ?? "needs_information"),
          view: "import",
        },
        {
          label: "Ingående balanser",
          detail: `Kontrollpunkt ${formatDate(workspace.case.configuration.dates.openingOn)}`,
          state: task("opening")?.state ?? "needs_information",
          view: "opening",
        },
      ],
    },
    {
      label: "Verifiering",
      rows: [
        {
          label: "Bokföring",
          detail: "Ingående balans mot källan",
          state: task("reconciliation")?.state ?? "needs_information",
          view: "verification",
        },
        {
          label: "Bank",
          detail: "Bokfört saldo mot kontoutdrag",
          state: task("reconciliation")?.state ?? "needs_information",
          view: "verification",
        },
        {
          label: "Kundreskontra",
          detail: "Mot öppna kundfakturor",
          state: task("reconciliation")?.state ?? "needs_information",
          view: "verification",
        },
        {
          label: "Leverantörsreskontra",
          detail: "Mot öppna leverantörsfakturor",
          state: task("reconciliation")?.state ?? "needs_information",
          view: "verification",
        },
        {
          label: "Skattekonto",
          detail: "Mot kontoutdrag",
          state: task("reconciliation")?.state ?? "needs_information",
          view: "verification",
        },
      ],
    },
    {
      label: "Go live",
      rows: [
        {
          label: "Övergång",
          detail: "Kan bekräftas när blockerarna är lösta",
          state: lifecycle.activation ? "complete" : "blocked",
          view: "cutover",
        },
      ],
    },
  ];

  return groups;
}

export function OnboardingWorkspace({
  workspace,
  lifecycle,
  open,
}: {
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  lifecycle: typeof Onboarding.OnboardingLifecycle.Type;
  open: OpenOnboardingView;
}) {
  const { book, setup } = useBookWorkspace();

  const facts = useOnboardingFacts(
    workspace.case.configuration.dates.candidateLiveOn ?? setup.today,
  );

  const sie = useSieSource(workspace);

  const pendingFindings =
    lifecycle.controls
      .filter((control) => control.importReview?.previewId === sie.preview.data?.id)
      .toSorted((left, right) => right.qualifiedAt.localeCompare(left.qualifiedAt))[0]
      ?.importReview?.findings.filter((finding) => finding.state === "pending") ?? [];

  const missingAccounts = missingSourceAccounts(sie.preview.data, setup.accounts).filter(
    (account) => !sie.mappings.data?.current.some((mapping) => mapping.sourceAccount === account),
  );

  const readiness = importReadiness(sie.preview.data, missingAccounts, pendingFindings);
  const coverage = originalCoverage(workspace, lifecycle);
  const missingOriginals = coverage?.rows.filter((item) => item.occurrenceId === null).length;

  const companyConfirmed =
    facts.data?.length && facts.data.every((fact) => fact.review?.result === "confirmed");

  const groups = workspaceGroups(
    workspace,
    lifecycle,
    book,
    facts,
    sie,
    readiness,
    coverage,
    missingOriginals,
    !!companyConfirmed,
  );

  const blockers: Array<{ label: string; view: Parameters<OpenOnboardingView>[0] }> = [];

  if (!lifecycle.responsibilities)
    blockers.push({ label: "Ansvar behöver sparas", view: "responsibilities" });

  if (missingOriginals)
    blockers.push({ label: `${missingOriginals} verifikat saknar original`, view: "sources" });

  if (!workspace.sources.some((item) => item.category === "tax"))
    blockers.push({ label: "Skattekonto är inte levererat", view: "sources" });

  if (readiness.decisions)
    blockers.push({ label: `${readiness.decisions} undantag i historisk import`, view: "import" });

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page", "workspace"])}>
      <Breadcrumb items={[{ label: book.name }, { label: "Setup" }]} open={open} />
      <SetupBlock layout={["earlyTitle"]}>
        <SetupTitle>Setup</SetupTitle>
      </SetupBlock>
      <SetupBlock layout={["columns", "tableSpace"]}>
        <SetupBlock layout={["checklist"]}>
          {groups.map((group) => (
            <SetupBlock as="section" key={group.label}>
              <SetupText as="h2" layout={["checklistHeading"]}>
                {group.label}
              </SetupText>
              {group.rows.map((row) => (
                <SetupBlock key={row.label} layout={["checklistRow"]}>
                  <SetupInlineAction
                    type="button"
                    onClick={() => open(row.view)}
                    layout={["crumbButton", "checklistLabel"]}
                  >
                    {row.label}
                  </SetupInlineAction>
                  <SetupText layout={["checklistDetail"]}>{row.detail}</SetupText>
                  <SetupText
                    layout={[
                      "checklistStatus",
                      ...(row.state === "blocked" || row.label === "Bokföringsprofil"
                        ? ["workspaceStatus" as const]
                        : []),
                      (
                        {
                          complete: "success",
                          blocked: "warning",
                          in_progress: "secondary",
                          needs_information: "secondary",
                          not_started: "secondary",
                        } as const
                      )[row.state],
                    ]}
                  >
                    {workspaceRowStatus(
                      row,
                      group.label,
                      missingOriginals,
                      readiness.decisions,
                      blockers.length,
                      workspace.imports.length > 0,
                    )}
                  </SetupText>
                </SetupBlock>
              ))}
            </SetupBlock>
          ))}
        </SetupBlock>
        <SetupBlock as="aside" layout={["blockers"]}>
          <SetupText as="h2" layout={["workspaceBlockerHeading"]}>
            Det som blockerar go live
          </SetupText>
          {blockers.map((blocker) => {
            return (
              <SetupInlineAction
                key={blocker.label}
                layout={["primary"]}
                onClick={() => open(blocker.view)}
              >
                {blocker.label}
              </SetupInlineAction>
            );
          })}
          <SetupBlock layout={["workspaceContinue"]}>
            <SetupButton onClick={() => open("import")}>Fortsätt med import</SetupButton>
          </SetupBlock>
        </SetupBlock>
      </SetupBlock>
    </SetupPageContent>
  );
}
