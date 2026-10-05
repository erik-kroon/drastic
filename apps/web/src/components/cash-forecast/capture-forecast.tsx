import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Cash from "@open-erp/contracts/cash-forecast";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { DataTable } from "@open-erp/ui/components/data-table";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Link } from "@open-erp/ui/components/link";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";
import { decimalToMinor, formatMinorAmount } from "@/lib/workspace-api";

type Scenario = {
  readonly horizonDays: typeof Cash.CaptureCashForecast.Type.horizonDays;
  readonly bufferMinor: string;
  readonly dates: ReadonlyArray<{ readonly invoiceId: string; readonly expectedOn: string }>;
  readonly reason: string;
};

export function CaptureCashForecast({
  view,
  onSaved,
}: {
  view: typeof Cash.CashBasisView.Type;
  onSaved: (id: string) => void;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [horizonDays, setHorizonDays] = useState<Scenario["horizonDays"]>(30);
  const [buffer, setBuffer] = useState("");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);

  const capture = useMutation({
    mutationFn: async (scenario: Scenario) => {
      const expectedDates: Array<(typeof Cash.CaptureCashForecast.Type.expectedDates)[number]> = [];

      if (scenario.dates.length) {
        const path = `${bookPath(book)}/evidence`;

        const evidence = await readAccounting(
          path,
          Accounting.Evidence,
          mutationOptions(
            path,
            JSON.stringify({
              title: sv ? "Förväntade betalningsdagar" : "Expected payment dates",
              content: JSON.stringify({
                basisId: view.basis.id,
                basisDigest: view.basis.digest,
                dates: scenario.dates,
                reason: scenario.reason,
              }),
              mediaType: "application/json",
              origin: "cash-forecast-reviewed-dates",
            }),
            keys.current,
          ),
        );

        for (const entry of scenario.dates)
          expectedDates.push({
            ...entry,
            review: { evidenceId: evidence.id, sha256: evidence.sha256, reason: scenario.reason },
          });
      }

      const input = Schema.decodeSync(Cash.CaptureCashForecast)({
        basisId: view.basis.id,
        basisDigest: view.basis.digest,
        horizonDays: scenario.horizonDays,
        bufferMinor: scenario.bufferMinor,
        expectedDates,
      });

      const path = `${bookPath(book)}/cash-forecasts`;

      return readAccounting(
        path,
        Cash.CashForecastSnapshot,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: [...bookKey(book), "cash-forecasts"] });
    },
  });

  const uncertain = isUncertainWriteError(capture.error);
  const disabled = book.role !== "operator" || capture.isPending || uncertain;
  const overrides = Object.entries(dates).filter(([, expectedOn]) => expectedOn !== "");

  return (
    <Box
      as="form"
      display="grid"
      gap="xl"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();

        if (book.role !== "operator" || capture.isPending) return;

        if (uncertain && capture.variables) {
          capture.mutate(capture.variables, { onSuccess: (forecast) => onSaved(forecast.id) });

          return;
        }

        const minor = decimalToMinor(buffer, 2);

        if (
          minor === null ||
          !Schema.is(Accounting.MinorUnits)(minor) ||
          (overrides.length && !reason.trim())
        ) {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        capture.mutate(
          {
            horizonDays,
            bufferMinor: minor,
            dates: overrides.map(([invoiceId, expectedOn]) => ({ invoiceId, expectedOn })),
            reason: reason.trim(),
          },
          { onSuccess: (forecast) => onSaved(forecast.id) },
        );
      }}
    >
      <RecordSection title={sv ? "Jämförelse" : "Comparison"}>
        <SelectField
          compact
          label={sv ? "Prognosperiod" : "Forecast horizon"}
          value={String(horizonDays)}
          disabled={disabled}
          options={[
            { value: "30", label: sv ? "30 dagar" : "30 days" },
            { value: "90", label: sv ? "90 dagar" : "90 days" },
            { value: "91", label: sv ? "13 veckor, 91 dagar" : "13 weeks, 91 days" },
          ]}
          onValueChange={(value) =>
            setHorizonDays(
              Schema.decodeUnknownSync(Cash.CaptureCashForecast.fields.horizonDays)(Number(value)),
            )
          }
        />
        <InputField
          compact
          label={sv ? "Din gräns, SEK" : "Your reserve, SEK"}
          value={buffer}
          required
          inputMode="decimal"
          disabled={disabled}
          onChange={(event) => setBuffer(event.target.value)}
          aria-invalid={invalid}
        />
        <Text>
          {sv
            ? "Det är ett värde du anger, inte en systemgräns. Ordningen inom en dag är inte känd, så båda ordningarna visas."
            : "This is your reserve target. The order within a day is unknown, so both orders are shown."}
        </Text>
      </RecordSection>
      <RecordSection title={sv ? "Antaganden" : "Assumptions"}>
        <Text>
          {sv
            ? "Förfallodagen ändras inte. En förväntad betalningsdag sparas med din granskningsgrund."
            : "Due dates remain unchanged. Expected payment dates retain your review reason."}
        </Text>
        <ExpectedDates view={view} disabled={disabled} dates={dates} onDates={setDates} />
        {overrides.length ? (
          <InputField
            compact
            label={sv ? "Granskningsgrund för betalningsdagar" : "Date review reason"}
            value={reason}
            required
            maxLength={4000}
            disabled={disabled}
            onChange={(event) => setReason(event.target.value)}
          />
        ) : null}
      </RecordSection>
      {invalid ? (
        <Text role="alert">
          {sv
            ? "Ange en gräns med högst två decimaler och en grund för ändrade betalningsdagar."
            : "Enter a nonnegative reserve with at most two decimals and a reason for changed payment dates."}
        </Text>
      ) : null}
      {!view.dependenciesCurrent ? (
        <Text role="alert">
          {sv
            ? "Inaktuell. Spara ett nytt underlag innan du räknar om som ny version."
            : "Stale. Save a new basis before calculating a new version."}
        </Text>
      ) : null}
      <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} write />
      <Button
        type="submit"
        disabled={
          book.role !== "operator" || capture.isPending || (!uncertain && !view.dependenciesCurrent)
        }
      >
        {uncertain ? (sv ? "Försök igen" : "Retry") : sv ? "Spara bild" : "Save forecast"}
      </Button>
    </Box>
  );
}

function ExpectedDates({
  view,
  disabled,
  dates,
  onDates,
}: {
  view: typeof Cash.CashBasisView.Type;
  disabled: boolean;
  dates: Record<string, string>;
  onDates: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const [visible, setVisible] = useState(50);

  return (
    <Box display="grid" gap="md" minWidth="zero">
      <DataTable
        title={sv ? "Poster och betalningsdagar" : "Items and payment dates"}
        columns={[
          { id: "item", label: sv ? "Post" : "Item" },
          { id: "amount", label: sv ? "Belopp" : "Amount", numeric: true },
          { id: "due", label: sv ? "Förfallodag" : "Due date" },
          { id: "expected", label: sv ? "Förväntad betalningsdag" : "Expected payment date" },
          { id: "status", label: sv ? "Status" : "Status" },
        ]}
        rows={view.basis.contributions.slice(0, visible).map((item, index) => ({
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
              : formatMinorAmount(item.amountMinor, 2, locale),
            item.dueOn,
            <InputField
              key="date"
              compact
              label={`${sv ? "Förväntad betalningsdag" : "Expected payment date"} ${index + 1}`}
              type="date"
              value={dates[item.invoiceId] ?? ""}
              disabled={disabled || item.inclusion !== "included"}
              onChange={(event) =>
                onDates((current) => ({ ...current, [item.invoiceId]: event.target.value }))
              }
            />,
            item.reason,
          ],
        }))}
      />
      {visible < view.basis.contributions.length ? (
        <Button type="button" variant="outline" onClick={() => setVisible(visible + 50)}>
          {sv ? "Visa fler" : "Load more"}
        </Button>
      ) : null}
    </Box>
  );
}
