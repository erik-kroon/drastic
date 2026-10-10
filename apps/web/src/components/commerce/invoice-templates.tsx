import { useCommandKeys } from "@/lib/command-keys";
import { useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import * as Templates from "@open-erp/contracts/invoice-templates";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, SelectField } from "@open-erp/ui/components/field";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import { checkScope, commercePath, type CommerceProps } from "./shared";

const templateCopy = {
  sv: {
    applyReason: "Använd fakturamall",
    saveAs: "Spara som mall",
    templates: "Fakturamallar",
    origin: "Från mall, version",
    saveTitle: "Spara fakturamall",
    close: "Stäng",
    name: "Mallnamn",
    reason: "Anledning",
    reuseReason: "Återanvänd fakturainnehåll",
    description:
      "Mallen sparar rader, villkor och meddelande. Kund och datum väljs för varje utkast.",
    save: "Spara mall",
    invalid: "Kontrollera obligatoriska fält och datum.",
    template: "Mall",
    choose: "Välj mall",
    load: "Visa fler mallar",
    customer: "Kund för nytt utkast:",
    invoiceDate: "Fakturadatum",
    supplyDate: "Leveransdatum",
    dueDate: "Förfallodatum",
    newDraft: "Nytt utkast från mall",
    replace: "Ersätt sparat utkastinnehåll…",
    replaceDescription:
      "Rubrik, rader, villkor och meddelande ersätts i det sparade utkastet. Kund och datum behålls.",
    confirm: "Bekräfta ersättning",
    updateReason: "Uppdatera mall från sparat utkast",
    update: "Uppdatera mallen från utkastet",
    archiveReason: "Arkivera fakturamall",
    archive: "Arkivera mall",
  },
  en: {
    applyReason: "Apply invoice content template",
    saveAs: "Save as template",
    templates: "Invoice templates",
    origin: "From template, revision",
    saveTitle: "Save invoice template",
    close: "Close",
    name: "Template name",
    reason: "Reason",
    reuseReason: "Reuse invoice content",
    description:
      "The template keeps rows, terms and the note. Customer and dates are chosen for each draft.",
    save: "Save template",
    invalid: "Check the required fields and dates.",
    template: "Template",
    choose: "Choose template",
    load: "Load more templates",
    customer: "Customer for the new draft:",
    invoiceDate: "Invoice date",
    supplyDate: "Supply date",
    dueDate: "Due date",
    newDraft: "New draft from template",
    replace: "Replace saved draft content…",
    replaceDescription:
      "This replaces the saved draft’s title, rows, terms and note. Customer and dates stay as saved.",
    confirm: "Confirm replacement",
    updateReason: "Update template from saved draft",
    update: "Update template from this draft",
    archiveReason: "Archive invoice template",
    archive: "Archive template",
  },
};

type Draft = typeof Drafts.InvoiceDraftRevision.Type;

type CommercialDraft = Extract<Draft, { purpose: "commercial" }>;

export function InvoiceTemplateActions(
  props: CommerceProps & { record: Draft; editable: boolean; onSaved: (id: string) => void },
) {
  return props.record.purpose === "commercial" ? (
    <CommercialTemplateActions {...props} record={props.record} />
  ) : null;
}

function dateField(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value : null;
}

function contentOf(record: CommercialDraft) {
  return {
    title: record.commercialInput.title,
    paymentTerms: record.commercialInput.paymentTerms,
    note: record.commercialInput.note ?? null,
    lines: record.commercialInput.lines,
  };
}

function CommercialTemplateActions(
  props: CommerceProps & {
    record: CommercialDraft;
    editable: boolean;
    onSaved: (id: string) => void;
  },
) {
  const copy = templateCopy[props.locale === "sv" ? "sv" : "en"];
  const [mode, setMode] = useState<"save" | "use" | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const keys = useCommandKeys();
  const [draftKey] = useState(() => `template_${crypto.randomUUID().replaceAll("-", "")}`);
  const client = useQueryClient();
  const router = useRouter();
  const path = `${commercePath(props.book)}/invoice-templates`;

  const list = useInfiniteQuery({
    queryKey: [...bookKey(props.book), "invoice-templates"],
    enabled: mode === "use",
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const result = await readAccounting(
        `${path}${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Templates.InvoiceTemplatePage,
        { signal },
      );

      checkScope(props.book, result.scope);

      return result;
    },
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const templates = list.data?.pages.flatMap((page) => page.items) ?? [];
  const selected = templates.find((item) => item.id === selectedId);

  const save = useMutation({
    mutationFn: async (command: { path: string; input: unknown; apply: boolean }) => {
      const options = keys.current.options(command.path, JSON.stringify(command.input));

      if (command.apply) {
        const result = await readAccounting(command.path, Drafts.InvoiceDraftRevision, options);
        checkScope(props.book, result.scope);

        return { kind: "draft" as const, record: result };
      }

      const result = await readAccounting(command.path, Templates.InvoiceTemplateRevision, options);
      checkScope(props.book, result.scope);

      return { kind: "template" as const, record: result };
    },
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: bookKey(props.book) });
      const location = router.state.location;

      if (
        location.pathname !== `${workspacePath(props.book)}/sales` ||
        location.search.record !== props.record.id
      )
        return;

      if (result.kind === "draft") props.onSaved(result.record.id);
      setMode(null);
      setReplaceConfirmed(false);
    },
    retry: false,
  });

  const close = () => {
    if (!save.isPending) setMode(null);
  };

  function submit<S extends Schema.Top & { readonly DecodingServices: never }>(
    schema: S,
    commandPath: string,
    value: unknown,
    applyDraft: boolean,
  ) {
    const input = Schema.decodeUnknownOption(schema)(value);
    setInvalid(Option.isNone(input));

    if (Option.isSome(input) && !save.isPending)
      save.mutate({ path: commandPath, input: input.value, apply: applyDraft });
  }

  function apply(target: (typeof Templates.ApplyInvoiceTemplate.Type)["target"]) {
    if (!selected || save.isPending) return;
    submit(
      Templates.ApplyInvoiceTemplate,
      `${path}/${selected.id}/applications`,
      {
        revision: selected.revision,
        digest: selected.digest,
        target,
        reason: copy.applyReason,
      },
      true,
    );
  }

  return (
    <>
      <Button
        variant="outline"
        disabled={props.book.role !== "operator"}
        onClick={() => {
          save.reset();
          setInvalid(false);
          setMode("save");
        }}
      >
        {copy.saveAs}
      </Button>
      <Button
        variant="outline"
        disabled={props.book.role !== "operator"}
        onClick={() => {
          save.reset();
          setInvalid(false);
          setMode("use");
          setReplaceConfirmed(false);
        }}
      >
        {copy.templates}
      </Button>
      {props.record.templateSelection ? (
        <Text tone="muted">
          {copy.origin} {props.record.templateSelection.revision}
        </Text>
      ) : null}
      {mode === "save" ? (
        <FormDialog
          title={copy.saveTitle}
          closeLabel={copy.close}
          onClose={close}
          onEscape={close}
          size="compact"
        >
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();

              if (save.isPending) return;
              const fields = new FormData(event.currentTarget);
              submit(
                Templates.CreateInvoiceTemplate,
                path,
                {
                  name: fields.get("name"),
                  currency: props.record.content.currency,
                  currencyScale: props.record.content.currencyScale,
                  content: contentOf(props.record),
                  reason: fields.get("reason"),
                },
                false,
              );
            }}
          >
            <InputField
              name="name"
              label={copy.name}
              required
              maxLength={200}
              defaultValue={props.record.content.title}
            />
            <InputField
              name="reason"
              label={copy.reason}
              required
              defaultValue={copy.reuseReason}
            />
            <Text>{copy.description}</Text>
            <Button type="submit" disabled={save.isPending}>
              {copy.save}
            </Button>
            {invalid ? <Text role="alert">{copy.invalid}</Text> : null}
            <AccountingStatus
              locale={props.locale}
              pending={save.isPending}
              error={save.error}
              write
            />
          </Box>
        </FormDialog>
      ) : null}
      {mode === "use" ? (
        <FormDialog
          title={copy.templates}
          closeLabel={copy.close}
          onClose={close}
          onEscape={close}
          size="compact"
        >
          <Box
            as="form"
            display="grid"
            gap="md"
            onSubmit={(event) => {
              event.preventDefault();
              const fields = new FormData(event.currentTarget);
              const source = props.record.commercialInput;
              apply({
                kind: "new",
                draftKey,
                context: {
                  counterpartyId: source.counterpartyId,
                  counterpartyRevision: source.counterpartyRevision,
                  seller: source.seller,
                  customer: source.customer,
                  plannedIssueDate: dateField(fields, "issueDate"),
                  supplyDate: dateField(fields, "supplyDate"),
                  dueDate: dateField(fields, "dueDate"),
                },
              });
            }}
          >
            <SelectField
              label={copy.template}
              value={selectedId}
              onValueChange={(value) => {
                setSelectedId(value ?? "");
                setReplaceConfirmed(false);
              }}
              options={[
                { value: "", label: copy.choose },
                ...templates.map((item) => ({
                  value: item.id,
                  label: `${item.name}, ${item.currency}, ${item.revision}`,
                })),
              ]}
            />
            {list.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                disabled={list.isFetching}
                onClick={() => void list.fetchNextPage()}
              >
                {copy.load}
              </Button>
            ) : null}
            <Text>
              {copy.customer} {props.record.content.customer.legalName}
            </Text>
            <InputField name="issueDate" type="date" label={copy.invoiceDate} required />
            <InputField name="supplyDate" type="date" label={copy.supplyDate} required />
            <InputField name="dueDate" type="date" label={copy.dueDate} required />
            <Button type="submit" disabled={!selected || save.isPending}>
              {copy.newDraft}
            </Button>
            {props.editable ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selected || save.isPending}
                  onClick={() => setReplaceConfirmed(true)}
                >
                  {copy.replace}
                </Button>
                {replaceConfirmed ? (
                  <>
                    <Text>{copy.replaceDescription}</Text>
                    <Button
                      type="button"
                      disabled={save.isPending}
                      onClick={() =>
                        apply({
                          kind: "existing",
                          id: props.record.id,
                          expectedRevision: props.record.revision,
                          expectedDigest: props.record.digest,
                          acknowledgeReplace: true,
                        })
                      }
                    >
                      {copy.confirm}
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {selected ? (
              <Box display="flex" gap="sm" flexWrap="wrap">
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() =>
                    submit(
                      Templates.ReviseInvoiceTemplate,
                      `${path}/${selected.id}/revisions`,
                      {
                        expectedRevision: selected.revision,
                        expectedDigest: selected.digest,
                        name: selected.name,
                        content: contentOf(props.record),
                        reason: copy.updateReason,
                      },
                      false,
                    )
                  }
                >
                  {copy.update}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() =>
                    submit(
                      Templates.ArchiveInvoiceTemplate,
                      `${path}/${selected.id}/archive`,
                      {
                        expectedRevision: selected.revision,
                        expectedDigest: selected.digest,
                        reason: copy.archiveReason,
                      },
                      false,
                    )
                  }
                >
                  {copy.archive}
                </Button>
              </Box>
            ) : null}
            {invalid ? <Text role="alert">{copy.invalid}</Text> : null}
            <AccountingStatus
              locale={props.locale}
              pending={list.isFetching || save.isPending}
              error={save.error ?? list.error}
              write={save.isPending || save.isError}
            />
          </Box>
        </FormDialog>
      ) : null}
    </>
  );
}
