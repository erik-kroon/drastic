import { useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { FormActions } from "@open-erp/ui/components/form-actions";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { sendSavedPostingCommand } from "@/components/posting-recovery/request";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { checkScope, type CommerceProps } from "@/components/commerce/shared";

class InvalidRecordInput extends Error {}

type CapturedEntry = {
  key: string;
  source: typeof Accounting.CreateEvidence.Type;
  build: (evidence: typeof Accounting.Evidence.Type) => unknown;
};

/** Retain entered facts before the owning command, keeping both operations stable on retry. */
export function EvidenceCommandForm<
  S extends Schema.Top & { readonly DecodingServices: never },
  O extends Schema.Top & { readonly DecodingServices: never },
>(
  props: CommerceProps & {
    path: string;
    schema: S;
    output: O;
    source: (fields: FormData) => typeof Accounting.CreateEvidence.Type;
    input: (fields: FormData, evidence: typeof Accounting.Evidence.Type) => unknown;
    label: string;
    canSubmit?: boolean;
    stickyFooter?: boolean;
    footerSummary?: ReactNode;
    children: ReactNode;
    onSuccess: (result: O["Type"]) => void;
  },
) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const errorId = useId();
  const [invalid, setInvalid] = useState(false);

  const [capturedCommand, setCapturedCommand] = useState<{ key: string; input: unknown } | null>(
    null,
  );

  const requests = useSavedPostingRequests(book);
  const client = useQueryClient();

  const save = useMutation({
    mutationFn: async (request: CapturedEntry) => {
      if (!requests.data || requests.isError)
        throw new Error(sv ? "Behörigheten kunde inte läsas." : "Your access could not be loaded.");

      const retained = await sendSavedPostingCommand({
        book,
        actorId: requests.data.actorId,
        command: { operation: "create_evidence", input: request.source },
        storageMessage: sv ? "Tillåt lokal lagring för att spara." : "Allow local storage to save.",
      });

      if (
        retained.outcome?.state !== "committed" ||
        !Schema.is(Accounting.Evidence)(retained.outcome.result)
      )
        throw new Error(
          sv
            ? "Underlaget är inte bekräftat. Försök igen."
            : "The source is not confirmed. Retry the save.",
        );

      const parsed = Schema.decodeUnknownOption(props.schema)(
        request.build(retained.outcome.result),
      );

      if (parsed._tag === "None")
        throw new InvalidRecordInput(
          sv
            ? "Kontrollera datum, belopp och obligatoriska uppgifter."
            : "Check dates, amounts and required details.",
        );
      setCapturedCommand({ key: request.key, input: parsed.value });

      const result = await readAccounting(props.path, props.output, {
        method: "POST",
        body: JSON.stringify(parsed.value),
        headers: { "Idempotency-Key": request.key },
      });

      if (typeof result === "object" && result !== null && "scope" in result)
        checkScope(book, Schema.decodeUnknownSync(Accounting.Scope)(result.scope));

      return result;
    },
    retry: false,
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: bookKey(book) });
      props.onSuccess(result);
    },
  });

  const correctable =
    save.error instanceof InvalidRecordInput ||
    (save.error instanceof Accounting.AccountingError &&
      ["InvalidJournal", "MissingEvidence"].includes(save.error.code));

  const locked = !!save.variables && !correctable;

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      aria-describedby={errorId}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (locked || props.canSubmit === false || book.role !== "operator") return;
        const fields = new FormData(event.currentTarget);
        const source = Schema.decodeOption(Accounting.CreateEvidence)(props.source(fields));
        setInvalid(source._tag === "None");

        if (source._tag === "None") return;
        const build = props.input;
        save.mutate({
          key: crypto.randomUUID(),
          source: source.value,
          build: (evidence) => build(fields, evidence),
        });
      }}
    >
      <Box
        as="fieldset"
        disabled={locked || book.role !== "operator"}
        display="grid"
        gap="xl"
        minWidth="zero"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        {props.children}
        <FormActions sticky={props.stickyFooter}>
          {props.footerSummary ?? (
            <PageCaption>
              {sv
                ? "Uppgifterna sparas med underlaget och historiken."
                : "These details are retained with the source and its history."}
            </PageCaption>
          )}
          <Box>
            <Button
              type="submit"
              disabled={props.canSubmit === false || requests.isPending || requests.isError}
            >
              {save.isPending ? (sv ? "Sparar…" : "Saving…") : props.label}
            </Button>
          </Box>
        </FormActions>
      </Box>
      {invalid || correctable ? (
        <Text id={errorId} role="alert">
          {sv
            ? "Kontrollera datum, belopp och obligatoriska uppgifter."
            : "Check dates, amounts and required details."}
        </Text>
      ) : null}
      <AccountingStatus
        locale={locale}
        write
        pending={save.isPending}
        error={save.error instanceof InvalidRecordInput ? null : (save.error ?? requests.error)}
      />
      {save.isError && !correctable && save.variables ? (
        <Box display="flex" gap="md" flexWrap="wrap">
          <Button
            variant="outline"
            onClick={() => {
              if (save.variables) save.mutate(save.variables);
            }}
          >
            {sv ? "Försök spara igen" : "Retry save"}
          </Button>
          {capturedCommand ? (
            <Button
              variant="outline"
              onClick={() => {
                const artifact = {
                  scope: { entityId: book.entityId, bookId: book.id },
                  path: props.path,
                  request: capturedCommand,
                  outcome: null,
                };

                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }),
                );

                const link = document.createElement("a");
                link.href = url;
                link.download = `request-${capturedCommand.key}.json`;
                document.body.append(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }}
            >
              {sv ? "Spara begäran för återställning" : "Save request for recovery"}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
