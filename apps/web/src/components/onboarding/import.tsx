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

function importPostedCount(
  run: Workspace["imports"][number] | undefined,
  reviewed: number | undefined,
) {
  return run?.financialState === "posted"
    ? reviewed
    : run?.nextFinancialOrdinal !== null && run?.nextFinancialOrdinal !== undefined
      ? Math.max(0, run.nextFinancialOrdinal - 1)
      : null;
}

export function OnboardingImport({
  workspace,
  open,
}: {
  workspace: Workspace;
  open: OpenOnboardingView;
}) {
  const { book, setup, locale } = useBookWorkspace();
  const sie = useSieSource(workspace);
  const run = workspace.imports.find((item) => item.sourcePlanId === sie.latest?.planId);

  const pause = useOnboardingCommand(
    `${bookPath(book)}/sie-runs/${encodeURIComponent(run?.sourceRunId ?? "unselected")}/lease`,
    Schema.Struct({ action: Schema.Literals(["pause", "resume"]) }),
    Sie.SieFence,
  );

  const capture = useOnboardingCommand(
    `${bookPath(book)}/source-occurrences/${encodeURIComponent(sie.source?.occurrence.id ?? "unselected")}/sie-previews`,
    Schema.Struct({ encoding: Schema.Literals(["utf-8", "windows-1252", "ibm437"]) }),
    Sie.SiePreview,
  );

  const missingAccounts = missingSourceAccounts(sie.preview.data, setup.accounts);

  const reviewed = sie.plan.data?.voucherCount;

  const posted = importPostedCount(run, reviewed);

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
          { value: reviewed?.toString() ?? "—", label: "verifikat granskade" },
          { value: posted?.toString() ?? "—", label: "✓ klara" },
          { value: missingAccounts.length + diagnostics.length, label: "! behöver beslut" },
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
                <SetupText>Konto {account} behöver kontomappning</SetupText>
                <SetupText layout={["warning"]}>! Behöver åtgärd</SetupText>
              </SetupBlock>
              <SetupText layout={["secondary"]}>
                Konto {account} saknas i kontoplanen och förekommer i {occurrences} poster.
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
        <SetupButton disabled={!sie.preview.data} onClick={() => open("mapping")}>
          Lös undantag
        </SetupButton>
        <SetupButton
          variant="outline"
          disabled={!run || pause.disabled}
          onClick={() =>
            pause.mutate(
              pause.uncertain && pause.variables
                ? pause.variables
                : { action: run?.sourceState === "paused" ? "resume" : "pause" },
            )
          }
        >
          {run?.sourceState === "paused" ? "Återuppta import" : "Pausa import"}
        </SetupButton>
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>Inget har gjorts gällande. Ingenting bokförs förrän du godkänt.</SetupCaption>
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
      <AccountingStatus
        locale={locale}
        pending={pause.isPending || capture.isPending}
        error={pause.error ?? capture.error}
        write
      />
    </SetupPageContent>
  );
}

function sourceAmount(amount: string) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(amount);

  if (!match) return amount;
  const sign = match[1] === "-" ? -1n : 1n;

  return formatMinor(
    (sign * (BigInt(match[2] ?? "0") * 100n + BigInt((match[3] ?? "").padEnd(2, "0")))).toString(),
  );
}

function independentOpeningControls(
  lifecycle: Lifecycle,
  preview: typeof Sie.SiePreview.Type | undefined,
) {
  const trialBalances = lifecycle.controls
    .filter((control) => control.kind === "trial_balance")
    .toSorted((a, b) => a.asOf.localeCompare(b.asOf));

  const opening = trialBalances[0];
  const closing = trialBalances.at(-1);

  return opening && closing && opening.id !== closing.id
    ? opening.facts.flatMap((fact) => {
        const last = closing.facts.find((candidate) => candidate.accountCode === fact.accountCode);

        const year = preview?.controls.find(
          (control) => control.account === fact.accountCode,
        )?.year;

        return last && year
          ? [
              {
                sourceAccount: fact.accountCode,
                year,
                independentOpeningMinor: fact.amountMinor,
                independentClosingMinor: last.amountMinor,
                basis: `${opening.provenance}, ${closing.provenance}`,
              },
            ]
          : [];
      })
    : [];
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

function mappingReady(
  preview: typeof Sie.SiePreview.Type | undefined,
  plan: typeof Sie.SiePlan.Type | undefined,
  controls: readonly (typeof Sie.OpeningControl.Type)[],
  choice: string,
  account: string | undefined,
) {
  return !!preview && !plan && controls.length > 0 && !!choice && !!account;
}

export function OnboardingMapping({
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
  const [selected, setSelected] = useState("");
  const [showAll, setShowAll] = useState(false);

  const missing = missingSourceAccounts(sie.preview.data, setup.accounts);

  const account =
    missing[0] ??
    sie.plan.data?.input.mappings.find(
      (mapping) => !setup.accounts.some((item) => item.code === mapping.sourceAccount),
    )?.sourceAccount;

  const rows = mappingRows(sie.preview.data, account);

  const existingChoice = sie.plan.data?.input.mappings.find(
    (mapping) => mapping.sourceAccount === account,
  )?.accountId;

  const choice = selected || existingChoice || "";

  const map = useOnboardingCommand(
    `${bookPath(book)}/sie-previews/${encodeURIComponent(sie.preview.data?.id ?? "unselected")}/plans`,
    Sie.SealSiePlan,
    Sie.SiePlan,
    () => open("import"),
  );

  const independentControls = independentOpeningControls(lifecycle, sie.preview.data);

  const canSeal = mappingReady(
    sie.preview.data,
    sie.plan.data,
    independentControls,
    choice,
    account,
  );

  return (
    <SetupContent
      styleX={setupLayoutStyles(["page", "focused"])}
      onSubmit={(event) => {
        event.preventDefault();

        if (map.disabled || !canSeal || !sie.preview.data) return;

        const mappings = [
          ...new Set(
            sie.preview.data.vouchers.flatMap((voucher) =>
              voucher.transactions.map((line) => line.account),
            ),
          ),
        ].flatMap((code) => {
          const id =
            code === account
              ? choice
              : setup.accounts.find((item) => item.active && item.code === code)?.id;

          return id ? [{ sourceAccount: code, accountId: id }] : [];
        });

        map.mutate(
          map.uncertain && map.variables
            ? map.variables
            : {
                digest: sie.preview.data.digest,
                mappings,
                openingControls: independentControls,
                openItems: [],
                openItemControls: [],
                rationale: "Kontomappning vald i setup",
                openingPolicy: "unreconstructable_detail",
                sourceKind:
                  workspace.case.recordClass === "synthetic" ? "synthetic" : "reviewed_sie4",
              },
        );
      }}
    >
      <Breadcrumb
        items={[
          { label: "Setup", view: "workspace" },
          { label: "Import", view: "import" },
          { label: account ? `Konto ${account}` : "Kontomappning" },
        ]}
        open={open}
      />
      <SetupBlock layout={["title"]}>
        <SetupTitle>
          {account ? `Konto ${account} saknas i kontoplanen` : "Kontomappning"}
        </SetupTitle>
      </SetupBlock>
      <SetupText as="p" layout={["subtitle"]}>
        Förekommer i {rows.length} poster
        {rows.length
          ? `, från ${formatDate(rows[0]?.voucher.date ?? null, false)} till ${formatDate(rows.at(-1)?.voucher.date ?? null, false)}`
          : ""}
        .
      </SetupText>
      <PendingRead
        pending={
          !!sie.source && (sie.inventory.isPending || (!!sie.latest && sie.preview.isPending))
        }
        error={sie.inventory.error ?? sie.preview.error}
        retry={() => {
          void sie.inventory.refetch();
        }}
      />
      <SetupBlock as="label" id="mapping-label" layout={["section28"]}>
        Mappa alla förekomster till
      </SetupBlock>
      <SetupBlock layout={["tableSpace"]}>
        <SelectControl
          aria-labelledby="mapping-label"
          value={choice}
          options={setup.accounts
            .filter((item) => item.active)
            .map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))}
          onValueChange={(value) => setSelected(value ?? "")}
          disabled={map.disabled || map.uncertain || !!sie.plan.data}
          placeholder="Välj konto"
          styleX={setupLayoutStyles(["select"])}
        />
      </SetupBlock>
      <SetupCaption>Du bestämmer.</SetupCaption>
      <SetupText as="h2" layout={["section28"]}>
        Så här ser det ut, {showAll ? rows.length : Math.min(3, rows.length)} av {rows.length}{" "}
        poster
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
          rows={(showAll ? rows : rows.slice(0, 3)).map(({ voucher, line }, index) => ({
            id: `${voucher.ordinal}-${line.recordOrdinal}-${index}`,
            cells: [
              formatDate(voucher.date, false),
              `${voucher.series}${voucher.number}`,
              sie.preview.data?.records.find((record) => record.ordinal === voucher.recordOrdinal)
                ?.fields[3] ?? "",
              sourceAmount(line.amount),
            ],
          }))}
        />
      </SetupBlock>
      <SetupBlock layout={["section20", "radioOption"]}>
        <SetupRadio
          type="checkbox"
          aria-label="Kom ihåg valet för nästa import från samma källa"
          disabled
        />
        <SetupText>Kom ihåg valet för nästa import från samma källa</SetupText>
      </SetupBlock>
      <SetupBlock layout={["section24", "actions8"]}>
        <SetupButton type="submit" disabled={map.disabled || (!map.uncertain && !canSeal)}>
          Mappa alla {rows.length}
        </SetupButton>
        <SetupButton type="button" variant="outline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Visa färre poster" : "Visa alla poster"}
        </SetupButton>
      </SetupBlock>
      <SetupBlock layout={["note"]}>
        <SetupCaption>
          Valet sparas med ditt namn och kan ändras. Ingen post bokförs om.
        </SetupCaption>
      </SetupBlock>
      {!canSeal ? (
        <SetupText as="p" role="status">
          {sie.plan.data
            ? "Importplanen är redan sparad. En ny granskning krävs för att ändra mappningen."
            : "Oberoende ingående och utgående saldon behövs innan mappningen kan sparas."}
        </SetupText>
      ) : null}
      <AccountingStatus locale={locale} pending={map.isPending} error={map.error} write />
    </SetupContent>
  );
}
