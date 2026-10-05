import { useState } from "react";
import * as Cash from "@open-erp/contracts/cash-forecast";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { Link } from "@open-erp/ui/components/link";
import { RecordFact, RecordSection, RecordSummary } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { formatMinorAmount } from "@/lib/workspace-api";

function DownloadCashArtifact({
  id,
  artifact,
}: {
  id: string;
  artifact: typeof Cash.CashBasisView.Type.artifact;
}) {
  const { locale } = useBookWorkspace();

  return (
    <Button
      variant="outline"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }));
        const link = document.createElement("a");

        link.href = url;
        link.download = `${id}.json`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      {locale === "sv" ? "Ladda ner originalet" : "Download original"}
    </Button>
  );
}

function DependencyStatus({
  view,
}: {
  view: Pick<typeof Cash.CashBasisView.Type, "dependencyStatus" | "dependencyReason">;
}) {
  const { locale } = useBookWorkspace();

  const labels =
    locale === "sv"
      ? {
          current: "Aktuellt",
          changed: "Inaktuell. Bilden är oförändrad och räknas inte om automatiskt.",
          unavailable:
            "Källornas aktualitet kan inte kontrolleras. Det sparade resultatet är oförändrat.",
        }
      : {
          current: "Current",
          changed:
            "Stale. The saved result remains unchanged and is not recalculated automatically.",
          unavailable: "Source freshness cannot be checked. The saved result remains unchanged.",
        };

  return (
    <Box display="grid" gap="sm">
      <Text role="status">{labels[view.dependencyStatus]}</Text>
      {view.dependencyReason ? <Text>{view.dependencyReason}</Text> : null}
    </Box>
  );
}

export function CashBasisResult({ view }: { view: typeof Cash.CashBasisView.Type }) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";

  const basis = view.basis;

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <DependencyStatus view={view} />
      <RecordSummary>
        <RecordFact label={sv ? "Som av" : "As of"}>{basis.asOf}</RecordFact>
        <RecordFact label={sv ? "Läst till" : "Recorded cutoff"}>{basis.recordedCutoff}</RecordFact>
        <RecordFact label={sv ? "Öppningssaldo" : "Opening"}>
          {basis.opening.totalMinor === null
            ? sv
              ? "Saknas"
              : "Unavailable"
            : formatMinorAmount(basis.opening.totalMinor, 2, locale)}
        </RecordFact>
      </RecordSummary>
      <RecordSection title={sv ? "Konton som ingår" : "Included accounts"}>
        <DataTable
          title={sv ? "Bankunderlag" : "Bank basis"}
          columns={[
            { id: "account", label: sv ? "Konto" : "Account" },
            { id: "date", label: sv ? "Datum" : "Date" },
            {
              id: "balance",
              label: sv ? "Kontoutdragets slutsaldo" : "Statement closing",
              numeric: true,
            },
            { id: "blockers", label: sv ? "Hinder" : "Blockers" },
          ]}
          rows={basis.opening.observations.map((item) => {
            const account = item.coverageReport.accounts.find(
              (entry) => entry.accountId === item.accountId,
            );

            return {
              id: item.accountId,
              cells: [
                account
                  ? `${account.code} ${account.name}`
                  : sv
                    ? "Konto saknas"
                    : "Account unavailable",
                item.effectiveOn,
                item.amountMinor === null
                  ? sv
                    ? "Okänt"
                    : "Unknown"
                  : formatMinorAmount(item.amountMinor, 2, locale),
                item.blockers.join(", "),
              ],
            };
          })}
        />
        {basis.opening.blockers.map((blocker) => (
          <Text key={blocker}>{blocker}</Text>
        ))}
      </RecordSection>
      <RecordSection title={sv ? "Undantaget från underlaget" : "Coverage gaps"}>
        <Text>
          {sv
            ? "Kända poster. Företagets täckning är ofullständig."
            : "Known items. Company coverage is incomplete."}
        </Text>
        {basis.coverage.map((entry) => (
          <Text key={entry.family}>
            {entry.family}, {entry.status}, {entry.reason}
          </Text>
        ))}
        {basis.foreignObligations.map((item) => (
          <Text key={item.id}>
            {item.originalCurrency}, {item.remainingOriginalMinor ?? (sv ? "Okänt" : "Unknown")},{" "}
            {item.reason}
          </Text>
        ))}
      </RecordSection>
      <DownloadCashArtifact id={basis.id} artifact={view.artifact} />
    </Box>
  );
}

export function CashForecastResult({ view }: { view: typeof Cash.CashForecastView.Type }) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const forecast = view.forecast;

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <DependencyStatus view={view} />
      <Text>
        {forecast.asOf} till {forecast.endsOn}, {forecast.horizonDays} {sv ? "dagar" : "days"}
      </Text>
      <Text>
        {sv ? "Läst till" : "Recorded cutoff"} {forecast.recordedCutoff}
      </Text>
      <Text>
        {sv
          ? "Kända poster. Företagets täckning är ofullständig."
          : "Known items. Company coverage is incomplete."}
      </Text>
      {forecast.result.status === "available" ? (
        <AvailableCashForecast forecast={forecast} result={forecast.result} />
      ) : (
        <Text role="status">
          {sv
            ? "Öppningssaldo saknas. Saldo, minimum och marginal kan inte beräknas."
            : "Opening unavailable. Balances, minima and headroom cannot be calculated."}
        </Text>
      )}
      <ForecastContributions forecast={forecast} />
      <RecordSection title={sv ? "Undantaget från underlaget" : "Coverage gaps"}>
        <Text>
          {sv ? "Källor" : "Sources"} {forecast.quality.sourceCoverage},{" "}
          {sv ? "Betalningsdagar" : "Dated contributions"} {forecast.quality.datedContributions}
        </Text>
        {forecast.foreignObligations.map((item) => (
          <Text key={item.id}>
            {item.originalCurrency}, {item.remainingOriginalMinor ?? (sv ? "Okänt" : "Unknown")},{" "}
            {item.reason}
          </Text>
        ))}
      </RecordSection>
      <DownloadCashArtifact id={forecast.id} artifact={view.artifact} />
    </Box>
  );
}

function AvailableCashForecast({
  forecast,
  result,
}: {
  forecast: typeof Cash.CashForecastSnapshot.Type;
  result: Extract<typeof Cash.CashForecastSnapshot.Type.result, { status: "available" }>;
}) {
  const { locale } = useBookWorkspace();
  const sv = locale === "sv";
  const amount = (minor: string) => formatMinorAmount(minor, 2, locale);

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordSummary>
        <RecordFact label={sv ? "Öppningssaldo" : "Opening"}>
          {amount(result.openingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Beräknat saldo efter allt är betalt" : "Forecast closing"}>
          {amount(result.closingMinor)}
        </RecordFact>
        <RecordFact label={sv ? "Din gräns" : "Your reserve"}>
          {amount(forecast.input.bufferMinor)}
        </RecordFact>
      </RecordSummary>
      <RecordSection
        title={
          sv
            ? "Grundantagande, inbetalningar först samma dag"
            : "Baseline, inflows first on the same day"
        }
      >
        <RecordSummary>
          <RecordFact label={sv ? "Lägsta saldo" : "Minimum"}>
            {amount(result.baseline.minimum.amountMinor)}, {result.baseline.minimum.on}
          </RecordFact>
          <RecordFact label={sv ? "Marginal mot din gräns" : "Reserve headroom"}>
            {amount(result.baseline.headroomMinor)}
          </RecordFact>
        </RecordSummary>
      </RecordSection>
      <RecordSection
        title={
          sv
            ? "Försiktigt, utbetalningar först samma dag"
            : "Conservative, outflows first on the same day"
        }
      >
        <RecordSummary>
          <RecordFact label={sv ? "Lägsta saldo" : "Minimum"}>
            {amount(result.conservative.minimum.amountMinor)}, {result.conservative.minimum.on}
          </RecordFact>
          <RecordFact label={sv ? "Marginal mot din gräns" : "Reserve headroom"}>
            {amount(result.conservative.headroomMinor)}
          </RecordFact>
        </RecordSummary>
      </RecordSection>
      <RecordSection title={sv ? "Saldo per dag" : "Daily balances"}>
        <DataTable
          title={sv ? "Saldo per dag" : "Daily balances"}
          columns={[
            { id: "date", label: sv ? "Datum" : "Date" },
            { id: "inflow", label: sv ? "Inbetalningar" : "Inflows", numeric: true },
            { id: "outflow", label: sv ? "Utbetalningar" : "Outflows", numeric: true },
            { id: "closing", label: sv ? "Vid dagens slut" : "End of day", numeric: true },
            { id: "low", label: sv ? "Lägst under dagen" : "Intraday low", numeric: true },
          ]}
          rows={result.days.map((day) => ({
            id: day.on,
            cells: [
              day.on,
              amount(day.inflowMinor),
              amount(day.outflowMinor),
              amount(day.closingMinor),
              amount(day.conservativeLowMinor),
            ],
          }))}
        />
        <Text>
          {sv
            ? "Vid dagens slut är saldot lika i båda ordningarna. Kolumnen Lägst under dagen visar det lägsta saldot när utbetalningar bokas före inbetalningar."
            : "Both orders end at the same balance. Intraday low assumes outflows before inflows."}
        </Text>
      </RecordSection>
    </Box>
  );
}

function ForecastContributions({ forecast }: { forecast: typeof Cash.CashForecastSnapshot.Type }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const [visible, setVisible] = useState(50);

  return (
    <RecordSection title={sv ? "Poster" : "Contributions"}>
      <DataTable
        title={sv ? "Poster" : "Contributions"}
        columns={[
          { id: "item", label: sv ? "Post" : "Item" },
          { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
          { id: "due", label: sv ? "Förfallodag" : "Due date" },
          { id: "expected", label: sv ? "Förväntad betalningsdag" : "Expected date" },
          { id: "scheduled", label: sv ? "Datum i prognosen" : "Scheduled date" },
          { id: "status", label: sv ? "Status och grund" : "Disposition and reason" },
        ]}
        rows={forecast.contributions.slice(0, visible).map((item, index) => ({
          id: item.invoiceId,
          cells: [
            <Link
              key="item"
              href={`${workspacePath(book)}/${item.direction === "customer" ? "sales" : "purchases"}?view=invoices&record=${encodeURIComponent(item.invoiceId)}`}
            >
              {item.direction === "customer"
                ? sv
                  ? "Kundfordran"
                  : "Receivable"
                : sv
                  ? "Leverantörsskuld"
                  : "Payable"}{" "}
              {index + 1}
            </Link>,
            item.amountMinor === null
              ? sv
                ? "Okänt"
                : "Unknown"
              : `${item.direction === "supplier" ? "−" : "+"}${formatMinorAmount(item.amountMinor, 2, locale)}`,
            item.dueOn,
            item.expectedOn ?? "",
            item.scheduledOn ?? "",
            `${item.disposition}, ${item.reason}`,
          ],
        }))}
      />
      {visible < forecast.contributions.length ? (
        <Button variant="outline" onClick={() => setVisible(visible + 50)}>
          {sv ? "Visa fler" : "Load more"}
        </Button>
      ) : null}
    </RecordSection>
  );
}
