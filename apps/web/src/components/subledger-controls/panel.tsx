import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Controls from "@open-erp/contracts/subledger-controls";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { DataTable } from "@open-erp/ui/components/data-table";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { PageEmpty, RecordOpen } from "@open-erp/ui/components/accounting-page";
import { Disclosure } from "@open-erp/ui/components/workflow";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { BasisForm } from "./basis-form";
import { ControlInspector, BasisDetails } from "./views";
import { controlCopy } from "./copy";

type Props = {
  book: typeof Accounting.Book.Type;
  setup: typeof Accounting.BookSetup.Type;
  locale: Locale;
};

export function SubledgerControlsPanel(props: Props) {
  return <Panel key={JSON.stringify(bookKey(props.book))} {...props} />;
}

function Panel({ book, setup, locale }: Props) {
  const copy = controlCopy(locale);
  const [id, setId] = useState("");
  const [creating, setCreating] = useState<"basis" | "snapshot" | null>(null);
  const [invalid, setInvalid] = useState(false);
  const base = `${bookPath(book)}/subledger-controls`;

  const bases = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "bases"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${base}/bases`, Controls.SubledgerBasisList, { signal });

      if (
        result.scope.bookId !== book.id ||
        result.scope.entityId !== book.entityId ||
        result.items.some(
          (basis) => basis.scope.bookId !== book.id || basis.scope.entityId !== book.entityId,
        )
      )
        throw new Error("Basis inventory scope mismatch");

      return result;
    },
    retry: false,
  });

  const snapshots = useQuery({
    queryKey: [...bookKey(book), "subledger-controls", "snapshots"],
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${base}/snapshots`, Controls.SubledgerControlList, {
        signal,
      });

      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("Control inventory scope mismatch");

      return result;
    },
    retry: false,
  });

  if (id)
    return (
      <Box display="grid" gap="xl">
        <Box>
          <Button variant="ghost" onClick={() => setId("")}>
            {locale === "sv" ? "Alla kontrollbilder" : "All control snapshots"}
          </Button>
        </Box>
        <ControlInspector key={id} book={book} locale={locale} id={id} />
      </Box>
    );

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <RecordHeading
        title={copy.title}
        subtitle={copy.intro}
        action={<Button onClick={() => setCreating("snapshot")}>{copy.snapshot}</Button>}
      />
      <RecordSection title={copy.savedBases}>
        <Box>
          <Button variant="outline" onClick={() => setCreating("basis")}>
            {copy.basis}
          </Button>
        </Box>
        <AccountingStatus locale={locale} pending={bases.isPending} error={bases.error} />
        {bases.isSuccess && bases.data.items.length === 0 ? <Text>{copy.empty}</Text> : null}
        {bases.isSuccess
          ? bases.data.items.map((basis) => (
              <BasisDetails key={basis.input.scheduleId} basis={basis} locale={locale} />
            ))
          : null}
      </RecordSection>
      <RecordSection title={copy.saved}>
        <AccountingStatus locale={locale} pending={snapshots.isPending} error={snapshots.error} />
        {snapshots.isSuccess && !snapshots.data.items.length ? (
          <PageEmpty
            title={locale === "sv" ? "Inga sparade kontrollbilder" : "No saved control snapshots"}
          />
        ) : null}
        {snapshots.isSuccess && snapshots.data.items.length ? (
          <DataTable
            title={copy.saved}
            columns={[
              { id: "date", label: copy.asOf },
              { id: "saved", label: locale === "sv" ? "Sparad" : "Saved" },
              { id: "sequence", label: copy.sequence, numeric: true },
            ]}
            rows={snapshots.data.items.map((snapshot) => ({
              id: snapshot.id,
              cells: [
                <RecordOpen key="open" onClick={() => setId(snapshot.id)}>
                  {snapshot.asOfDate}
                </RecordOpen>,
                new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                  new Date(snapshot.createdAt),
                ),
                snapshot.sequence,
              ],
            }))}
          />
        ) : null}
      </RecordSection>
      {creating ? (
        <FormDialog
          title={creating === "basis" ? copy.basis : copy.snapshot}
          closeLabel={locale === "sv" ? "Stäng" : "Close"}
          onClose={() => setCreating(null)}
        >
          {creating === "basis" ? (
            <BasisForm book={book} locale={locale} />
          ) : (
            <CaptureControl
              book={book}
              setup={setup}
              locale={locale}
              onSaved={(saved) => {
                setId(saved);
                setCreating(null);
              }}
            />
          )}
        </FormDialog>
      ) : null}
      <Box>
        <Button
          variant="ghost"
          disabled={bases.isFetching || snapshots.isFetching}
          onClick={() => {
            void bases.refetch();
            void snapshots.refetch();
          }}
        >
          {copy.refresh}
        </Button>
      </Box>
      <Disclosure title={locale === "sv" ? "Öppna med referens" : "Open by reference"}>
        <Box
          as="form"
          display="grid"
          gap="md"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("id");

            if (!Schema.is(Accounting.Identifier)(value)) {
              setInvalid(true);

              return;
            }

            setInvalid(false);
            setId(value);
          }}
        >
          <InputField name="id" label={copy.open} required />
          <Button type="submit" variant="outline">
            {copy.open}
          </Button>
          <Text role="status">{invalid ? copy.invalid : ""}</Text>
        </Box>
      </Disclosure>
      <Disclosure
        title={locale === "sv" ? "Omfattning och begränsningar" : "Scope and limitations"}
      >
        <Text>{copy.warning}</Text>
      </Disclosure>
    </Box>
  );
}

function CaptureControl({
  book,
  setup,
  locale,
  onSaved,
}: Props & { onSaved: (id: string) => void }) {
  const copy = controlCopy(locale);
  const [invalid, setInvalid] = useState(false);
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();

  const save = useMutation({
    mutationFn: async (input: typeof Controls.CreateSubledgerControl.Type) => {
      const path = `${bookPath(book)}/subledger-controls/snapshots`;

      const result = await readAccounting(
        path,
        Controls.SubledgerControl,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );

      if (result.scope.bookId !== book.id || result.scope.entityId !== book.entityId)
        throw new Error("Control snapshot scope mismatch");

      return result;
    },
    onSuccess: async (result) => {
      onSaved(result.id);
      await client.invalidateQueries({ queryKey: [...bookKey(book), "subledger-controls"] });
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
        const fields = new FormData(event.currentTarget);

        const decoded = Schema.decodeUnknownOption(Controls.CreateSubledgerControl)({
          asOfDate: fields.get("asOfDate"),
          accountIds: fields.getAll("accountIds"),
          inventoryEvidenceId: fields.get("inventoryEvidenceId"),
          rationale: fields.get("rationale"),
        });

        if (decoded._tag === "None") {
          setInvalid(true);

          return;
        }

        setInvalid(false);
        save.mutate(decoded.value);
      }}
    >
      <Text>{copy.accountsHelp}</Text>
      <Box
        as="fieldset"
        disabled={save.isPending}
        display="grid"
        gap="lg"
        minWidth="zero"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        <InputField name="asOfDate" label={copy.asOf} type="date" required />
        <InputField name="inventoryEvidenceId" label={copy.inventory} required />
        <InputField name="rationale" label={copy.rationale} maxLength={2000} required />
        <Box
          as="fieldset"
          display="grid"
          gap="md"
          minWidth="zero"
          padding="md"
          borderWidth="thin"
          borderColor="default"
          borderRadius="control"
        >
          <legend>{copy.accounts}</legend>
          {setup.accounts.map((account) => (
            <Box
              as="label"
              key={account.id}
              display="flex"
              gap="md"
              alignItems="center"
              paddingBlock="md"
            >
              <input name="accountIds" type="checkbox" value={account.id} />
              <Text>
                {account.code} · {account.name} · {account.id}
              </Text>
            </Box>
          ))}
        </Box>
        <Text>{copy.retry}</Text>
        <Button type="submit" size="xl">
          {copy.capture}
        </Button>
      </Box>
      <Text role="status">{invalid ? copy.invalid : save.isSuccess ? copy.savedSnapshot : ""}</Text>
      {save.isSuccess ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            keys.current.clear();
            save.reset();
          }}
        >
          {copy.newSnapshot}
        </Button>
      ) : null}
      <AccountingStatus write locale={locale} pending={save.isPending} error={save.error} />
    </Box>
  );
}
