import { createRoot } from "react-dom/client";
import { BlockedImpactWorkspace } from "../../../apps/web/src/components/corrections/blocked-impact-workspace";
import { BundleWorkspace } from "../../../apps/web/src/components/corrections/bundle-workspace";
import {
  Workspace,
  WorkspaceCompany,
  WorkspaceNavigation,
  WorkspaceNavLink,
  WorkspaceAccount,
} from "@open-erp/ui/components/workspace";
import { NavIcon } from "@open-erp/ui/components/nav-icon";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import {
  CorrectionBreadcrumb,
  CorrectionFooterHint,
  CorrectionReviewBadge,
} from "@open-erp/ui/components/correction-bundle-review";
import { CommandSearch } from "@open-erp/ui/components/command-search";
import {
  bundle,
  setup,
  impact,
  staleImpact,
  blockedImpact,
  presentation,
  filedVat,
  reopening,
} from "./fixture";
import "@open-erp/ui/globals.css";

const state = new URLSearchParams(location.search).get("state") ?? "q45";

const stale = state === "q47";

const items = [
  { label: "Bank", icon: "bank" },
  { label: "Försäljning", icon: "sales" },
  { label: "Inköp", icon: "purchases" },
  { label: "Dokument", icon: "documents" },
] as const;

const accounting = [
  { label: "Bokföring", icon: "bookkeeping" },
  { label: "Skatt och löner", icon: "tax" },
  { label: "Rapporter", icon: "reports" },
  { label: "Bokslut", icon: "closing" },
] as const;

const root = document.getElementById("root");

if (!root) throw new Error("Correction board root is missing");

createRoot(root).render(
  <div id="component-board">
    <Workspace
      pageKey={stale ? "q47" : "q45"}
      brand={
        <>
          <WorkspaceCompany name="Fjällby Konsult AB" href="#company" />
          <CommandSearch
            label="Sök"
            open={false}
            onOpenChange={() => {}}
            query=""
            onQueryChange={() => {}}
            groups={[]}
          />
        </>
      }
      mobileNavigation={null}
      footer={
        <>
          <WorkspaceNavLink href="#settings">
            <NavIcon name="settings" />
            Inställningar
          </WorkspaceNavLink>
          <WorkspaceAccount name="Elin Sund">Syntetisk visningsfixtur</WorkspaceAccount>
        </>
      }
      navigation={
        <>
          <WorkspaceNavigation label="Att göra" showLabel={false}>
            <WorkspaceNavLink href="#work" count={7}>
              <NavIcon name="todo" />
              Att göra
            </WorkspaceNavLink>
            <WorkspaceNavLink href="#overview">
              <NavIcon name="overview" />
              Översikt
            </WorkspaceNavLink>
          </WorkspaceNavigation>
          <WorkspaceNavigation label="ARBETE">
            {items.map((item) => (
              <WorkspaceNavLink key={item.icon} href={`#${item.icon}`}>
                <NavIcon name={item.icon} />
                {item.label}
              </WorkspaceNavLink>
            ))}
          </WorkspaceNavigation>
          <WorkspaceNavigation label="REDOVISNING">
            {accounting.map((item) => (
              <WorkspaceNavLink
                key={item.icon}
                href={`#${item.icon}`}
                active={item.icon === "bookkeeping"}
                selection="neutral"
              >
                <NavIcon name={item.icon} />
                {item.label}
              </WorkspaceNavLink>
            ))}
          </WorkspaceNavigation>
        </>
      }
    >
      {state === "q46" ? (
        <BlockedImpactWorkspace
          impact={blockedImpact}
          filedVat={filedVat}
          reopening={reopening}
          headerMetadata={
            <CorrectionReviewBadge variant="outline" example>
              Exempeldata
            </CorrectionReviewBadge>
          }
          footer={
            <>
              <Link href="#books">Avbryt rättelsen</Link>
              <CorrectionFooterHint>Inget ändras</CorrectionFooterHint>
            </>
          }
          setup={setup}
          locale="sv"
          scale={2}
          breadcrumb={
            <>
              <Link href="#books">Bokföring</Link>
              <span>›</span>
              <span>Verifikat</span>
              <span>›</span>
              <span>A139</span>
              <span>›</span>
              <span>Rättelse kräver september</span>
            </>
          }
          actions={
            <Button
              fullWidth
              onClick={() => {
                throw new Error("Visual fixtures cannot approve period reopening");
              }}
            >
              Godkänn att september öppnas
            </Button>
          }
          details={null}
        />
      ) : (
        <BundleWorkspace
          bundle={bundle}
          impact={stale ? staleImpact : impact}
          setup={setup}
          locale="sv"
          scale={2}
          state={stale ? "stale" : "reviewing"}
          presentation={presentation}
          footer={
            <>
              <Link href="#books">{stale ? "Avbryt rättelsen" : "Skicka tillbaka till Sara"}</Link>
              <CorrectionFooterHint>
                {stale ? "A148 ligger kvar" : "Ändring kräver nytt paket"}
              </CorrectionFooterHint>
            </>
          }
          breadcrumb={
            <CorrectionBreadcrumb
              segments={[
                <Link href="#books">Bokföring</Link>,
                "Verifikat",
                "A148",
                stale ? "Rättelsepaket R-0007" : "Granska rättelsepaket",
              ]}
            />
          }
          actions={
            <Button
              fullWidth
              onClick={() => {
                throw new Error("Visual fixtures cannot issue financial commands");
              }}
            >
              {stale ? "Be Sara förbereda om rättelsen" : "Godkänn hela rättelsen"}
            </Button>
          }
          details={null}
        />
      )}
    </Workspace>
  </div>,
);
