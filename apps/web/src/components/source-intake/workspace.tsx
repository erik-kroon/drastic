import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Intake from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { workQueryOptions, minorToDecimal, signedDecimalToMinor } from "@/lib/workspace-api";
import { statementFormat } from "@/lib/statement-format";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { IntakeProps } from "./index";
import { intakeCopy } from "./copy";
import { PreviewReview } from "./review";
import { downloadIntake } from "./download";

function retainedText(content: string, unavailable: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(content), (char) => char.charCodeAt(0)),
    );
  } catch {
    return unavailable;
  }
}

export function SourceWorkspace({ book, setup, locale, id }: IntakeProps & { id: string }) {
  const copy = intakeCopy(locale);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);
  const [mappingSeed, setMappingSeed] = useState<typeof Intake.SourcePreview.Type | null>(null);
  const source = useQuery({
    queryKey: [...bookKey(book), "source-occurrence", id],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        `${bookPath(book)}/source-occurrences/${encodeURIComponent(id)}`,
        Intake.SourceOccurrenceView,
        { signal },
      );
      if (
        view.occurrence.id !== id ||
        view.occurrence.scope.bookId !== book.id ||
        view.occurrence.scope.entityId !== book.entityId
      )
        throw new Error("Source scope mismatch");
      return view;
    },
  });
  const previewId = selectedPreview ?? source.data?.latestPreviewId;
  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <RecordHeading
        title={
          source.data?.occurrence.filename ?? (locale === "sv" ? "Kontoutdrag" : "Bank statement")
        }
        subtitle={
          locale === "sv" ? "Original → förhandsgranskning → import" : "Original → preview → import"
        }
        action={
          <Box display="flex" gap="md" flexWrap="wrap">
            {" "}
            <Box>
              <Button
                type="button"
                variant="outline"
                disabled={source.isFetching}
                onClick={() => {
                  void source.refetch();
                }}
              >
                {copy.refresh}
              </Button>
            </Box>
            {source.data ? (
              <>
                {" "}
                <Box>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (source.data)
                        downloadIntake(
                          new Blob(
                            [
                              Uint8Array.from(atob(source.data.contentBase64), (char) =>
                                char.charCodeAt(0),
                              ),
                            ],
                            { type: "application/octet-stream" },
                          ),
                          source.data.occurrence.filename,
                        );
                    }}
                  >
                    {copy.download}
                  </Button>
                </Box>
              </>
            ) : null}
          </Box>
        }
      />
      <AccountingStatus locale={locale} pending={source.isPending} error={source.error} />
      {source.data ? (
        <>
          <Text tone="muted">{source.data.occurrence.byteLength} bytes</Text>
          {source.data.occurrence.mediaType.startsWith("text/") &&
          source.data.occurrence.byteLength <= 65536 ? (
            <details>
              <summary>{copy.original}</summary>
              <Box
                overflow="auto"
                minWidth="zero"
                tabIndex={0}
                role="region"
                aria-label={copy.original}
              >
                <pre>{retainedText(source.data.contentBase64, copy.plainUnavailable)}</pre>
              </Box>
            </details>
          ) : null}
          {source.data.admission ? (
            previewId ? null : (
              <Text role="status">{copy.admitted}</Text>
            )
          ) : source.data.occurrence.mediaType === "text/csv" &&
            source.data.occurrence.byteLength <= 65536 ? (
            !previewId || mappingSeed ? (
              <MappingForm
                key={mappingSeed?.id ?? id}
                book={book}
                setup={setup}
                locale={locale}
                id={id}
                initial={mappingSeed?.mapping}
                contentBase64={source.data.contentBase64}
                onCreated={(preview) => {
                  setSelectedPreview(preview.id);
                  setMappingSeed(null);
                  void source.refetch();
                }}
              />
            ) : null
          ) : (
            <Text>{copy.retainedOnly}</Text>
          )}
          {source.data.previewIds.length > 1 ? (
            <Box
              as="form"
              display="grid"
              gap="md"
              onSubmit={(event) => {
                event.preventDefault();
                const selected = new FormData(event.currentTarget).get("previewId");
                if (typeof selected === "string") setSelectedPreview(selected);
              }}
            >
              <SelectField
                name="previewId"
                label={copy.previewId}
                required
                options={source.data.previewIds.map((value, index) => ({
                  value,
                  label: `${locale === "sv" ? "Granskning" : "Preview"} ${index + 1}`,
                }))}
              />
              <Box>
                <Button type="submit" variant="outline">
                  {copy.openPreview}
                </Button>
              </Box>
            </Box>
          ) : null}
        </>
      ) : null}
      {previewId ? (
        <PreviewReview
          key={previewId}
          book={book}
          setup={setup}
          locale={locale}
          id={previewId}
          occurrenceId={id}
          onEdit={setMappingSeed}
        />
      ) : null}
    </Box>
  );
}

function MappingForm(
  props: IntakeProps & {
    id: string;
    initial?: typeof Intake.CsvMapping.Type;
    contentBase64: string;
    onCreated: (preview: typeof Intake.SourcePreview.Type) => void;
  },
) {
  const { book, setup, locale, id } = props;
  const suggestions = statementFormat(props.contentBase64);
  const initial = props.initial;
  const format = initial ?? suggestions.fields;
  const metadata = useQuery(workQueryOptions(book, {}));
  const scale = initial?.currencyScale ?? metadata.data?.currencyScale;
  const copy = intakeCopy(locale);
  const keys = useRef(new Map<string, string>());
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: (input: typeof Intake.CsvMapping.Type) => {
      const path = `${bookPath(book)}/source-occurrences/${encodeURIComponent(id)}/previews`;
      return readAccounting(
        path,
        Intake.SourcePreview,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: props.onCreated,
  });
  const choices = {
    delimiter: [
      { value: ",", label: copy.comma },
      { value: ";", label: copy.semicolon },
      { value: "\t", label: copy.tab },
    ],
    lineEnding: [
      { value: "lf", label: copy.lf },
      { value: "crlf", label: copy.crlf },
    ],
    dateFormat: ["YYYY-MM-DD", "DD/MM/YYYY"].map((value) => ({ value, label: value })),
    decimalSeparator: [
      { value: ".", label: copy.dot },
      { value: ",", label: copy.comma },
    ],
    sign: [
      { value: "inflow_positive", label: copy.inflow_positive },
      { value: "outflow_positive", label: copy.outflow_positive },
    ],
    accountId: setup.accounts
      .filter((account) => account.active)
      .map((account) => ({
        value: account.id,
        label: `${account.code} · ${account.name}`,
      })),
  };
  if (scale === undefined)
    return <AccountingStatus locale={locale} pending={metadata.isPending} error={metadata.error} />;
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);
        const result = Schema.decodeUnknownOption(Intake.CsvMapping)({
          profile: "bank_csv_utf8_v1",
          ...Object.fromEntries(fields),
          currency: book.currency,
          currencyScale: scale,
          openingMinor: mappingAmount(fields, "openingMinor", scale),
          closingMinor: mappingAmount(fields, "closingMinor", scale),
          providerIdColumn: fields.get("providerIdColumn") || null,
          completeness: {
            declaredComplete: fields.get("declaredComplete") === "on",
            basis: fields.get("basis"),
          },
        });
        if (result._tag === "None") {
          setError(
            locale === "sv"
              ? "Kontrollera kolumner, filformat, konto, datum och saldon."
              : "Check the columns, file format, account, dates and balances.",
          );
          return;
        }
        setError("");
        mutation.mutate(result.value);
      }}
    >
      <RecordSection
        title={locale === "sv" ? "Kontrollera filens kolumner" : "Map the statement columns"}
      >
        <Text>{book.currency}</Text>
      </RecordSection>
      <Text>{copy.previewHelp}</Text>
      <Box
        as="fieldset"
        disabled={mutation.isPending}
        display="grid"
        gap="md"
        minWidth="zero"
        padding="none"
        margin="none"
        borderWidth="none"
      >
        <Disclosure
          title={locale === "sv" ? "Filformat" : "File format"}
          defaultOpen={
            ![
              format.delimiter,
              format.lineEnding,
              format.dateFormat,
              format.decimalSeparator,
            ].every(Boolean)
          }
        >
          <Box display="grid" columns={2} gap="md" paddingBlock="lg">
            {(["delimiter", "lineEnding", "dateFormat", "decimalSeparator"] as const).map(
              (name) => (
                <SelectField
                  key={name}
                  label={copy[name]}
                  name={name}
                  defaultValue={format[name] ?? ""}
                  options={[{ value: "", label: copy.choose }, ...choices[name]]}
                />
              ),
            )}
          </Box>
        </Disclosure>
        <Box display="grid" columns={1} columnsAtSm={2} gap="md">
          {(["dateColumn", "descriptionColumn", "amountColumn", "providerIdColumn"] as const).map(
            (name) => (
              <InputField
                key={name}
                label={copy[name]}
                name={name}
                defaultValue={format[name] ?? ""}
                suggestions={suggestions.headers}
                maxLength={200}
                required={name !== "providerIdColumn"}
              />
            ),
          )}
        </Box>
        <RecordSection
          title={locale === "sv" ? "Konto och kontoutdragsperiod" : "Account and statement period"}
        >
          <Text tone="muted">{copy.controlsHelp}</Text>
        </RecordSection>
        <Box display="grid" columns={1} columnsAtSm={2} gap="md">
          {(["accountId", "sign"] as const).map((name) => (
            <SelectField
              key={name}
              label={copy[name]}
              name={name}
              required
              defaultValue={initial?.[name] ?? ""}
              options={[{ value: "", label: copy.choose }, ...choices[name]]}
            />
          ))}
          {(["startsOn", "endsOn"] as const).map((name) => (
            <InputField
              key={name}
              label={copy[name]}
              name={name}
              type="date"
              defaultValue={initial?.[name]}
              required
            />
          ))}
          {(["openingMinor", "closingMinor"] as const).map((name) => (
            <InputField
              key={name}
              label={`${name === "openingMinor" ? (locale === "sv" ? "Ingående saldo" : "Opening balance") : locale === "sv" ? "Utgående saldo" : "Closing balance"} · ${book.currency}`}
              name={name}
              defaultValue={initial ? minorToDecimal(initial[name], scale) : ""}
              inputMode="decimal"
              required
            />
          ))}
        </Box>
        <InputField
          label={copy.declaredComplete}
          name="declaredComplete"
          type="checkbox"
          defaultChecked={initial?.completeness.declaredComplete ?? false}
        />
        <InputField
          label={copy.basis}
          name="basis"
          defaultValue={initial?.completeness.basis}
          required
          maxLength={2000}
        />
        <Box>
          <Button type="submit" size="xl">
            {copy.preview}
          </Button>
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus locale={locale} pending={mutation.isPending} error={mutation.error} write />
    </Box>
  );
}

function mappingAmount(fields: FormData, name: string, scale: number) {
  const value = fields.get(name);
  return typeof value === "string" ? signedDecimalToMinor(value, scale) : null;
}
