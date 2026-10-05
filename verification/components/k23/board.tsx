import { useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@open-erp/ui/components/button";
import { Input } from "@open-erp/ui/components/input";
import {
  CheckboxControl,
  DecisionCard,
  SwitchControl,
} from "@open-erp/ui/components/selection-controls";
import { SemanticNote, WorkflowStatusLabel } from "@open-erp/ui/components/semantic-note";
import { Link } from "@open-erp/ui/components/link";
import { RegisterNavigation, RegisterRowSurface } from "@open-erp/ui/components/register-workspace";
import { SettingsNavigationItem } from "@open-erp/ui/components/settings-workspace";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { tokens } from "../../../packages/ui/src/theme/tokens.stylex";
import "@open-erp/ui/globals.css";

const styles = stylex.create({
  board: {
    width: 1440,
    height: 1080,
    backgroundColor: tokens.card,
    color: tokens.foreground,
    fontFamily: tokens.fontSans,
    fontSynthesis: "none",
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight16Px,
    overflow: "clip",
    WebkitFontSmoothing: "antialiased",
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space7,
    paddingBlock: tokens.space7,
    paddingInline: 40,
  },
  subtitle: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
    marginBlockStart: tokens.space1,
  },
  row: { display: "flex", gap: tokens.space12 },
  column: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.space2_5,
    width: 600,
    flexShrink: 0,
  },
  right: { flex: "1 1 0", width: "auto" },
  tight: { gap: tokens.space2 },
  note: {
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeXs,
    lineHeight: tokens.lineHeight18Px,
  },
  metrics: {
    display: "flex",
    alignItems: "end",
    gap: tokens.space8,
    marginBlockStart: tokens.space1_5,
  },
  notes: { display: "flex", flexDirection: "column", gap: tokens.space1_5 },
  controls: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: tokens.space2 },
  ghostPreview: { backgroundColor: tokens.ghostHoverBackground },
  explanation: { color: tokens.mutedForeground, fontSize: tokens.fontSizeXs },
  navigationCopy: { fontSize: tokens.fontSizeControl },
  field: { display: "flex", alignItems: "center", gap: tokens.space3 },
  fieldError: { alignItems: "start" },
  fieldLabel: {
    width: 110,
    flexShrink: 0,
    color: tokens.mutedForeground,
    fontSize: tokens.fontSizeControl,
  },
  errorLabel: { paddingBlockStart: tokens.space1_5 },
  input: { width: 200, flexShrink: 0 },
  focusPreview: {
    borderColor: tokens.primary,
    borderWidth: 2,
    paddingInline: 9,
    boxShadow: "none",
  },
  error: { color: tokens.destructive, marginBlockStart: tokens.space0_5 },
  inplace: {
    fontSize: tokens.fontSizeControl,
    borderBlockEndWidth: 1,
    borderBlockEndStyle: "dashed",
    borderBlockEndColor: tokens.registerDraft,
    paddingBlockEnd: 1,
    cursor: "pointer",
    ":focus-visible": { outline: "2px solid var(--primary)", outlineOffset: 2 },
  },
  choices: { display: "flex", gap: tokens.space5, alignItems: "center" },
  decisions: { display: "grid", gridTemplateColumns: "280px 280px", gap: tokens.space2_5 },
  selection: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: tokens.radiusControl,
    overflow: "clip",
  },
  hoverPreview: { backgroundColor: tokens.sidebar },
  focusRow: { display: "flex", alignItems: "center", height: 34, paddingInline: tokens.space3 },
  focusControlPreview: { outline: "2px solid var(--primary)", outlineOffset: 2, boxShadow: "none" },
  statuses: { display: "flex", flexWrap: "wrap", columnGap: 18, rowGap: 0 },
  breadcrumbs: { display: "flex", gap: tokens.space2 },
  crumb: { textDecoration: "none" },
  sideNavigation: { display: "flex", flexDirection: "column", gap: tokens.space0_5, width: 200 },
});

function Group({ children }: { children: ReactNode }) {
  return <Text variant="group">{children}</Text>;
}

function Field({
  label,
  id,
  children,
  error = false,
}: {
  label: string;
  id: string;
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div {...stylex.props(styles.field, error && styles.fieldError)}>
      <label htmlFor={id} {...stylex.props(styles.fieldLabel, error && styles.errorLabel)}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ComponentBoard() {
  const previews = !new URLSearchParams(window.location.search).has("natural");

  const [off, setOff] = useState(false);

  const [marked, setMarked] = useState(true);

  const [switchOn, setSwitchOn] = useState(true);

  const [switchOff, setSwitchOff] = useState(false);

  const [decision, setDecision] = useState("retain");

  return (
    <main id="component-board" {...stylex.props(styles.board)}>
      <div {...stylex.props(styles.content)}>
        <header>
          <Heading level={1} size="large">
            Komponenter, version 2
          </Heading>
          <p {...stylex.props(styles.subtitle)}>
            Gäller hela specifikationen. Ingen text är ljusare än #64748B. Statisk design, inte
            verifierad i körning.
          </p>
        </header>
        <div {...stylex.props(styles.row)}>
          <section {...stylex.props(styles.column)}>
            <Group>HIERARKI</Group>
            <Heading level={1} size="page">
              Sidtitel, 16 px 600
            </Heading>
            <Heading size="section">Sektionsrubrik i meningsfall, 14 px 600</Heading>
            <Text variant="control" tone="caption">
              Brödtext 13 px, sekundär text #475569, bildtext #64748B (lägsta tillåtna)
            </Text>
            <Group>GRUPPETIKETT, ENDAST FÖR RIKTIGA GRUPPER</Group>
            <div {...stylex.props(styles.metrics)}>
              <div>
                <Text tone="metric" variant="metricLarge">
                  54 608,00
                </Text>
                <Text variant="caption">Nyckeltal stort, 32 px</Text>
              </div>
              <div>
                <Text tone="metric" variant="metricMedium">
                  191 200,00
                </Text>
                <Text variant="caption">Medel, 20 px</Text>
              </div>
              <div>
                <Text tone="metric" variant="metricSmall">
                  38 990,00
                </Text>
                <Text variant="caption">Litet, 14 px</Text>
              </div>
            </div>
          </section>
          <section {...stylex.props(styles.column, styles.right)}>
            <Group>SEMANTISK FÄRG</Group>
            <div {...stylex.props(styles.notes)}>
              <SemanticNote tone="info">
                Information: neutral eller blå. Vanliga ändringar och förklaringar.
              </SemanticNote>
              <SemanticNote tone="warning">Kräver åtgärd: gul. Något väntar på dig.</SemanticNote>
              <SemanticNote tone="error">
                Fel: spärrad eller misslyckad. Orsak och nästa steg står här.
              </SemanticNote>
              <SemanticNote tone="success">Klart: grön. Bara för slutförda saker.</SemanticNote>
            </div>
            <p {...stylex.props(styles.note)}>
              Negativa belopp är svarta med minustecken. Röd används för förfallet, spärrat och fel.
              Status bärs alltid av ord eller form, aldrig bara färg.
            </p>
          </section>
        </div>
        <div {...stylex.props(styles.row)}>
          <section {...stylex.props(styles.column)}>
            <Group>KNAPPAR OCH LÄNKAR</Group>
            <div {...stylex.props(styles.controls)}>
              <Button static>Primär</Button>
              <Button static variant="outline">
                Sekundär
              </Button>
              <Button static variant="ghost" styleX={previews ? styles.ghostPreview : undefined}>
                Ghost, hovrad
              </Button>
              <Button static variant="destructive-outline">
                Ta bort
              </Button>
              <Button static variant="destructive">
                Bekräfta borttagning
              </Button>
            </div>
            <div {...stylex.props(styles.controls)}>
              <Button disabled>Spara ändringar</Button>
              <p {...stylex.props(styles.explanation)}>
                Inaktiv primär knapp, orsaken står bredvid: ingenting är ändrat.
              </p>
            </div>
            <p {...stylex.props(styles.navigationCopy)}>
              Länk för navigation: <Link href="#invoice">Öppna fakturan</Link>. Handling som ändrar
              något är alltid en knapp, aldrig en länk.
            </p>
          </section>
          <section {...stylex.props(styles.column, styles.right, styles.tight)}>
            <Group>FÄLT</Group>
            <Field label="Redigerbart" id="editable">
              <Input id="editable" defaultValue="30 dagar" styleX={styles.input} />
            </Field>
            <Field label="Fokus" id="focus">
              <Input
                id="focus"
                defaultValue="30 dagar"
                styleX={[styles.input, previews && styles.focusPreview]}
              />
            </Field>
            <Field label="Skrivskyddat" id="readonly">
              <Input id="readonly" value="Från kunden" readOnly styleX={styles.input} />
            </Field>
            <Field label="Inaktivt" id="disabled">
              <Input id="disabled" value="Välj kund först" disabled styleX={styles.input} />
            </Field>
            <Field label="Redigera på plats" id="inplace">
              <button id="inplace" type="button" {...stylex.props(styles.inplace)}>
                3 okt 2026
              </button>
            </Field>
            <Field label="Fel" id="invalid" error>
              <div>
                <Input
                  id="invalid"
                  defaultValue="abc"
                  aria-invalid="true"
                  aria-describedby="amount-error"
                  styleX={styles.input}
                />
                <p id="amount-error" {...stylex.props(styles.error)}>
                  Fel: ange ett belopp i siffror.
                </p>
              </div>
            </Field>
          </section>
        </div>
        <div {...stylex.props(styles.row)}>
          <section {...stylex.props(styles.column)}>
            <Group>VAL</Group>
            <div {...stylex.props(styles.choices)}>
              <CheckboxControl
                label="Av"
                checked={off}
                onChange={(event) => setOff(event.target.checked)}
              />
              <CheckboxControl
                label="Markerad"
                checked={marked}
                onChange={(event) => setMarked(event.target.checked)}
              />
              <SwitchControl label="På" checked={switchOn} onCheckedChange={setSwitchOn} />
              <SwitchControl label="Av" checked={switchOff} onCheckedChange={setSwitchOff} />
            </div>
            <div
              role="radiogroup"
              aria-label="Betalningsvillkor"
              {...stylex.props(styles.decisions)}
            >
              <DecisionCard
                name="terms"
                value="retain"
                title="Behåll 45 dagar"
                detail="Det du skrev in."
                checked={decision === "retain"}
                onChange={() => setDecision("retain")}
              />
              <DecisionCard
                name="terms"
                value="customer"
                title="Använd kundens 30 dagar"
                detail="Från kundregistret."
                checked={decision === "customer"}
                onChange={() => setDecision("customer")}
              />
            </div>
            <p {...stylex.props(styles.explanation)}>
              Valt beslutskort: 2 px blå kant och fylld radio. Inställningar som ändras direkt
              använder reglage. Oföränderliga regler visas som skrivskyddade rader med texten Kan
              inte ändras.
            </p>
          </section>
          <section {...stylex.props(styles.column, styles.right, styles.tight)}>
            <Group>URVAL, HOVER OCH FOKUS</Group>
            <div {...stylex.props(styles.selection)}>
              <RegisterRowSurface density="compact">Normal rad</RegisterRowSurface>
              <RegisterRowSurface
                density="compact"
                styleX={previews ? styles.hoverPreview : undefined}
              >
                Hovrad rad, bara ljus fyllnad
              </RegisterRowSurface>
              <RegisterRowSurface density="compact" selected>
                Vald rad, vänsterkant och fetare text
              </RegisterRowSurface>
              <div {...stylex.props(styles.focusRow)}>
                <RegisterRowSurface
                  density="compact"
                  presentation="inline"
                  styleX={previews ? styles.focusControlPreview : undefined}
                >
                  Fokus: ram runt kontrollen, ingen fyllnad
                </RegisterRowSurface>
              </div>
            </div>
          </section>
        </div>
        <div {...stylex.props(styles.row)}>
          <section {...stylex.props(styles.column)}>
            <Group>STATUSMARKÖRER OCH MÖNSTER</Group>
            <div {...stylex.props(styles.statuses)}>
              <WorkflowStatusLabel status="draft">Utkast</WorkflowStatusLabel>
              <WorkflowStatusLabel status="review">Väntar på granskning</WorkflowStatusLabel>
              <WorkflowStatusLabel status="action">Kräver åtgärd</WorkflowStatusLabel>
              <WorkflowStatusLabel status="blocked">Spärrad</WorkflowStatusLabel>
              <WorkflowStatusLabel status="completed">Klart</WorkflowStatusLabel>
              <WorkflowStatusLabel status="unknown">Okänt utfall</WorkflowStatusLabel>
            </div>
            <SemanticNote tone="warning">
              Okänt utfall. Det går inte att säga om det skickades. Skicka inte igen innan
              utredningen är registrerad.
            </SemanticNote>
            <SemanticNote tone="error">
              Fel: sparningen misslyckades. Inget är ändrat. Försök igen.
            </SemanticNote>
          </section>
          <section {...stylex.props(styles.column, styles.right, styles.tight)}>
            <Group>NAVIGATION</Group>
            <RegisterNavigation
              label="Försäljning"
              density="compact"
              options={[
                { label: "Fakturor", href: "#invoices", active: false },
                { label: "Offerter och order", href: "#orders", active: true },
                { label: "Kunder", href: "#customers", active: false },
              ]}
            />
            <nav aria-label="Brödsmulor" {...stylex.props(styles.breadcrumbs)}>
              <Text as="span" variant="control" tone="muted">
                <Link href="#reports" {...stylex.props(styles.crumb)}>
                  Rapporter
                </Link>
              </Text>
              <Text as="span" variant="control" tone="caption">
                /
              </Text>
              <Text as="span" variant="control" tone="muted">
                <Link href="#cashflow" {...stylex.props(styles.crumb)}>
                  Kassaflöde
                </Link>
              </Text>
              <Text as="span" variant="control" tone="caption">
                /
              </Text>
              <Text as="span" variant="control" weight="semibold" aria-current="page">
                Underlag
              </Text>
            </nav>
            <nav aria-label="Inställningar" {...stylex.props(styles.sideNavigation)}>
              <SettingsNavigationItem href="#company">Företag</SettingsNavigationItem>
              <SettingsNavigationItem href="#integrations" active>
                Integrationer
              </SettingsNavigationItem>
              <SettingsNavigationItem href="#backups">Säkerhetskopior</SettingsNavigationItem>
            </nav>
            <p {...stylex.props(styles.explanation)}>
              Överlägg och dialoger lägger en 22 % mörk skärm över den synliga sidan bakom, aldrig
              över en tom yta.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

const root = document.getElementById("root");

if (!root) throw new Error("Component board root is missing");

createRoot(root).render(<ComponentBoard />);
