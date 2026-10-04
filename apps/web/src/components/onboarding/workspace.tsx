import * as Schema from "effect/Schema";
import {
  SetupBlock,
  SetupInlineAction,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import * as Onboarding from "@open-erp/contracts/onboarding";
import { SetupButton, SetupPageContent, SetupTitle } from "@open-erp/ui/components/setup-workspace";
import { useBookWorkspace } from "@/lib/book-context";
import { formatDate } from "./data";
import { Breadcrumb, type OpenOnboardingView } from "./shared";
import { sourceLabels } from "./sources";

export function OnboardingWorkspace({
  workspace,
  lifecycle,
  open,
}: {
  workspace: typeof Onboarding.OnboardingWorkspace.Type;
  lifecycle: typeof Onboarding.OnboardingLifecycle.Type;
  open: OpenOnboardingView;
}) {
  const { book } = useBookWorkspace();

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
          state: task("company")?.state ?? "needs_information",
          view: "profile",
        },
        {
          label: "Bokföringsprofil",
          detail: task("company")?.blockers.join(", ") ?? "",
          state: task("company")?.state ?? "needs_information",
          view: "profile",
        },
        {
          label: "Kompatibilitet",
          detail: workspace.qualification.filter((item) => item.state === "supported_with_handoff")
            .length
            ? `${workspace.qualification.filter((item) => item.state === "supported_with_handoff").length} delar stöds med överlämning`
            : "",
          state: task("compatibility")?.state ?? "needs_information",
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
            : "Vem bokför och godkänner är inte satt",
          state: lifecycle.responsibilities ? "complete" : "needs_information",
          view: "responsibilities",
        },
      ],
    },
    {
      label: "Källor",
      rows: ["previous_books", "bank", "other", "tax"].map((category) => {
        const source = workspace.sources.filter((item) => item.category === category);

        const typed = Schema.decodeUnknownSync(Onboarding.SourceCategory)(category);

        return {
          label: sourceLabels[typed],
          detail: source.length
            ? source.map((item) => item.occurrence.filename).join(", ")
            : "Underlag har inte levererats",
          state: source.length ? "complete" : "needs_information",
          view: "sources",
        };
      }),
    },
    {
      label: "Migrering",
      rows: [
        {
          label: "Historisk import",
          detail: workspace.imports.length
            ? `${workspace.imports.filter((item) => item.financialState === "posted").length} av ${workspace.imports.length} importer klara`
            : "",
          state: task("import")?.state ?? "needs_information",
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

  const blockers =
    lifecycle.snapshots.find((item) => item.current && item.snapshot.purpose === "activation")
      ?.snapshot.blockers ?? workspace.cutover.blockers;

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
                    layout={["checklistLabel", "crumbButton"]}
                  >
                    {row.label}
                  </SetupInlineAction>
                  <SetupText layout={["checklistDetail"]}>{row.detail}</SetupText>
                  <SetupText
                    layout={[
                      "checklistStatus",
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
                    {
                      {
                        complete: "✓ Klar",
                        blocked: "! Blockerad",
                        in_progress: "○ Pågår",
                        needs_information: "○ Ej påbörjad",
                        not_started: "○ Ej påbörjad",
                      }[row.state]
                    }
                  </SetupText>
                </SetupBlock>
              ))}
            </SetupBlock>
          ))}
        </SetupBlock>
        <SetupBlock as="aside" layout={["blockers"]}>
          <SetupText as="h2" layout={["checklistHeading"]}>
            Det som blockerar go live
          </SetupText>
          {blockers.map((blocker) => (
            <SetupText as="p" key={blocker} layout={["secondary"]}>
              {blocker}
            </SetupText>
          ))}
          <SetupBlock>
            <SetupButton onClick={() => open("import")}>Fortsätt med import</SetupButton>
          </SetupBlock>
        </SetupBlock>
      </SetupBlock>
    </SetupPageContent>
  );
}
