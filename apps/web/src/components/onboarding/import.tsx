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

function missingSourceAccounts(
  preview: typeof Sie.SiePreview.Type | undefined,
  accounts: ReturnType<typeof useBookWorkspace>["setup"]["accounts"],
) {
  return [
    ...new Set(
      preview?.vouchers.flatMap((voucher) =>
        voucher.transactions
          .filter(
            (item) => !accounts.some((account) => account.active && account.code === item.account),
          )
          .map((item) => item.account),
      ) ?? [],
    ),
  ];
}

function importReadiness(
  preview: typeof Sie.SiePreview.Type | undefined,
  unresolvedAccounts: readonly string[],
) {
  if (!preview) return { total: null, ready: null, decisions: null };

  const affected = new Set(
    preview.vouchers
      .filter((voucher) =>
        voucher.transactions.some((line) => unresolvedAccounts.includes(line.account)),
      )
      .map((voucher) => voucher.ordinal),
  );

  for (const diagnostic of preview.diagnostics) {
    const record = preview.records.find((entry) => entry.line === diagnostic.line);

    if (record?.voucherOrdinal) affected.add(record.voucherOrdinal);
    else for (const voucher of preview.vouchers) affected.add(voucher.ordinal);
  }

  return {
    total: preview.vouchers.length,
    ready: preview.vouchers.length - affected.size,
    decisions: affected.size,
  };
}

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
    `${bookPath(book)}/source-occurrences/${encodeURIComponent(sie.source?.occurrence.id ?? "unselected")}/sie-previews`,
    Schema.Struct({ encoding: Schema.Literals(["utf-8", "windows-1252", "ibm437"]) }),
    Sie.SiePreview,
  );

  const missingAccounts = missingSourceAccounts(sie.preview.data, setup.accounts).filter(
    (account) => !sie.mappings.data?.current.some((mapping) => mapping.sourceAccount === account),
  );

  const readiness = importReadiness(sie.preview.data, missingAccounts);

  const diagnostics = sie.preview.data?.diagnostics ?? [];

  return (
    <SetupPageContent styleX={setupLayoutStyles(["page", "inset"])}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Import" }]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>Import av historik</SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["subtitle"]}>
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
          <SetupBlock key={item.label} layout={["statistic"]}>
            <SetupText layout={["statisticNumber"]}>{item.value}</SetupText>
            <SetupText layout={["secondary"]}>{item.label}</SetupText>
          </SetupBlock>
        ))}
      </SetupBlock>
      <SetupText as="h2" layout={["semibold", "section28"]}>
        Undantag att lösa
      </SetupText>
      <SetupBlock layout={["controls", "tableSpace"]}>
        {missingAccounts.map((account) => {
          const occurrences =
            sie.preview.data?.vouchers.flatMap((voucher) =>
              voucher.transactions.filter((item) => item.account === account),
            ).length ?? 0;

          return (
            <SetupBlock key={account} layout={["controlRow"]}>
              <SetupBlock layout={["stack4"]}>
                <SetupText>
                  {sie.preview.data?.vouchers.filter((voucher) =>
                    voucher.transactions.some((line) => line.account === account),
                  ).length ?? 0}{" "}
                  behöver kontomappning
                </SetupText>
                <SetupText layout={["warning"]}>! Behöver åtgärd</SetupText>
              </SetupBlock>
              <SetupText layout={["secondary"]}>
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
        <ImportPauseAction run={run} />
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          {run?.financialState === "posted"
            ? "Historiken är inlagd. OpenERP blir gällande först efter bekräftad övergång."
            : "Inget har gjorts gällande. Ingenting bokförs förrän du godkänt."}
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
    `${bookPath(book)}/onboarding/account-mappings`,
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
      styleX={setupLayoutStyles(["page", "focused"])}
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
      <SetupText as="p" layout={["subtitle"]}>
        Förekommer i {model.rows.length} poster
        {model.rows.length
          ? `, från ${formatDate(model.rows[0]?.voucher.date ?? null, false)} till ${formatDate(model.rows.at(-1)?.voucher.date ?? null, false)}`
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
      <SetupBlock as="label" id="mapping-label" layout={["section28"]}>
        Mappa alla förekomster till
      </SetupBlock>
      <SetupBlock layout={["tableSpace"]}>
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
      <SetupCaption>Du bestämmer.</SetupCaption>
      <SetupText as="h2" layout={["section28"]}>
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
                formatDate(voucher.date, false),
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
