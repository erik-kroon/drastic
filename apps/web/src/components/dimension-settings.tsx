import { useState } from "react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Dimensions from "@open-erp/contracts/dimensions";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

type Item = typeof Dimensions.SaveDimension.Type;

type Value = typeof Dimensions.SaveDimensionValue.Type;

const empty: Item = {
  expectedRevision: 0,
  code: "",
  name: "",
  effectiveFrom: "",
  effectiveTo: null,
  archived: false,
};

type Saved = typeof Dimensions.DimensionSaved.Type | typeof Dimensions.DimensionValueSaved.Type;

type SaveResult =
  | { kind: "dimension"; result: typeof Dimensions.DimensionSaved.Type }
  | { kind: "value"; result: typeof Dimensions.DimensionValueSaved.Type };

type SaveRequest = { kind: "dimension"; item: Item } | { kind: "value"; item: Value };

async function saveDimensionRequest(
  path: string,
  keys: Map<string, string>,
  request: SaveRequest,
): Promise<SaveResult> {
  if (request.kind === "dimension") {
    const result = await readAccounting(
      path,
      Dimensions.DimensionSaved,
      mutationOptions(path, JSON.stringify(request.item), keys),
    );

    return { kind: request.kind, result } as const;
  }

  const target = `${path}/values`;

  const result = await readAccounting(
    target,
    Dimensions.DimensionValueSaved,
    mutationOptions(target, JSON.stringify(request.item), keys),
  );

  return { kind: request.kind, result } as const;
}

function updateSavedForm(
  result: Saved,
  setDimension: (item: Item) => void,
  setValue: (item: Value) => void,
) {
  if ("dimensionCode" in result) {
    setValue({
      expectedRevision: result.revision,
      dimensionCode: result.dimensionCode,
      code: result.code,
      name: result.name,
      effectiveFrom: result.effectiveFrom,
      effectiveTo: result.effectiveTo,
      archived: result.archived,
    });
  } else {
    setDimension({
      expectedRevision: result.revision,
      code: result.code,
      name: result.name,
      effectiveFrom: result.effectiveFrom,
      effectiveTo: result.effectiveTo,
      archived: result.archived,
    });
  }
}

export function DimensionSettings({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const queryClient = useQueryClient();
  const [dimension, setDimension] = useState<Item>(empty);
  const [value, setValue] = useState<Value>({ ...empty, dimensionCode: "" });
  const [saved, setSaved] = useState(false);
  const [keys] = useState(() => new Map<string, string>());
  const path = `${bookPath(book)}/dimensions`;
  const key = [...bookKey(book), "dimensions"];

  const list = useQuery(
    queryOptions({
      queryKey: key,
      queryFn: ({ signal }) => readAccounting(path, Dimensions.DimensionList, { signal }),
    }),
  );

  const save = useMutation<SaveResult, Error, SaveRequest>({
    mutationFn: (request) => saveDimensionRequest(path, keys, request),
    onSuccess: async ({ result }) => {
      updateSavedForm(result, setDimension, setValue);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: () => setSaved(false),
  });

  const sv = locale === "sv";
  const dimensions = list.data?.dimensions ?? [];

  const dimensionCopy =
    dimension.expectedRevision > 0
      ? {
          title: sv ? "Uppdatera dimension" : "Update dimension",
          submit: sv ? "Spara ändring" : "Save update",
        }
      : {
          title: sv ? "Skapa dimension" : "Create dimension",
          submit: sv ? "Skapa dimension" : "Create dimension",
        };

  const valueCopy =
    value.expectedRevision > 0
      ? {
          title: sv ? "Uppdatera värde" : "Update value",
          submit: sv ? "Spara ändring" : "Save update",
        }
      : { title: sv ? "Skapa värde" : "Create value", submit: sv ? "Skapa värde" : "Create value" };

  return (
    <RecordSection title={sv ? "Dimensioner" : "Dimensions"}>
      <Box display="grid" gap="lg" minWidth="zero">
        <Text>
          {sv
            ? "Koder finns kvar när du arkiverar en dimension eller ett värde. Bokförda rader ändras inte."
            : "Archiving a dimension or value keeps its code. Posted lines do not change."}
        </Text>
        <AccountingStatus error={list.error} pending={list.isPending} locale={locale} />
        <DimensionEntries
          dimensions={dimensions}
          locale={locale}
          loading={list.isPending}
          error={list.error}
          onDimension={setDimension}
          onValue={setValue}
          onArchiveDimension={(item) => {
            setSaved(false);
            save.mutate({ kind: "dimension", item: { ...item, archived: true } });
          }}
          onArchiveValue={(item) => {
            setSaved(false);
            save.mutate({ kind: "value", item: { ...item, archived: true } });
          }}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            save.mutate({ kind: "dimension", item: dimension });
          }}
        >
          <Box display="grid" gap="sm">
            <Text>{dimensionCopy.title}</Text>
            <InputField
              label={sv ? "Kod" : "Code"}
              required
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              disabled={dimension.expectedRevision > 0}
              value={dimension.code}
              onChange={(event) => setDimension({ ...dimension, code: event.target.value })}
            />
            <InputField
              label={sv ? "Namn" : "Name"}
              required
              maxLength={120}
              value={dimension.name}
              onChange={(event) => setDimension({ ...dimension, name: event.target.value })}
            />
            <InputField
              label={sv ? "Gäller från" : "Effective from"}
              type="date"
              required
              value={dimension.effectiveFrom}
              onChange={(event) =>
                setDimension({ ...dimension, effectiveFrom: event.target.value })
              }
            />
            <InputField
              label={sv ? "Gäller till (valfritt)" : "Effective to (optional)"}
              type="date"
              min={dimension.effectiveFrom}
              value={dimension.effectiveTo ?? ""}
              onChange={(event) =>
                setDimension({ ...dimension, effectiveTo: event.target.value || null })
              }
            />
            <Box display="flex" gap="sm">
              <Button type="submit" disabled={save.isPending}>
                {dimensionCopy.submit}
              </Button>
              <Button variant="outline" type="button" onClick={() => setDimension(empty)}>
                {sv ? "Ny dimension" : "New dimension"}
              </Button>
            </Box>
          </Box>
        </form>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(false);
            save.mutate({ kind: "value", item: value });
          }}
        >
          <Box display="grid" gap="sm">
            <Text>{valueCopy.title}</Text>
            <label>
              Dimension
              <select
                required
                disabled={value.expectedRevision > 0}
                value={value.dimensionCode}
                onChange={(event) => setValue({ ...value, dimensionCode: event.target.value })}
              >
                <option value="">{sv ? "Välj dimension" : "Select dimension"}</option>
                {dimensions.map((entry) => (
                  <option key={entry.code} value={entry.code}>
                    {entry.code} — {entry.name}
                  </option>
                ))}
              </select>
            </label>
            <InputField
              label={sv ? "Värdekod" : "Value code"}
              required
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              disabled={value.expectedRevision > 0}
              value={value.code}
              onChange={(event) => setValue({ ...value, code: event.target.value })}
            />
            <InputField
              label={sv ? "Namn" : "Name"}
              required
              maxLength={120}
              value={value.name}
              onChange={(event) => setValue({ ...value, name: event.target.value })}
            />
            <InputField
              label={sv ? "Gäller från" : "Effective from"}
              type="date"
              required
              value={value.effectiveFrom}
              onChange={(event) => setValue({ ...value, effectiveFrom: event.target.value })}
            />
            <InputField
              label={sv ? "Gäller till (valfritt)" : "Effective to (optional)"}
              type="date"
              min={value.effectiveFrom}
              value={value.effectiveTo ?? ""}
              onChange={(event) => setValue({ ...value, effectiveTo: event.target.value || null })}
            />
            <Box display="flex" gap="sm">
              <Button type="submit" disabled={save.isPending}>
                {valueCopy.submit}
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => setValue({ ...empty, dimensionCode: value.dimensionCode })}
              >
                {sv ? "Nytt värde" : "New value"}
              </Button>
            </Box>
          </Box>
        </form>
        <AccountingStatus error={save.error} pending={save.isPending} locale={locale} write />
        {saved ? (
          <Text role="status">
            {sv ? "Dimension eller värde har sparats." : "Dimension or value saved."}
          </Text>
        ) : null}
      </Box>
    </RecordSection>
  );
}

function DimensionEntries(props: {
  dimensions: readonly (typeof Dimensions.Dimension.Type)[];
  locale: Locale;
  loading: boolean;
  error: Error | null;
  onDimension: (item: Item) => void;
  onValue: (item: Value) => void;
  onArchiveDimension: (item: Item) => void;
  onArchiveValue: (item: Value) => void;
}) {
  const sv = props.locale === "sv";

  return (
    <>
      {props.dimensions.map((entry) => {
        const dimensionInput: Item = {
          expectedRevision: entry.revision,
          code: entry.code,
          name: entry.name,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
          archived: entry.archived,
        };

        const history = entry.revisions
          .map(
            (revision) =>
              `${revision.revision}: ${revision.name} (${revision.effectiveFrom}–${revision.effectiveTo ?? (sv ? "t.o.m." : "open")}${revision.archived ? (sv ? ", arkiverad" : ", archived") : ""})`,
          )
          .join(" · ");

        return (
          <Box key={entry.code} display="grid" gap="sm">
            <Text>
              {entry.code} — {entry.name}
              {entry.archived ? (sv ? " (arkiverad)" : " (archived)") : ""} · revision{" "}
              {entry.revision}
            </Text>
            <Text>
              {sv ? "Historik" : "History"}: {history}
            </Text>
            <Box display="flex" gap="sm">
              <Button
                variant="outline"
                type="button"
                onClick={() => props.onDimension(dimensionInput)}
              >
                {sv ? "Redigera dimension" : "Edit dimension"}
              </Button>
              {!entry.archived ? (
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => props.onArchiveDimension(dimensionInput)}
                >
                  {sv ? "Arkivera dimension" : "Archive dimension"}
                </Button>
              ) : null}
            </Box>
            {entry.values.map((option) => {
              const valueInput: Value = {
                dimensionCode: entry.code,
                expectedRevision: option.revision,
                code: option.code,
                name: option.name,
                effectiveFrom: option.effectiveFrom,
                effectiveTo: option.effectiveTo,
                archived: option.archived,
              };

              const valueHistory = option.revisions
                .map(
                  (revision) =>
                    `${revision.revision}: ${revision.name} (${revision.effectiveFrom}–${revision.effectiveTo ?? (sv ? "t.o.m." : "open")}${revision.archived ? (sv ? ", arkiverat" : ", archived") : ""})`,
                )
                .join(" · ");

              return (
                <Box key={option.code} display="grid" gap="sm">
                  <Text>
                    {option.code} — {option.name}
                    {option.archived ? (sv ? " (arkiverat)" : " (archived)") : ""} · revision{" "}
                    {option.revision}
                  </Text>
                  <Text>
                    {sv ? "Historik" : "History"}: {valueHistory}
                  </Text>
                  <Box display="flex" gap="sm">
                    <Button
                      variant="outline"
                      type="button"
                      onClick={() => props.onValue(valueInput)}
                    >
                      {sv ? "Redigera värde" : "Edit value"}
                    </Button>
                    {!option.archived ? (
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => props.onArchiveValue(valueInput)}
                      >
                        {sv ? "Arkivera värde" : "Archive value"}
                      </Button>
                    ) : null}
                  </Box>
                </Box>
              );
            })}
          </Box>
        );
      })}
      {!props.loading && !props.error && !props.dimensions.length ? (
        <Text>{sv ? "Inga dimensioner ännu." : "No dimensions yet."}</Text>
      ) : null}
    </>
  );
}
