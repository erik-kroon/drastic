import type * as Onboarding from "@open-erp/contracts/onboarding";
import { SetupBlock, SetupText, setupLayoutStyles } from "@open-erp/ui/components/setup-parts";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { SetupButton, SetupPageContent, SetupTitle } from "@open-erp/ui/components/setup-workspace";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { useBookWorkspace } from "@/lib/book-context";
import type { Lifecycle, Workspace } from "./lifecycle";
import type { OpenOnboardingView } from "./shared";

type Qualification = typeof Onboarding.OnboardingQualification.Type;

type Capability = {
  id: string;
  label: string;
  state: Qualification["state"] | "not_applicable";
  detail: string;
  tone?: "warning" | "blocked";
};

const status = {
  supported: "✓ Stöds",
  supported_with_handoff: "→ Stöds med överlämning",
  needs_information: "! Behöver uppgift",
  not_supported: "× Stöds inte",
  not_applicable: "Ej aktuellt",
};

const statusLayout = {
  supported: "success",
  supported_with_handoff: "primary",
  needs_information: "warning",
  not_supported: "blocked",
  not_applicable: "secondary",
} as const;

function capabilities(workspace: Workspace, lifecycle: Lifecycle): Capability[] {
  const qualification = (family: Qualification["family"]) =>
    workspace.qualification.find((item) => item.family === family);

  const posting = qualification("posting_eligibility");
  const vat = qualification("vat");
  const statements = qualification("statements");
  const corporateTax = qualification("corporate_tax");

  const applicability = (kind: "foreign_currency_applicability" | "payroll_applicability") => {
    const fact = lifecycle.projection.companyFacts.find(
      (item) => item.revision.factKind === kind && item.review?.result === "confirmed",
    );

    return fact?.revision.value.state === "known" ? fact.revision.value.value : null;
  };

  const foreignCurrency = applicability("foreign_currency_applicability");
  const payroll = applicability("payroll_applicability");
  const taxStatement = lifecycle.controls.some((control) => control.kind === "tax");

  return [
    {
      id: "posting",
      label: "Bokföring",
      state: posting?.state ?? "needs_information",
      detail:
        posting?.state === "supported"
          ? "Bekräftad daterad profil. Stödet gäller den kvalificerade profilen."
          : "Bekräftad företagsprofil och daterade regler saknas.",
    },
    {
      id: "invoices",
      label: "Kund- och leverantörsfakturor",
      state: posting?.state ?? "needs_information",
      detail:
        "Bokföring kräver kvalificerad profil. Utskick och externa utfall kontrolleras separat.",
    },
    {
      id: "vat",
      label: "Moms",
      state: vat?.state ?? "needs_information",
      detail:
        vat?.state === "supported"
          ? "Daterad momsprofil bekräftad. Inlämning kontrolleras separat."
          : "Bekräftade registreringar, daterade regler eller aktivering saknas.",
    },
    {
      id: "foreign_currency",
      label: "Utländsk valuta",
      state: foreignCurrency === false ? "not_applicable" : "needs_information",
      detail:
        foreignCurrency === false
          ? "Ingen utländsk valuta i den bekräftade företagsprofilen."
          : "Valutafall kräver kvalificerad profil och granskning av byrå.",
    },
    {
      id: "payroll",
      label: "Löner",
      state: payroll === false ? "not_applicable" : "needs_information",
      detail:
        payroll === false
          ? "Ingen löneplikt i den bekräftade företagsprofilen."
          : "Native löner är uppskjutna. Kvalificerad extern behandling krävs.",
    },
    {
      id: "statements",
      label: "Årsredovisning",
      state:
        statements?.state === "supported"
          ? "supported_with_handoff"
          : (statements?.state ?? "needs_information"),
      detail:
        statements?.state === "supported"
          ? "Förberedelse här, inlämning externt."
          : "Bekräftad daterad profil saknas. Inlämning sker externt.",
    },
    {
      id: "tax_account",
      label: "Skattekonto",
      state: "needs_information",
      tone: "warning",
      detail: taxStatement
        ? "Kontoutdrag levererat. Matchning och kvalificering behöver kontrolleras."
        : "Kontoutdrag är inte levererat",
    },
    workspace.case.path === "demo"
      ? {
          id: "illustrative_unsupported",
          label: "Särskild redovisning X (illustrativ)",
          state: "not_supported",
          tone: "blocked",
          detail:
            "Du kan fortsätta använda OpenERP för bokföring och fakturor. Den här delen aktiveras inte.",
        }
      : {
          id: "corporate_tax",
          label: "Inkomstdeklaration",
          state: corporateTax?.state ?? "needs_information",
          detail: corporateTax?.reason ?? "Bekräftad daterad skatteprofil saknas.",
        },
  ];
}

export function OnboardingCompatibility({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { book } = useBookWorkspace();

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page"])}>
      <SetupTitle>Vad OpenERP stöder för {book.name}</SetupTitle>
      <SetupBlock layout={["section"]}>
        <SetupTable
          title="Kompatibilitet"
          width={tokens.setupWorkspaceWidth}
          columns={[
            { id: "capability", label: "Del", width: tokens.setupColumn260 },
            { id: "state", label: "Status", width: tokens.setupColumn210 },
            { id: "detail", label: "Det här gäller", width: tokens.setupColumn514 },
          ]}
          rows={capabilities(workspace, lifecycle).map((item) => ({
            id: item.id,
            tone: item.tone,
            description:
              item.id === "illustrative_unsupported" ? (
                <SetupText layout={["secondary"]}>{item.detail}</SetupText>
              ) : undefined,
            cells: [
              item.label,
              <SetupText key="status" layout={[statusLayout[item.state], "medium"]}>
                {status[item.state]}
              </SetupText>,
              item.id === "illustrative_unsupported" ? null : (
                <SetupText key="detail" layout={["secondary"]}>
                  {item.detail}
                </SetupText>
              ),
            ],
          }))}
        />
      </SetupBlock>
      <SetupBlock layout={["section20"]}>
        <SetupButton onClick={() => open("workspace")}>Öppna Setup</SetupButton>
      </SetupBlock>
    </SetupPageContent>
  );
}
