import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import * as Schema from "effect/Schema";

import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { Action, InlineAction } from "@open-erp/ui/kanon/action";
import { CompareCard, FactCard, LedgerCard } from "@open-erp/ui/kanon/cards";
import { DetailPanel, PanelSection } from "@open-erp/ui/kanon/detail-panel";
import { Banner, CheckRow } from "@open-erp/ui/kanon/feedback";
import {
  AreaBar,
  BarTab,
  DetailBar,
  FocusPage,
  ListDetailPage,
  OriginalViewer,
  QueueItem,
  ReviewPage,
  ReviewQueue,
} from "@open-erp/ui/kanon/layouts";
import { ConfirmDialog, Drawer, Toaster, useNotify } from "@open-erp/ui/kanon/overlays";
import { ActivityList, EvidenceFile } from "@open-erp/ui/kanon/record";
import { StatusLabel } from "@open-erp/ui/kanon/status";
import { WorkGroup, WorkList, WorkRow } from "@open-erp/ui/kanon/work-list";

/** Reference compositions of page 00 Kanon, built only from @open-erp/ui/kanon parts. */
export const Route = createFileRoute("/kanon/$screen")({
  validateSearch: Schema.decodeUnknownSync(
    Schema.Struct({ screen: Schema.optional(Schema.Literals(["list", "review", "focus"])) }),
  ),
  component: KanonReference,
});

function KanonReference() {
  const screen = Route.useParams().screen;

  return (
    <Toaster>
      <Box height="full" minHeight="screen" display="flex" flexDirection="column">
        {screen === "list" && <ListScreen />}
        {screen === "review" && <ReviewScreen />}
        {screen === "focus" && <FocusScreen />}
      </Box>
    </Toaster>
  );
}

function ListScreen() {
  const [selected, setSelected] = useState("1048");

  return (
    <ListDetailPage
      bar={
        <AreaBar
          title="Att göra"
          tabs={
            <>
              <BarTab
                label="Väntar på dig"
                count={5}
                active
                render={<Link to="/kanon/$screen" params={{ screen: "list" }} />}
              />
              <BarTab
                label="Bevakas"
                count={3}
                active={false}
                render={<Link to="/kanon/$screen" params={{ screen: "review" }} />}
              />
              <BarTab
                label="Klart"
                active={false}
                render={<Link to="/kanon/$screen" params={{ screen: "focus" }} />}
              />
            </>
          }
          action={
            <Action kind="secondary" compact>
              Granska alla
            </Action>
          }
        />
      }
      list={
        <WorkList>
          <WorkGroup title="Granska och godkänn" count={3} first>
            <WorkRow
              status="proposal"
              title="Nordhamn Studio AB, faktura 1048"
              state="Förslag"
              amount="12 500,00"
              selected={selected === "1048"}
              onSelect={() => setSelected("1048")}
            />
            <WorkRow
              status="needsYou"
              title="Vinter & Co AB, faktura 882"
              state="Momsen är otydlig"
              amount="2 490,00"
              selected={selected === "882"}
              onSelect={() => setSelected("882")}
            />
            <WorkRow
              status="unread"
              title="Skannad_bild_0931.jpg"
              state="Typ saknas"
              selected={selected === "0931"}
              onSelect={() => setSelected("0931")}
            />
          </WorkGroup>
          <WorkGroup title="Bank" count={1}>
            <WorkRow
              status="needsYou"
              title="Utbetalning 28 sep"
              state="Saknar underlag"
              amount="−8 750,00"
              onSelect={() => setSelected("bank")}
              selected={selected === "bank"}
            />
          </WorkGroup>
          <WorkGroup title="Klart i dag" count={1}>
            <WorkRow
              status="done"
              title="Tryckhuset Norr AB, faktura 5521"
              detail="Godkänd av Elin Sund 2 okt 09:13"
              state="Bokförd A153"
              amount="3 150,00"
              onSelect={() => setSelected("5521")}
              selected={selected === "5521"}
            />
          </WorkGroup>
        </WorkList>
      }
      panel={
        <DetailPanel
          label="Förslag"
          kicker="Leverantörsfaktura, förslag av Sara Lind"
          figure="12 500,00"
          subtitle="Nordhamn Studio AB, faktura 1048. Förfaller i dag."
          primary={
            <Action kind="primary" fill>
              Granska och godkänn
            </Action>
          }
          secondary={
            <>
              <Action kind="secondary" fill>
                Hoppa över
              </Action>
              <Action kind="quiet" fill>
                Visa i Dokument
              </Action>
            </>
          }
        >
          <EvidenceFile
            name="1048_nordhamn.pdf"
            detail="Original, 1 sida"
            action={<InlineAction>Öppna</InlineAction>}
          />
          <PanelSection label="Föreslagen bokföring">
            <LedgerCard
              lines={[
                { account: "6550 Konsultarvoden", debit: "10 000,00" },
                { account: "2641 Ingående moms", debit: "2 500,00" },
                { account: "2440 Leverantörsskulder", credit: "12 500,00" },
              ]}
            />
            <CheckRow result="done">Beloppen stämmer med originalet</CheckRow>
          </PanelSection>
          <PanelSection label="Aktivitet">
            <ActivityList
              events={[
                {
                  id: "read",
                  initials: "A",
                  actor: "agent",
                  text: "Avläst och föreslagen",
                  time: "1 okt 14:21",
                },
                {
                  id: "upload",
                  initials: "SL",
                  actor: "person",
                  text: "Uppladdat av Sara Lind",
                  time: "1 okt 14:20",
                },
              ]}
            />
          </PanelSection>
        </DetailPanel>
      }
    />
  );
}

function ReviewScreen() {
  const [selected, setSelected] = useState("kontor");

  return (
    <ReviewPage
      bar={
        <DetailBar
          crumbs={[
            { label: "Bank", render: <Link to="/kanon/$screen" params={{ screen: "list" }} /> },
          ]}
          current="Granska matchning, 3 okt"
        />
      }
      queue={
        <ReviewQueue title="Att matcha" count={3}>
          <QueueItem
            status="proposal"
            name="Exempel Kontorsservice"
            meta="−1 250,00"
            selected={selected === "kontor"}
            onSelect={() => setSelected("kontor")}
          />
          <QueueItem
            status="needsYou"
            name="BG Bergvik Bygg"
            meta="Inget underlag"
            selected={selected === "bergvik"}
            onSelect={() => setSelected("bergvik")}
          />
          <QueueItem
            status="proposal"
            name="Swish Lindqvist"
            meta="2 förslag"
            selected={selected === "swish"}
            onSelect={() => setSelected("swish")}
          />
        </ReviewQueue>
      }
      original={
        <OriginalViewer>
          <Box padding="2xl" display="flex" flexDirection="column" gap="lg">
            <Text>Exempel Kontorsservice AB</Text>
            <Text tone="caption">Kvitto DEMO-2026-0037, 3 okt 2026, totalt 1 250,00 SEK</Text>
          </Box>
        </OriginalViewer>
      }
      panel={
        <DetailPanel
          label="Föreslagen matchning"
          kicker="Utbetalning från 1930, manuellt kontoutdrag"
          figure="−1 250,00"
          subtitle="BG EXEMPEL KONTORSSERVICE, 3 okt."
          note="Förberedelsen bokför inget. Den godkänns separat."
          primary={
            <Action kind="primary" fill>
              Förbered matchning
            </Action>
          }
          secondary={
            <Action kind="quiet" fill>
              Lämna i granskning
            </Action>
          }
        >
          <PanelSection
            label="Varför förslaget visas"
            action={<InlineAction>Välj annat underlag</InlineAction>}
          >
            <CompareCard
              leftTitle="Bankrad"
              rightTitle="Underlag"
              rows={[
                { label: "Belopp", left: "1 250,00", right: "1 250,00", matches: true },
                { label: "Datum", left: "3 okt", right: "3 okt", matches: true },
                {
                  label: "Mottagare",
                  left: "BG EXEMPEL KONTORSSERVICE",
                  right: "Exempel Kontorsservice AB",
                  matches: true,
                },
                { label: "Referens", right: "DEMO-0037", matches: false },
              ]}
            />
          </PanelSection>
        </DetailPanel>
      }
    />
  );
}

function FocusScreen() {
  const [confirming, setConfirming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const notify = useNotify();

  return (
    <FocusPage
      bar={
        <AreaBar
          title="Komponenter"
          action={
            <Action kind="secondary" compact onClick={() => setDrawerOpen(true)}>
              Inställningar
            </Action>
          }
        />
      }
    >
      <PanelSection label="Status">
        <Box display="flex" flexWrap="wrap" gap="xl">
          <StatusLabel status="proposal">Förslag</StatusLabel>
          <StatusLabel status="needsYou">Behöver dig</StatusLabel>
          <StatusLabel status="replied">Svar kom</StatusLabel>
          <StatusLabel status="unread">Ej läst</StatusLabel>
          <StatusLabel status="watching">Bevakas</StatusLabel>
          <StatusLabel status="overdue">Förfallen</StatusLabel>
          <StatusLabel status="unknown">Okänt utfall</StatusLabel>
          <StatusLabel status="done">Klart</StatusLabel>
        </Box>
      </PanelSection>
      <PanelSection label="Åtgärder">
        <Box display="flex" flexWrap="wrap" alignItems="center" gap="md">
          <Action kind="primary" onClick={() => setConfirming(true)}>
            Utfärda 18 750,00
          </Action>
          <Action kind="primary" blockedBy="Välj kund för att skicka">
            Skicka
          </Action>
          <Action
            kind="secondary"
            onClick={() =>
              notify("done", "Bokförd som A153", { label: "Öppna", onClick: () => undefined })
            }
          >
            Visa notis
          </Action>
          <Action kind="quiet">Hoppa över</Action>
          <Action kind="risky">Avvisa</Action>
        </Box>
      </PanelSection>
      <PanelSection label="Fakta och kontroller">
        <FactCard
          facts={[
            { label: "Fakturadatum", value: "2 sep 2026" },
            { label: "Förföll", value: "20 sep 2026", status: "overdue" },
            { label: "Betalt", value: "0,00 av 18 750,00" },
          ]}
        />
        <CheckRow result="done">Ingen inbetalning eller tvist hittad</CheckRow>
        <CheckRow result="needsYou">Vinter & Co AB saknar bekräftat bankgiro</CheckRow>
      </PanelSection>
      <PanelSection label="Besked">
        <Banner kind="unknown" title="Okänt utfall">
          Kontrollera om verifikationen skapades innan du godkänner igen.
        </Banner>
        <Banner kind="blocked" title="Godkännandet gäller inte längre">
          Beloppet ändrades 2 okt 09:20. Granska den nya versionen.
        </Banner>
      </PanelSection>
      <PanelSection label="Verifikation A153">
        <LedgerCard
          lines={[
            { account: "5930 Reklamtrycksaker", debit: "2 270,00" },
            { account: "5710 Frakter", debit: "250,00" },
            { account: "2641 Ingående moms", debit: "630,00" },
            { account: "2440 Leverantörsskulder", credit: "3 150,00" },
          ]}
          total={{ debit: "3 150,00", credit: "3 150,00" }}
        />
      </PanelSection>
      <WorkList carded>
        <WorkGroup title="Förfallna" count={1} first>
          <WorkRow
            status="overdue"
            reference="F-2026-0038"
            title="Björkdalen Skogsförvaltning AB"
            state="Förfallen 19 dagar"
            amount="18 750,00"
            onSelect={() => undefined}
          />
        </WorkGroup>
      </WorkList>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Utfärda faktura F-2026-0039?"
        description="Fakturan låses och får nummer. Den kan bara ändras med en kreditfaktura."
        facts={[
          { label: "Kund", value: "Björkdalen Skogsförvaltning AB" },
          { label: "Förfaller", value: "8 nov 2026" },
          { label: "Att betala", value: "18 750,00 SEK" },
        ]}
        confirmLabel="Utfärda 18 750,00"
        cancelLabel="Avbryt"
        onConfirm={() => setConfirming(false)}
      />
      <Drawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title="Fakturainställningar"
        footer={
          <>
            <Action kind="secondary" besidePrimary onClick={() => setDrawerOpen(false)}>
              Avbryt
            </Action>
            <Action kind="primary" onClick={() => setDrawerOpen(false)}>
              Spara inställningar
            </Action>
          </>
        }
      >
        <FactCard
          facts={[
            { label: "Betalningsvillkor", value: "30 dagar" },
            { label: "Dröjsmålsränta", value: "10,5 %" },
          ]}
        />
      </Drawer>
    </FocusPage>
  );
}
