import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Intake from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { intakeCopy } from "./copy";
import { SourceWorkspace } from "./workspace";

export interface IntakeProps {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
}

export function SourceIntake(props: IntakeProps) {
  return <IntakeWorkspace key={`${props.book.entityId}/${props.book.id}`} {...props} />;
}

function IntakeWorkspace(props: IntakeProps) {
  const { book, locale } = props;
  const copy = intakeCopy(locale);
  const [selected, setSelected] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const inventory = useQuery({
    queryKey: [...bookKey(book), "source-occurrences", cursor],
    retry: false,
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/source-occurrences${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        Intake.SourceInventory,
        { signal },
      ),
  });
  return (
    <details id="source-intake" tabIndex={-1}>
      <summary>{copy.title}</summary>
      <Box display="grid" gap="xl" paddingBlock="xl" minWidth="zero">
        <Heading>{copy.title}</Heading>
        <Text>{copy.scope}</Text>
        <Text>{copy.limits}</Text>
        <RetainForm book={book} locale={locale} onRetained={setSelected} />
        <Heading>{copy.inventory}</Heading>
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            type="button"
            variant="outline"
            disabled={inventory.isFetching}
            onClick={() => {
              void inventory.refetch();
            }}
          >
            {copy.refresh}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!cursor || inventory.isFetching}
            onClick={() => setCursor(null)}
          >
            {copy.first}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!inventory.data?.nextCursor || inventory.isFetching}
            onClick={() => setCursor(inventory.data?.nextCursor ?? null)}
          >
            {copy.next}
          </Button>
        </Box>
        <AccountingStatus locale={locale} pending={inventory.isPending} error={inventory.error} />
        {inventory.data?.items.length === 0 ? <Text>{copy.empty}</Text> : null}
        {inventory.data?.items.map((item) => (
          <Box key={item.occurrence.id} display="grid" gap="sm" minWidth="zero">
            <Text>
              {item.occurrence.filename} · {item.occurrence.sourceSystem} ·{" "}
              {item.occurrence.sourceAccountId}
            </Text>
            <Text>
              {item.occurrence.occurrenceKey} / {item.occurrence.sourceRevision} ·{" "}
              {item.occurrence.retainedAt}
            </Text>
            <Text>{item.admission ? copy.admitted : item.occurrence.id}</Text>
            <Box>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelected(item.occurrence.id)}
              >
                {copy.load}: {item.occurrence.id}
              </Button>
            </Box>
          </Box>
        ))}
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const id = new FormData(event.currentTarget).get("id");
            if (Schema.is(Accounting.Identifier)(id)) setSelected(id);
          }}
        >
          <InputField label={copy.load} name="id" required pattern="[a-z][a-z0-9_\-]{2,127}" />
          <Box>
            <Button type="submit" variant="outline">
              {copy.load}
            </Button>
          </Box>
        </Box>
        {selected ? (
          <SourceWorkspace key={`${book.id}/${selected}`} {...props} id={selected} />
        ) : null}
      </Box>
    </details>
  );
}

function RetainForm({
  book,
  locale,
  onRetained,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onRetained: (id: string) => void;
}) {
  const copy = intakeCopy(locale);
  const client = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [error, setError] = useState("");
  const mutation = useMutation({
    mutationFn: async ({
      file,
      fields,
    }: {
      file: File;
      fields: Record<string, FormDataEntryValue | null>;
    }) => {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        throw new Error(copy.readFailure);
      }
      const input = Schema.decodeUnknownSync(Intake.RetainSource)({
        ...fields,
        filename: file.name,
        contentBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
      });
      const path = `${bookPath(book)}/source-occurrences`;
      return readAccounting(
        path,
        Intake.SourceOccurrence,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
    onSuccess: (occurrence) => {
      onRetained(occurrence.id);
      void client.invalidateQueries({ queryKey: [...bookKey(book), "source-occurrences"] });
    },
  });
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const file = data.get("file");
        if (!(file instanceof File) || file.size < 1 || file.size > 65536) {
          setError(copy.invalidFile);
          return;
        }
        const fields = {
          sourceSystem: data.get("sourceSystem"),
          sourceAccountId: data.get("sourceAccountId"),
          occurrenceKey: data.get("occurrenceKey"),
          sourceRevision: data.get("sourceRevision"),
        };
        setError("");
        mutation.mutate({ file, fields });
      }}
    >
      <Heading>{copy.retain}</Heading>
      <Text>{copy.identityHelp}</Text>
      <Box
        as="fieldset"
        disabled={mutation.isPending}
        display="grid"
        gap="md"
        minWidth="zero"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        <InputField label={copy.file} name="file" type="file" accept=".csv,text/csv" required />
        {(["sourceSystem", "sourceAccountId", "occurrenceKey", "sourceRevision"] as const).map(
          (name) => (
            <InputField key={name} label={copy[name]} name={name} maxLength={200} required />
          ),
        )}
        <Box>
          <Button type="submit" size="xl">
            {copy.retain}
          </Button>
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus locale={locale} pending={mutation.isPending} error={mutation.error} write />
    </Box>
  );
}
