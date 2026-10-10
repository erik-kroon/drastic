import { Api } from "@open-erp/contracts/api";
import { bookScope, httpRequest } from "@/lib/contract-client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Vat from "@open-erp/contracts/vat-returns";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { PageAction, PageCaption, PageEmpty } from "@open-erp/ui/components/accounting-page";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { VatOverview } from "@open-erp/ui/components/vat-overview";
import { AccountingStatus } from "@/components/accounting-status";
import { CommandForm, Evidence, checkScope } from "@/components/commerce/shared";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { useWorkReturn, workReturnHref } from "@/lib/work-return";
import { formatMinorAmount } from "@/lib/workspace-api";

const families = [
  ["sales_ledger", "Sales", "Försäljning"],
  ["purchase_ledger", "Purchases and owner expenses", "Inköp och ägarutlägg"],
  ["credit_notes", "Credit notes", "Kreditnotor"],
  ["external_imports", "External imports", "Externa importer"],
] as const;

export function ActualVatReturnsPanel(props: { recordId: string; onOpen: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();

  const work = useWorkReturn();
  const sv = locale === "sv";
  const period = setup.periods.find((item) => item.id === work?.period);

  const list = useQuery({
    queryKey: [...bookKey(book), "vat-actuals"],
    queryFn: ({ signal }) =>
      readAccounting(
        (client) => client.vatReturns.listActualVatReturns({ params: { ...bookScope(book) } }),
        Vat.ActualVatReturnList,
        { signal },
      ),
    retry: false,
  });

  const items = list.isError
    ? undefined
    : list.data?.items.filter(
        (item) => !period || (item.startsOn >= period.startsOn && item.endsOn <= period.endsOn),
      );

  if (props.recordId)
    return (
      <Box display="grid" gap="lg" minWidth="zero">
        <Box>
          <Button variant="ghost" onClick={() => props.onOpen("")}>
            {sv ? "Alla momsperioder" : "All VAT periods"}
          </Button>
        </Box>
        {props.recordId === "new" ? (
          <ActualPreparation onOpen={props.onOpen} />
        ) : (
          <ActualDetail id={props.recordId} onOpen={props.onOpen} />
        )}
      </Box>
    );

  if (list.isSuccess && items?.length === 0)
    return (
      <VatOverview
        caption={
          sv
            ? "Underlag för momsdeklaration, ingen sparad beräkning"
            : "VAT return basis, no saved calculation"
        }
        amount="—"
        rows={(sv
          ? ["Utgående moms", "Ingående moms", "Moms att betala"]
          : ["Output VAT", "Input VAT", "VAT payable"]
        ).map((label) => ({ label, amount: "—" }))}
        notice={
          sv
            ? "Momsbelopp och deklarationsperiod är inte verifierade. Förbered en period för att granska underlaget. Drastic deklarerar eller betalar inte."
            : "VAT amounts and the filing period are not verified. Prepare a period to review the basis. Drastic does not submit returns or pay."
        }
      >
        <Box display="grid" gap="md">
          <Box>
            <Button disabled={book.role !== "operator"} onClick={() => props.onOpen("new")}>
              {sv ? "Förbered period" : "Prepare period"}
            </Button>
          </Box>
          <Disclosure compact title={sv ? "Granska periodens underlag" : "Review period sources"}>
            <PeriodActions />
          </Disclosure>
        </Box>
      </VatOverview>
    );

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={sv ? "Periodens moms" : "Period VAT"}
        subtitle={
          period
            ? `${period.startsOn} – ${period.endsOn}`
            : sv
              ? "Granska täckning, belopp och momskonton tillsammans."
              : "Review coverage, amounts and VAT controls together."
        }
        action={
          <Button disabled={book.role !== "operator"} onClick={() => props.onOpen("new")}>
            {sv ? "Förbered period" : "Prepare period"}
          </Button>
        }
      />
      <PageCaption>
        {sv
          ? "Varje beräkning sparar sitt underlag. Den skickar ingen deklaration och registrerar ingen betalning."
          : "Each calculation retains its basis. It does not submit a return or record a payment."}
      </PageCaption>
      <PeriodActions />
      <AccountingStatus locale={locale} pending={list.isPending} error={list.error} />
      {list.isError ? (
        <Box>
          <Button variant="outline" onClick={() => void list.refetch()}>
            {sv ? "Försök läsa igen" : "Retry reading periods"}
          </Button>
        </Box>
      ) : null}
      {list.isSuccess && items ? (
        items.length ? (
          <DataTable
            title={sv ? "Sparade perioder" : "Saved periods"}
            narrow="stack"
            columns={[
              { id: "period", label: "Period" },
              { id: "state", label: sv ? "Sparat resultat" : "Saved result" },
              { id: "date", label: sv ? "Beräknad" : "Calculated" },
            ]}
            rows={items.map((item) => ({
              id: item.id,
              cells: [
                <Button key="open" variant="ghost" onClick={() => props.onOpen(item.id)}>
                  {item.startsOn} – {item.endsOn}
                </Button>,
                item.filingReady
                  ? sv
                    ? "Kontroller godkända vid beräkning"
                    : "Checks passed at calculation"
                  : sv
                    ? "Åtgärder återstår"
                    : "Work remains",
                new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(item.recordedAt),
                ),
              ],
            }))}
          />
        ) : (
          <PageEmpty
            title={sv ? "Ingen sparad beräkning" : "No saved calculation"}
            detail={
              sv
                ? "Förbered den registrerade momsperioden med granskat ingående saldo och underlag för täckning."
                : "Prepare the registered VAT interval with reviewed opening balances and coverage evidence."
            }
          />
        )
      ) : null}
    </Box>
  );
}

function ActualPreparation({ onOpen }: { onOpen: (id: string) => void }) {
  const { book, setup, locale } = useBookWorkspace();

  const work = useWorkReturn();
  const period = setup.periods.find((item) => item.id === work?.period);
  const sv = locale === "sv";

  const [rows, setRows] = useState(3);

  return (
    <RecordSection title={sv ? "Förbered momsperiod" : "Prepare VAT period"}>
      <PageCaption>
        {sv
          ? "Ange den registrerade momsperioden. Bokföringsperioden är bara ett startvärde. Momsprofil, kontoroller och periodunderlag kontrolleras innan beräkningen sparas."
          : "Enter the registered VAT interval. The accounting period is only a starting value. The VAT profile, account roles and period evidence are checked before saving."}
      </PageCaption>
      <CommandForm
        book={book}
        locale={locale}
        path={`${bookPath(book)}/vat-returns/actuals`}
        recoveryId={`vat-actual:${work?.period ?? "new"}`}
        schema={Vat.PrepareActualVatReturn}
        output={Vat.ActualVatReturn}
        label={sv ? "Beräkna och spara" : "Calculate and save"}
        allowed={book.role === "operator"}
        input={(fields) => ({
          startsOn: fields.get("startsOn"),
          endsOn: fields.get("endsOn"),
          periodEvidenceId: fields.get("periodEvidenceId"),
          openingEvidenceId: fields.get("openingEvidenceId"),
          rationale: fields.get("rationale"),
          controlOpenings: Array.from({ length: rows }, (_, index) => ({
            accountId: fields.get(`account-${index}`),
            signedMinor: fields.get(`opening-${index}`),
          })).filter((row) => row.accountId),
          sourceCoverage: families.map(([family]) => ({
            family,
            state: fields.get(`state-${family}`),
            evidenceId: fields.get(`evidence-${family}`) || null,
          })),
        })}
        validate={(result) => checkScope(book, result.scope)}
        onSuccess={(result) => onOpen(result.id)}
        operation={(client, requestOptions) =>
          client.vatReturns.prepareActualVatReturn(
            httpRequest(
              Api.groups.vatReturns.endpoints.prepareActualVatReturn,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          )
        }
      >
        <Box display="flex" flexWrap="wrap" gap="lg">
          <InputField
            name="startsOn"
            type="date"
            label={sv ? "Från" : "From"}
            defaultValue={period?.startsOn}
            required
          />
          <InputField
            name="endsOn"
            type="date"
            label={sv ? "Till" : "To"}
            defaultValue={period?.endsOn}
            required
          />
        </Box>
        <InputField
          name="periodEvidenceId"
          label={sv ? "Underlags-ID för registrerad period" : "Registered-period evidence ID"}
          required
        />
        <RecordSection
          title={sv ? "Granskade ingående momssaldon" : "Reviewed VAT opening balances"}
        >
          <PageCaption>
            {sv
              ? "Ange alla bundna momskonton. Belopp i öre, debet positivt och kredit negativt. Noll måste anges uttryckligen."
              : "Include every bound VAT control account. Enter öre, debit positive and credit negative. State zero explicitly."}
          </PageCaption>
          <InputField
            name="openingEvidenceId"
            label={sv ? "Underlags-ID för ingående saldon" : "Opening-balance evidence ID"}
            required
          />
          {Array.from({ length: rows }, (_, index) => (
            <Box key={index} display="flex" flexWrap="wrap" gap="md">
              <SelectField
                name={`account-${index}`}
                label={`${sv ? "Konto" : "Account"} ${index + 1}`}
                options={[
                  { value: "", label: "—" },
                  ...setup.accounts.map((account) => ({
                    value: account.id,
                    label: `${account.code}, ${account.name}`,
                  })),
                ]}
              />
              <InputField
                name={`opening-${index}`}
                label={`${sv ? "Ingående saldo i öre" : "Opening balance in öre"} ${index + 1}`}
                pattern="^-?(0|[1-9][0-9]*)$"
              />
            </Box>
          ))}
          <Box>
            <Button
              type="button"
              variant="outline"
              disabled={rows >= 8}
              onClick={() => setRows(rows + 1)}
            >
              {sv ? "Lägg till konto" : "Add account"}
            </Button>
          </Box>
        </RecordSection>
        <RecordSection title={sv ? "Underlagens täckning" : "Source coverage"}>
          <PageCaption>
            {sv
              ? "Ett tomt register bevisar inte fullständig täckning. Ange aktuellt bara med oberoende underlag."
              : "An empty register does not prove complete coverage. Mark current only with independent evidence."}
          </PageCaption>
          {families.map(([family, en, se]) => (
            <Box key={family} display="flex" flexWrap="wrap" gap="md">
              <SelectField
                name={`state-${family}`}
                label={sv ? se : en}
                defaultValue="unknown"
                options={[
                  { value: "unknown", label: sv ? "Okänd" : "Unknown" },
                  { value: "unavailable", label: sv ? "Saknas" : "Unavailable" },
                  {
                    value: "current",
                    label: sv ? "Aktuell med underlag" : "Current with evidence",
                  },
                ]}
              />
              <InputField
                name={`evidence-${family}`}
                label={`${sv ? se : en}, ${sv ? "underlags-ID" : "evidence ID"}`}
              />
            </Box>
          ))}
        </RecordSection>
        <InputField
          name="rationale"
          label={sv ? "Granskningsmotivering" : "Review rationale"}
          required
        />
      </CommandForm>
    </RecordSection>
  );
}

function ActualDetail({ id, onOpen }: { id: string; onOpen: (id: string) => void }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";

  const detail = useQuery({
    queryKey: [...bookKey(book), "vat-actuals", id],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        (client) =>
          client.vatReturns.getActualVatReturn({ params: { ...bookScope(book), id: id } }),
        Vat.ActualVatReturnView,
        { signal },
      );

      checkScope(book, result.saved.scope);

      if (result.saved.id !== id) throw new Error("VAT return identity mismatch");

      return result;
    },
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const view = detail.isError ? undefined : detail.data;

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button
          variant="outline"
          disabled={detail.isFetching}
          onClick={() => void detail.refetch()}
        >
          {sv ? "Uppdatera kontroll" : "Refresh checks"}
        </Button>
        <Button disabled={book.role !== "operator"} onClick={() => onOpen("new")}>
          {sv ? "Förbered ny beräkning" : "Prepare a new calculation"}
        </Button>
      </Box>
      <AccountingStatus locale={locale} pending={detail.isPending} error={detail.error} />
      {view ? <ActualResult view={view} /> : null}
    </Box>
  );
}

function ActualResult({ view }: { view: typeof Vat.ActualVatReturnView.Type }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const { saved, currentness } = view;
  const result = saved.calculation;

  const money = (minor: string) => formatMinorAmount(minor, saved.basis.currencyScale, locale);

  return (
    <>
      <RecordHeading
        title={`${saved.input.startsOn} – ${saved.input.endsOn}`}
        subtitle={
          sv
            ? "Sparad momsberäkning, inte inskickad, inte betald"
            : "Saved VAT calculation, not submitted, not paid"
        }
        action={null}
      />
      <Text role="status">
        {currentness.basisCurrent
          ? sv
            ? "Underlaget är aktuellt."
            : "The basis is current."
          : sv
            ? "Underlaget har ändrats. Förbered en ny beräkning före nästa beslut."
            : "The basis has changed. Prepare a new calculation before the next decision."}
      </Text>
      <DataTable
        title={sv ? "Periodkontroller" : "Period checks"}
        narrow="stack"
        columns={[
          { id: "check", label: sv ? "Kontroll" : "Check" },
          { id: "state", label: "Status" },
        ]}
        rows={[
          [
            "calculation",
            sv ? "Beräkning stöds" : "Calculation supported",
            result.calculationSupported,
          ],
          ["coverage", sv ? "Fullständig täckning" : "Complete coverage", result.coverageComplete],
          [
            "controls",
            sv ? "Momskonton avstämda" : "VAT controls reconciled",
            result.controlsReconciled,
          ],
          ["period", sv ? "Period verifierad" : "Period verified", result.periodVerified],
        ].map(([id, label, passed]) => ({
          id: String(id),
          cells: [
            String(label),
            passed ? (sv ? "Ja" : "Yes") : sv ? "Åtgärd krävs" : "Needs attention",
          ],
        }))}
      />
      <RecordSection title={sv ? "Belopp per ruta" : "Amounts by box"}>
        <PageCaption>
          {sv
            ? "Exakta belopp, rapporterade belopp och avrundningsrester visas i SEK. Saknad ruta är inte noll."
            : "Exact amounts, reported amounts and rounding residuals are shown in SEK. An absent box is not zero."}
        </PageCaption>
        <DataTable
          title={sv ? "Momsrutor" : "VAT boxes"}
          narrow="stack"
          columns={[
            { id: "box", label: sv ? "Ruta" : "Box" },
            { id: "exact", label: sv ? "Exakt" : "Exact", numeric: true },
            { id: "reported", label: sv ? "Rapporterat" : "Reported", numeric: true },
            { id: "residual", label: sv ? "Rest" : "Residual", numeric: true },
          ]}
          rows={result.boxes.map((box) => ({
            id: box.box,
            cells: [
              box.box,
              money(box.exactMinor),
              money(box.reportedMinor),
              money(box.residualMinor),
            ],
          }))}
        />
      </RecordSection>
      <PeriodActions />
      <Disclosure title={sv ? "Period- och öppningsunderlag" : "Period and opening evidence"}>
        <Evidence
          book={book}
          locale={locale}
          reference={{
            evidenceId: saved.basis.registeredPeriod.periodEvidenceId,
            sha256: saved.basis.registeredPeriod.periodEvidenceSha256,
          }}
        />
        <Evidence
          book={book}
          locale={locale}
          reference={{
            evidenceId: saved.basis.openingEvidenceId,
            sha256: saved.basis.openingEvidenceSha256,
          }}
        />
      </Disclosure>
      <ActualCoverage saved={saved} />
      <ActualControls saved={saved} />
      {result.exclusions.length ? (
        <RecordSection title={sv ? "Exkluderade underlag" : "Excluded sources"}>
          {result.exclusions.map((item) => (
            <Text key={`${item.ordinal}:${item.factId}`}>
              {item.factId}: {item.detail}
            </Text>
          ))}
        </RecordSection>
      ) : null}
      <Disclosure
        title={sv ? "Bidrag och tidsförskjutningar" : "Contributions and timing differences"}
      >
        <DataTable
          title={sv ? "Momsbidrag" : "VAT contributions"}
          narrow="stack"
          columns={[
            { id: "fact", label: sv ? "Underlag" : "Source" },
            { id: "box", label: sv ? "Ruta" : "Box" },
            { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
          ]}
          rows={result.contributions.map((item) => ({
            id: `${item.ordinal}:${item.box}`,
            cells: [item.factId, item.box, money(item.signedMinor)],
          }))}
        />
        {result.timingBridge.map((item) => (
          <Text key={`${item.factId}:${item.reason}`}>
            {item.factId}, {item.taxPointOn}, {item.componentPostingDates.join(", ")}
          </Text>
        ))}
      </Disclosure>
      {result.blockers.length || currentness.staleReasons.length ? (
        <Disclosure title={sv ? "Sparade kontrollorsaker" : "Retained check reasons"}>
          <Text>{[...result.blockers, ...currentness.staleReasons].join(", ")}</Text>
        </Disclosure>
      ) : null}
    </>
  );
}

function ActualCoverage({ saved }: { saved: typeof Vat.ActualVatReturn.Type }) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const result = saved.calculation;

  return (
    <>
      <RecordSection title={sv ? "Krediter och ägarutlägg" : "Credits and owner expenses"}>
        <DataTable
          title={sv ? "Inkluderade underlag" : "Captured sources"}
          narrow="stack"
          columns={[
            { id: "kind", label: sv ? "Underlag" : "Source" },
            { id: "count", label: sv ? "I vald period" : "In selected period", numeric: true },
          ]}
          rows={[
            {
              id: "owner",
              cells: [
                sv ? "Ägarbetalda inköp" : "Owner-paid purchases",
                saved.basis.population.selectedOwnerPurchaseComponentCount?.toString() ??
                  (sv ? "Inte registrerat i denna version" : "Not captured in this version"),
              ],
            },
            {
              id: "credit",
              cells: [
                sv ? "Kundkrediter" : "Customer credits",
                saved.basis.population.selectedCustomerCreditComponentCount?.toString() ??
                  (sv ? "Inte registrerat i denna version" : "Not captured in this version"),
              ],
            },
            {
              id: "purchase",
              cells: [
                sv ? "Inköpskomponenter" : "Purchase components",
                String(saved.basis.population.selectedPurchaseComponentCount),
              ],
            },
          ]}
        />
        <PageCaption>
          {sv
            ? "Antal är inte bevis på täckning. Återbetalningar räknas inte som en andra momskorrigering."
            : "Counts do not prove coverage. Refunds are not counted as a second VAT correction."}
        </PageCaption>
      </RecordSection>
      <RecordSection title={sv ? "Täckning" : "Coverage"}>
        {result.sourceCoverage.map((source) => (
          <Text key={source.family}>
            {families.find(([id]) => id === source.family)?.[sv ? 2 : 1] ?? source.family}:{" "}
            {source.state === "current"
              ? sv
                ? "Aktuell"
                : "Current"
              : source.state === "unknown"
                ? sv
                  ? "Okänd"
                  : "Unknown"
                : sv
                  ? "Saknas"
                  : "Unavailable"}
          </Text>
        ))}
      </RecordSection>
    </>
  );
}

function ActualControls({ saved }: { saved: typeof Vat.ActualVatReturn.Type }) {
  const { book, setup, locale } = useBookWorkspace();

  const work = useWorkReturn();
  const sv = locale === "sv";
  const result = saved.calculation;

  const money = (minor: string) => formatMinorAmount(minor, saved.basis.currencyScale, locale);

  const accountName = (id: string) => {
    const account = setup.accounts.find((item) => item.id === id);

    return account ? `${account.code}, ${account.name}` : id;
  };

  const voucher = (id: string) =>
    `${workReturnHref(`${workspacePath(book)}/books`, "vouchers", work)}&record=${encodeURIComponent(id)}&returnVat=${encodeURIComponent(saved.id)}`;

  return (
    <RecordSection title={sv ? "Avstämning av momskonton" : "VAT control reconciliation"}>
      <DataTable
        title={sv ? "Momskonton" : "VAT controls"}
        narrow="stack"
        columns={[
          { id: "account", label: sv ? "Konto" : "Account" },
          { id: "expected", label: sv ? "Förväntat saldo" : "Expected closing", numeric: true },
          { id: "ledger", label: sv ? "Bokfört saldo" : "Ledger closing", numeric: true },
          { id: "difference", label: sv ? "Differens" : "Difference", numeric: true },
        ]}
        rows={result.controls.map((control) => ({
          id: control.accountId,
          cells: [
            accountName(control.accountId),
            money(control.expectedClosingMinor),
            money(control.frozenGlClosingMinor),
            money(control.differenceMinor),
          ],
        }))}
      />
      {result.controls.flatMap((control) =>
        [...control.unexplainedRows, ...control.missingRows].map((row) => (
          <Box
            key={`${control.accountId}:${row.state}:${row.lineId}`}
            display="flex"
            flexWrap="wrap"
            gap="md"
          >
            <Text>
              {accountName(control.accountId)}, {row.postingDate}, {money(row.signedMinor)},{" "}
              {row.state === "missing"
                ? sv
                  ? "Saknad rad"
                  : "Missing row"
                : sv
                  ? "Oförklarad rad"
                  : "Unexplained row"}
            </Text>
            <PageAction quiet href={voucher(row.voucherId)}>
              {sv ? "Granska verifikation" : "Review voucher"}
            </PageAction>
          </Box>
        )),
      )}
    </RecordSection>
  );
}

function PeriodActions() {
  const { book, locale } = useBookWorkspace();
  const work = useWorkReturn();
  const sv = locale === "sv";
  const base = workspacePath(book);

  return (
    <Box display="flex" flexWrap="wrap" gap="md">
      <PageAction quiet href={workReturnHref(`${base}/purchases`, "documents", work)}>
        {sv ? "Granska original" : "Review originals"}
      </PageAction>
      <PageAction quiet href={workReturnHref(`${base}/purchases`, "invoices", work)}>
        {sv ? "Inköp och leverantörskrediter" : "Purchases and supplier credits"}
      </PageAction>
      <PageAction quiet href={workReturnHref(`${base}/tools`, "owners", work)}>
        {sv ? "Ägarutlägg" : "Owner expenses"}
      </PageAction>
      <PageAction quiet href={workReturnHref(`${base}/tools`, "recovery", work)}>
        {sv ? "Återställ tidigare begäran" : "Recover a previous request"}
      </PageAction>
    </Box>
  );
}
