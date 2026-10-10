import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { importReadiness, missingSourceAccounts } from "./import-readiness";
import * as Match from "effect/Match";
import {
  ImportBatchesDialog,
  ImportPrimaryAction,
  ImportPauseAction,
  InitialImportStatus,
  useInitialImport,
} from "./import-actions";
import { currentSnapshot, hasDecision } from "./lifecycle";
import * as Mapping from "@open-erp/contracts/onboarding-mappings";
import {
  SetupBlock,
  SetupRadio,
  SetupText,
  setupLayoutStyles,
} from "@open-erp/ui/components/setup-parts";
import { useState } from "react";
import * as Schema from "effect/Schema";
import * as Sie from "@open-erp/contracts/sie-import";
import { SelectControl } from "@open-erp/ui/components/select";
import {
  SetupButton,
  SetupCaption,
  SetupContent,
  SetupPageContent,
  SetupTitle,
} from "@open-erp/ui/components/setup-workspace";
import { SetupTable } from "@open-erp/ui/components/setup-table";
import { tokens } from "@open-erp/ui/theme/tokens.stylex";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookPath } from "@/lib/accounting-api";
import { formatDate, formatMinor, useOnboardingCommand } from "./data";
import { type Lifecycle, type Workspace } from "./lifecycle";
import { Breadcrumb, PendingRead, SetupLink, type OpenOnboardingView } from "./shared";
import { useSieSource } from "./sources";

export function OnboardingImport({
  workspace,
  lifecycle,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sie = useSieSource(workspace);
  const initial = useInitialImport(workspace, lifecycle, open);
  const [importing, setImporting] = useState(false);

  const openingAccepted = hasDecision(
    lifecycle,
    currentSnapshot(lifecycle, "opening"),
    "accept_opening",
  );

  const run = workspace.imports.find((item) => item.sourcePlanId === sie.latest?.planId);

  const capture = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/source-occurrences/${encodeURIComponent(sie.source?.occurrence.id ?? "unselected")}/sie-previews`,
      execute: (client, requestOptions) =>
        client.sieImport.captureSieSource(
          httpRequest(
            Api.groups.sieImport.endpoints.captureSieSource,
            { params: { ...bookScope(book), id: sie.source?.occurrence.id ?? "unselected" } },
            requestOptions,
          ),
        ),
    },
    Schema.Struct({ encoding: Schema.Literals(["utf-8", "windows-1252", "ibm437"]) }),
    Sie.SiePreview,
  );

  const missingAccounts = missingSourceAccounts(sie.preview.data, setup.accounts).filter(
    (account) => !sie.mappings.data?.current.some((mapping) => mapping.sourceAccount === account),
  );

  const importReview = lifecycle.controls
    .filter((control) => control.importReview?.previewId === sie.preview.data?.id)
    .toSorted(
      (left, right) =>
        right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
    )[0]?.importReview;

  const findings = importReview?.findings.filter((finding) => finding.state === "pending") ?? [];
  const readiness = importReadiness(sie.preview.data, missingAccounts, findings);

  const diagnostics = sie.preview.data?.diagnostics ?? [];

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page", "inset", "importPage"])}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Import" }]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>Import av historik</SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["subtitle", "mappingSubtitle"]}>
        Tidigare bokföring{sie.source ? `, ${sie.source.occurrence.filename}` : ""}
        {workspace.case.configuration.dates.historyStartsOn &&
        workspace.case.configuration.dates.historyEndsOn
          ? `, ${formatDate(workspace.case.configuration.dates.historyStartsOn, false)} till ${formatDate(workspace.case.configuration.dates.historyEndsOn)}.`
          : "."}
      </SetupText>
      <PendingRead
        pending={
          !!sie.source &&
          (sie.inventory.isPending || (sie.latest !== undefined && sie.preview.isPending))
        }
        error={sie.inventory.error ?? sie.preview.error ?? sie.plan.error}
        retry={() => {
          void sie.inventory.refetch();
          void sie.preview.refetch();
        }}
      />
      <SetupBlock layout={["summary", "section24"]}>
        {[
          { value: readiness.total?.toString() ?? "—", label: "verifikat granskade" },
          { value: readiness.ready?.toString() ?? "—", label: "✓ klara" },
          { value: readiness.decisions?.toString() ?? "—", label: "! behöver beslut" },
        ].map((item) => (
          <SetupBlock key={item.label} layout={["statistic", "importStatistic"]}>
            <SetupText
              layout={[
                "statisticNumber",
                "importStatisticNumber",
                item.label === "✓ klara" && "success",
                item.label === "! behöver beslut" && "warning",
              ]}
            >
              {item.value}
            </SetupText>
            <SetupText
              layout={[
                Match.value(item.label).pipe(
                  Match.when("✓ klara", () => "success" as const),
                  Match.when("! behöver beslut", () => "warning" as const),
                  Match.orElse(() => "secondary" as const),
                ),
              ]}
            >
              {item.label}
            </SetupText>
          </SetupBlock>
        ))}
      </SetupBlock>
      <SetupText as="h2" layout={["dialogHeading", "section28"]}>
        Undantag att lösa
      </SetupText>
      <SetupBlock layout={["controls", "tableSpace"]}>
        {missingAccounts.map((account) => {
          const occurrences =
            sie.preview.data?.vouchers.flatMap((voucher) =>
              voucher.transactions.filter((item) => item.account === account),
            ).length ?? 0;

          return (
            <SetupBlock key={account} layout={["controlRow", "importRow"]}>
              <SetupBlock layout={["stack4", "importLabel"]}>
                <SetupText layout={["semibold"]}>
                  {sie.preview.data?.vouchers.filter((voucher) =>
                    voucher.transactions.some((line) => line.account === account),
                  ).length ?? 0}{" "}
                  behöver kontomappning
                </SetupText>
                <SetupText layout={["warning", "caption"]}>! Behöver åtgärd</SetupText>
              </SetupBlock>
              <SetupText layout={["importDetail"]}>
                {sie.preview.data?.vouchers.filter((voucher) =>
                  voucher.transactions.some((line) => line.account === account),
                ).length ?? 0}{" "}
                verifikat behöver beslut. Konto {account} finns i {occurrences} rader totalt.
              </SetupText>
              <SetupLink onClick={() => open("mapping")}>
                Konto {account} i {occurrences} poster
              </SetupLink>
            </SetupBlock>
          );
        })}
        {findings.map((finding) => (
          <SetupBlock
            key={`${finding.kind}-${finding.voucherOrdinal}`}
            layout={["controlRow", "importRow"]}
          >
            <SetupBlock layout={["stack4", "importLabel"]}>
              <SetupText layout={["semibold"]}>
                {finding.kind === "duplicate_candidate" ? "1 dubblettkandidat" : "1 stöds inte"}
              </SetupText>
              <SetupText
                layout={["caption", finding.kind === "duplicate_candidate" ? "warning" : "blocked"]}
              >
                {finding.kind === "duplicate_candidate" ? "! Behöver åtgärd" : "Blockerad"}
              </SetupText>
            </SetupBlock>
            <SetupText layout={["importDetail"]}>
              {finding.kind === "duplicate_candidate"
                ? `${finding.counterpartyName} faktura ${finding.documentNumber} finns redan.`
                : "Okänd valutakod blockerar. Källan måste rättas före godkännande."}
            </SetupText>
            <SetupLink onClick={() => open("sources")}>
              {finding.kind === "duplicate_candidate" ? "Jämför de två" : "Visa posten"}
            </SetupLink>
          </SetupBlock>
        ))}
        {diagnostics.map((item, index) => (
          <SetupBlock key={`${item.code}-${item.line}-${index}`} layout={["controlRow"]}>
            <SetupBlock layout={["stack4"]}>
              <SetupText>{item.code}</SetupText>
              <SetupText layout={["warning"]}>
                {item.severity === "error" ? "Blockerad" : "! Behöver åtgärd"}
              </SetupText>
            </SetupBlock>
            <SetupText layout={["secondary"]}>{item.message}</SetupText>
            <SetupLink onClick={() => open("sources")}>Visa posten</SetupLink>
          </SetupBlock>
        ))}
      </SetupBlock>
      <SetupBlock layout={["section28", "actions8"]}>
        <ImportPrimaryAction
          previewReady={!!sie.preview.data}
          decisions={readiness.decisions}
          run={run}
          openingAccepted={openingAccepted}
          initial={initial}
          open={open}
          continueImport={() => setImporting(true)}
        />
        <ImportPauseAction run={run} open={open} />
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          {run?.financialState === "posted"
            ? "Historiken är inlagd. Drastic blir gällande först efter bekräftad övergång."
            : "Inget har gjorts gällande. Ingenting bokförs förrän du godkänner öppningsläget."}
        </SetupCaption>
      </SetupBlock>
      {!sie.source ? (
        <SetupLink onClick={() => open("sources")}>Ladda upp tidigare bokföring</SetupLink>
      ) : !sie.latest ? (
        <SetupButton
          disabled={capture.disabled}
          onClick={() =>
            capture.mutate(
              capture.uncertain && capture.variables ? capture.variables : { encoding: "utf-8" },
            )
          }
        >
          Granska importfilen
        </SetupButton>
      ) : null}
      <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
      <InitialImportStatus initial={initial} />
      {importing && run?.financialRunId ? (
        <ImportBatchesDialog
          financialRunId={run.financialRunId}
          lifecycle={lifecycle}
          close={() => setImporting(false)}
          open={open}
        />
      ) : null}
    </SetupPageContent>
  );
}

export function sourceAmount(amount: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);

  if (!match) return amount;
  const sign = match[1] === "-" ? -1n : 1n;

  return formatMinor(
    (sign * (BigInt(match[2] ?? "0") * 100n + BigInt((match[3] ?? "").padEnd(2, "0")))).toString(),
  );
}

function mappingDate(value: string | undefined) {
  return formatDate(
    value ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null,
    false,
  );
}

function mappingRows(preview: typeof Sie.SiePreview.Type | undefined, account: string | undefined) {
  return (
    preview?.vouchers.flatMap((voucher) =>
      voucher.transactions
        .filter((line) => line.account === account)
        .map((line) => ({ voucher, line })),
    ) ?? []
  );
}

function useMappingSelection(workspace: Workspace, open: OpenOnboardingView) {
  const { book, setup, locale } = useBookWorkspace();
  const sie = useSieSource(workspace);
  const [selected, setSelected] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [remember, setRemember] = useState(false);

  const missing = missingSourceAccounts(sie.preview.data, setup.accounts);

  const account =
    missing.find(
      (code) => !sie.mappings.data?.current.some((entry) => entry.sourceAccount === code),
    ) ??
    missing[0] ??
    sie.plan.data?.input.mappings.find(
      (mapping) => !setup.accounts.some((item) => item.code === mapping.sourceAccount),
    )?.sourceAccount;

  const rows = mappingRows(sie.preview.data, account);

  const saved = sie.mappings.data?.history.find((entry) => entry.sourceAccount === account);

  const currentChoice = sie.mappings.data?.current.find(
    (entry) => entry.sourceAccount === account,
  )?.accountId;

  const proposed = sie.mappings.data?.proposedDefaults.find(
    (entry) => entry.sourceAccount === account,
  )?.accountId;

  const choice = selected || currentChoice || proposed || "";

  const map = useOnboardingCommand(
    {
      identity: `${bookPath(book)}/onboarding/account-mappings`,
      execute: (client, requestOptions) =>
        client.onboardingMappings.saveOnboardingMapping(
          httpRequest(
            Api.groups.onboardingMappings.endpoints.saveOnboardingMapping,
            { params: { ...bookScope(book) } },
            requestOptions,
          ),
        ),
    },
    Mapping.SaveOnboardingMapping,
    Mapping.OnboardingMapping,
    () => open("import"),
  );

  const canSave =
    !!sie.preview.data && !!account && !!choice && !sie.plan.data && !!sie.mappings.data;

  return {
    setup,
    locale,
    sie,
    account,
    rows,
    choice,
    setSelected,
    remember,
    setRemember,
    map,
    canSave,
    saved,
    showAll,
    setShowAll,
  };
}

export function OnboardingMapping({
  workspace,
  open,
}: {
  workspace: Workspace;
  lifecycle: Lifecycle;
  open: OpenOnboardingView;
}) {
  const model = useMappingSelection(workspace, open);

  return (
    <SetupContent
      styleX={setupLayoutStyles(["mappingPage", "focused"])}
      onSubmit={(event) => {
        event.preventDefault();

        if (model.map.disabled || !model.canSave || !model.sie.preview.data || !model.account)
          return;
        model.map.mutate(
          model.map.uncertain && model.map.variables
            ? model.map.variables
            : {
                previewId: model.sie.preview.data.id,
                expectedPreviewDigest: model.sie.preview.data.digest,
                sourceAccount: model.account,
                accountId: model.choice,
                remember: model.remember,
                expectedRevision: model.saved?.revision ?? 0,
              },
        );
      }}
    >
      <Breadcrumb
        items={[
          { label: "Setup", view: "workspace" },
          { label: "Import", view: "import" },
          { label: model.account ? `Konto ${model.account}` : "Kontomappning" },
        ]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>
          {model.account ? `Konto ${model.account} saknas i kontoplanen` : "Kontomappning"}
        </SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["mappingSubtitle"]}>
        Förekommer i {model.rows.length} poster
        {model.rows.length
          ? `, från ${mappingDate(model.rows[0]?.voucher.date)} till ${mappingDate(model.rows.at(-1)?.voucher.date)}`
          : ""}
        .
      </SetupText>
      <PendingRead
        pending={
          (!!model.sie.source && model.sie.inventory.isPending) ||
          (!!model.sie.latest && model.sie.preview.isPending)
        }
        error={model.sie.inventory.error ?? model.sie.preview.error}
        retry={() => {
          void model.sie.inventory.refetch();
        }}
      />
      <SetupBlock as="label" id="mapping-label" layout={["section28", "medium"]}>
        Mappa alla förekomster till
      </SetupBlock>
      <SetupBlock layout={["mappingField"]}>
        <SelectControl
          aria-labelledby="mapping-label"
          value={model.choice}
          options={model.setup.accounts
            .filter((item) => item.active)
            .map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))}
          onValueChange={(value) => model.setSelected(value ?? "")}
          disabled={model.map.disabled || model.map.uncertain || !!model.sie.plan.data}
          placeholder="Välj konto"
          styleX={setupLayoutStyles(["select"])}
        />
      </SetupBlock>
      <SetupBlock layout={["mappingHint"]}>
        <SetupCaption>
          {model.sie.mappings.data?.proposedDefaults.some(
            (entry) => entry.sourceAccount === model.account && entry.accountId === model.choice,
          )
            ? "Förslag från Drastic. Du bestämmer."
            : "Du bestämmer."}
        </SetupCaption>
      </SetupBlock>
      <SetupText as="h2" layout={["mappingHeading"]}>
        Så här ser det ut, {model.showAll ? model.rows.length : Math.min(3, model.rows.length)} av{" "}
        {model.rows.length} poster
      </SetupText>
      <SetupBlock layout={["tableSpace"]}>
        <SetupTable
          title="Mappningsförhandsgranskning"
          width={tokens.setupFocusedWidth}
          density="compact"
          columns={[
            { id: "date", label: "Datum", width: tokens.setupColumn96 },
            { id: "voucher", label: "Verifikat", width: tokens.setupColumn96 },
            { id: "text", label: "Text", width: tokens.setupMappingTextWidth },
            { id: "amount", label: "Belopp", width: tokens.setupColumn120, numeric: true },
          ]}
          rows={(model.showAll ? model.rows : model.rows.slice(0, 3)).map(
            ({ voucher, line }, index) => ({
              id: `${voucher.ordinal}-${line.recordOrdinal}-${index}`,
              cells: [
                mappingDate(voucher.date),
                `${voucher.series}${voucher.number}`,
                model.sie.preview.data?.records.find(
                  (record) => record.ordinal === voucher.recordOrdinal,
                )?.fields[3] ?? "",
                sourceAmount(line.amount),
              ],
            }),
          )}
        />
      </SetupBlock>
      <SetupBlock layout={["section20", "radioOption"]}>
        <SetupRadio
          type="checkbox"
          aria-label="Kom ihåg valet för nästa import från samma källa"
          checked={model.remember}
          onChange={(event) => model.setRemember(event.target.checked)}
          disabled={model.map.disabled || model.map.uncertain}
        />
        <SetupText>Kom ihåg valet för nästa import från samma källa</SetupText>
      </SetupBlock>
      <SetupBlock layout={["section24", "actions8"]}>
        <SetupButton
          type="submit"
          disabled={model.map.disabled || (!model.map.uncertain && !model.canSave)}
        >
          Mappa alla {model.rows.length}
        </SetupButton>
        <SetupButton
          type="button"
          variant="outline"
          onClick={() => model.setShowAll((value) => !value)}
        >
          {model.showAll ? "Visa färre poster" : "Visa alla poster"}
        </SetupButton>
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          Valet sparas med ditt namn och kan ändras. Ingen post bokförs om.
        </SetupCaption>
      </SetupBlock>
      {!model.canSave ? (
        <SetupText as="p" role="status">
          {model.sie.plan.data
            ? "Importplanen är redan sparad. En ny granskning krävs för att ändra mappningen."
            : "Välj ett konto för att spara mappningen."}
        </SetupText>
      ) : null}
      <AccountingStatus
        locale={model.locale}
        pending={model.map.isPending}
        error={model.map.error}
        write
      />
    </SetupContent>
  );
}
