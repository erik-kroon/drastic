import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Intake from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
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
      <Heading>{copy.original}</Heading>
      <Text>{id}</Text>
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
      <AccountingStatus locale={locale} pending={source.isPending} error={source.error} />
      {source.data ? (
        <>
          <Text>
            {source.data.occurrence.filename} · {source.data.occurrence.byteLength} bytes ·{" "}
            {source.data.occurrence.sha256}
          </Text>
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
            <Text role="status">
              {copy.admitted} {source.data.admission.imported.statement.id}
            </Text>
          ) : source.data.occurrence.mediaType === "text/csv" &&
            source.data.occurrence.byteLength <= 65536 ? (
            <MappingForm
              key={mappingSeed?.id ?? id}
              book={book}
              setup={setup}
              locale={locale}
              id={id}
              initial={mappingSeed?.mapping}
              onCreated={(preview) => {
                setSelectedPreview(preview.id);
                void source.refetch();
              }}
            />
          ) : (
            <Text>{copy.retainedOnly}</Text>
          )}
          {source.data.previewIds.length > 0 ? (
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
                options={source.data.previewIds.map((value) => ({ value, label: value }))}
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
    onCreated: (preview: typeof Intake.SourcePreview.Type) => void;
  },
) {
  const { book, setup, locale, id } = props;
  const initial = props.initial;
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
        label: `${account.code} · ${account.name} · ${account.id}`,
      })),
  };
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
          currencyScale:
            fields.get("currencyScale") === "" ? null : Number(fields.get("currencyScale")),
          providerIdColumn: fields.get("providerIdColumn") || null,
          completeness: {
            declaredComplete: fields.get("declaredComplete") === "on",
            basis: fields.get("basis"),
          },
        });
        if (result._tag === "None") {
          setError(copy.invalid);
          return;
        }
        setError("");
        mutation.mutate(result.value);
      }}
    >
      <Heading>{copy.preview}</Heading>
      <Text>{copy.previewHelp}</Text>
      <Text>{copy.controlsHelp}</Text>
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
        <Box display="grid" columns={1} columnsAtSm={2} gap="md">
          {(
            [
              "delimiter",
              "lineEnding",
              "dateFormat",
              "decimalSeparator",
              "sign",
              "accountId",
            ] as const
          ).map((name) => (
            <SelectField
              key={name}
              label={copy[name]}
              name={name}
              defaultValue={initial?.[name] ?? ""}
              required
              options={[{ value: "", label: copy.choose }, ...choices[name]]}
            />
          ))}
          {(["dateColumn", "descriptionColumn", "amountColumn", "providerIdColumn"] as const).map(
            (name) => (
              <InputField
                key={name}
                label={copy[name]}
                name={name}
                defaultValue={initial?.[name] ?? ""}
                maxLength={200}
                required={name !== "providerIdColumn"}
              />
            ),
          )}
          <InputField
            label={copy.currency}
            name="currency"
            defaultValue={initial?.currency ?? ""}
            pattern="[A-Z]{3}"
            maxLength={3}
            required
          />
          <InputField
            label={copy.currencyScale}
            name="currencyScale"
            defaultValue={initial?.currencyScale}
            type="number"
            min={0}
            max={6}
            step={1}
            required
          />
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
              label={copy[name]}
              name={name}
              defaultValue={initial?.[name]}
              pattern="(0|-?[1-9][0-9]{0,37})"
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
