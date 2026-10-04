import { useState } from "react";
import * as Schema from "effect/Schema";
import * as stylex from "@stylexjs/stylex";
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
import { styles } from "./styles";

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
  const missingAccounts = [
    ...new Set(
      sie.preview.data?.vouchers.flatMap((voucher) =>
        voucher.transactions
          .filter(
            (item) =>
              !setup.accounts.some((account) => account.active && account.code === item.account),
          )
          .map((item) => item.account),
      ) ?? [],
    ),
  ];
  const reviewed = sie.plan.data?.voucherCount;
  const posted =
    run?.financialState === "posted"
      ? reviewed
      : run?.nextFinancialOrdinal !== null && run?.nextFinancialOrdinal !== undefined
        ? Math.max(0, run.nextFinancialOrdinal - 1)
        : null;
  const diagnostics = sie.preview.data?.diagnostics ?? [];
  return (
    <SetupPageContent styleX={[styles.page, styles.inset]}>
      <Breadcrumb
        items={[{ label: "Setup", view: "workspace" }, { label: "Import" }]}
        open={open}
      />
      <div {...stylex.props(styles.title)}>
        <SetupTitle>Import av historik</SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Tidigare bokföring{sie.source ? `, ${sie.source.occurrence.filename}` : ""}
        {workspace.case.configuration.dates.historyStartsOn &&
        workspace.case.configuration.dates.historyEndsOn
          ? `, ${formatDate(workspace.case.configuration.dates.historyStartsOn, false)} till ${formatDate(workspace.case.configuration.dates.historyEndsOn)}.`
          : "."}
      </p>
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
      <div {...stylex.props(styles.summary, styles.section24)}>
        {[
          { value: reviewed?.toString() ?? "—", label: "verifikat granskade" },
          { value: posted?.toString() ?? "—", label: "✓ klara" },
          { value: missingAccounts.length + diagnostics.length, label: "! behöver beslut" },
        ].map((item) => (
          <div key={item.label} {...stylex.props(styles.statistic)}>
            <span {...stylex.props(styles.statisticNumber)}>{item.value}</span>
            <span {...stylex.props(styles.secondary)}>{item.label}</span>
          </div>
        ))}
      </div>
      <h2 {...stylex.props(styles.semibold, styles.section28)}>Undantag att lösa</h2>
      <div {...stylex.props(styles.controls, styles.tableSpace)}>
        {missingAccounts.map((account) => {
          const occurrences =
            sie.preview.data?.vouchers.flatMap((voucher) =>
              voucher.transactions.filter((item) => item.account === account),
            ).length ?? 0;
          return (
            <div key={account} {...stylex.props(styles.controlRow)}>
              <div {...stylex.props(styles.stack4)}>
                <span>Konto {account} behöver kontomappning</span>
                <span {...stylex.props(styles.warning)}>! Behöver åtgärd</span>
              </div>
              <span {...stylex.props(styles.secondary)}>
                Konto {account} saknas i kontoplanen och förekommer i {occurrences} poster.
              </span>
              <SetupLink onClick={() => open("mapping")}>
                Konto {account} i {occurrences} poster
              </SetupLink>
            </div>
          );
        })}
        {diagnostics.map((item, index) => (
          <div key={`${item.code}-${item.line}-${index}`} {...stylex.props(styles.controlRow)}>
            <div {...stylex.props(styles.stack4)}>
              <span>{item.code}</span>
              <span {...stylex.props(styles.warning)}>
                {item.severity === "error" ? "Blockerad" : "! Behöver åtgärd"}
              </span>
            </div>
            <span {...stylex.props(styles.secondary)}>{item.message}</span>
            <SetupLink onClick={() => open("sources")}>Visa posten</SetupLink>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.section28, styles.actions8)}>
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
      </div>
      <div {...stylex.props(styles.note)}>
        <SetupCaption>Inget har gjorts gällande. Ingenting bokförs förrän du godkänt.</SetupCaption>
      </div>
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
  const missing = [
    ...new Set(
      sie.preview.data?.vouchers.flatMap((voucher) =>
        voucher.transactions
          .filter(
            (line) =>
              !setup.accounts.some((account) => account.active && account.code === line.account),
          )
          .map((line) => line.account),
      ) ?? [],
    ),
  ];
  const account =
    missing[0] ??
    sie.plan.data?.input.mappings.find(
      (mapping) => !setup.accounts.some((item) => item.code === mapping.sourceAccount),
    )?.sourceAccount;
  const rows =
    sie.preview.data?.vouchers.flatMap((voucher) =>
      voucher.transactions
        .filter((line) => line.account === account)
        .map((line) => ({ voucher, line })),
    ) ?? [];
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
  const trialBalances = lifecycle.controls
    .filter((control) => control.kind === "trial_balance")
    .toSorted((a, b) => a.asOf.localeCompare(b.asOf));
  const opening = trialBalances[0];
  const closing = trialBalances.at(-1);
  const independentControls =
    opening && closing && opening.id !== closing.id
      ? opening.facts.flatMap((fact) => {
          const last = closing.facts.find(
            (candidate) => candidate.accountCode === fact.accountCode,
          );
          const year = sie.preview.data?.controls.find(
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
  const canSeal =
    !!sie.preview.data && !sie.plan.data && independentControls.length > 0 && !!choice && !!account;
  return (
    <SetupContent
      styleX={[styles.page, styles.focused]}
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
      <div {...stylex.props(styles.title)}>
        <SetupTitle>
          {account ? `Konto ${account} saknas i kontoplanen` : "Kontomappning"}
        </SetupTitle>
      </div>
      <p {...stylex.props(styles.subtitle)}>
        Förekommer i {rows.length} poster
        {rows.length
          ? `, från ${formatDate(rows[0]?.voucher.date ?? null, false)} till ${formatDate(rows.at(-1)?.voucher.date ?? null, false)}`
          : ""}
        .
      </p>
      <PendingRead
        pending={sie.inventory.isPending || (!!sie.latest && sie.preview.isPending)}
        error={sie.inventory.error ?? sie.preview.error}
        retry={() => {
          void sie.inventory.refetch();
        }}
      />
      <label id="mapping-label" {...stylex.props(styles.section28)}>
        Mappa alla förekomster till
      </label>
      <div {...stylex.props(styles.tableSpace)}>
        <SelectControl
          aria-labelledby="mapping-label"
          value={choice}
          options={setup.accounts
            .filter((item) => item.active)
            .map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))}
          onValueChange={(value) => setSelected(value ?? "")}
          disabled={map.disabled || map.uncertain || !!sie.plan.data}
          placeholder="Välj konto"
          styleX={styles.select}
        />
      </div>
      <SetupCaption>Du bestämmer.</SetupCaption>
      <h2 {...stylex.props(styles.section28)}>
        Så här ser det ut, {showAll ? rows.length : Math.min(3, rows.length)} av {rows.length}{" "}
        poster
      </h2>
      <div {...stylex.props(styles.tableSpace)}>
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
      </div>
      <div {...stylex.props(styles.section20, styles.radioOption)}>
        <input
          type="checkbox"
          aria-label="Kom ihåg valet för nästa import från samma källa"
          disabled
        />
        <span>Kom ihåg valet för nästa import från samma källa</span>
      </div>
      <div {...stylex.props(styles.section24, styles.actions8)}>
        <SetupButton type="submit" disabled={map.disabled || (!map.uncertain && !canSeal)}>
          Mappa alla {rows.length}
        </SetupButton>
        <SetupButton type="button" variant="outline" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Visa färre poster" : "Visa alla poster"}
        </SetupButton>
      </div>
      <div {...stylex.props(styles.note)}>
        <SetupCaption>
          Valet sparas med ditt namn och kan ändras. Ingen post bokförs om.
        </SetupCaption>
      </div>
      {!canSeal ? (
        <p role="status">
          {sie.plan.data
            ? "Importplanen är redan sparad. En ny granskning krävs för att ändra mappningen."
            : "Oberoende ingående och utgående saldon behövs innan mappningen kan sparas."}
        </p>
      ) : null}
      <AccountingStatus locale={locale} pending={map.isPending} error={map.error} write />
    </SetupContent>
  );
}
