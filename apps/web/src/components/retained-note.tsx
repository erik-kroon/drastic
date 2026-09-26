import { useMutation } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField, TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { sendSavedPostingCommand } from "@/components/posting-recovery/request";
import type { CommerceProps } from "@/components/commerce/shared";

export function RetainedNote({
  book,
  locale,
  onSaved,
}: CommerceProps & { onSaved: (evidence: typeof Accounting.Evidence.Type) => void }) {
  const requests = useSavedPostingRequests(book);
  const sv = locale === "sv";

  const save = useMutation({
    mutationFn: async (input: typeof Accounting.CreateEvidence.Type) => {
      if (!requests.data || requests.isError)
        throw new Error(
          sv
            ? "Kunde inte läsa behörigheten. Försök igen."
            : "Could not load your access. Try again.",
        );

      const result = await sendSavedPostingCommand({
        book,
        actorId: requests.data.actorId,
        command: { operation: "create_evidence", input },
        storageMessage: sv
          ? "Tillåt lokal lagring för att spara underlaget."
          : "Allow local storage to save this source.",
      });

      if (
        result.outcome?.state !== "committed" ||
        !Schema.is(Accounting.Evidence)(result.outcome.result)
      )
        throw new Error(
          sv
            ? "Underlaget är inte bekräftat. Försök igen med samma innehåll."
            : "The source is not confirmed. Retry with the same content.",
        );

      return result.outcome.result;
    },
    onSuccess: onSaved,
  });

  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      onSubmit={(event) => {
        event.preventDefault();
        const fields = new FormData(event.currentTarget);

        const input = Schema.decodeUnknownSync(Accounting.CreateEvidence)({
          title: fields.get("title"),
          origin: fields.get("origin"),
          content: fields.get("content"),
          mediaType: "text/plain",
        });

        save.mutate(input);
      }}
    >
      <Text tone="muted">
        {sv
          ? "Spara en källanteckning från dokumentet eller registret som uppgifterna bygger på."
          : "Save a source note from the document or register these details come from."}
      </Text>
      <Box display="grid" columns={2} gap="lg">
        <InputField name="title" label={sv ? "Titel" : "Title"} required maxLength={2000} />
        <InputField
          name="origin"
          label={sv ? "Källa" : "Source"}
          placeholder={sv ? "Till exempel kundregister" : "For example, customer register"}
          required
          maxLength={2000}
        />
      </Box>
      <TextareaField
        name="content"
        label={sv ? "Källanteckning" : "Source note"}
        required
        maxLength={65536}
        rows={5}
      />
      <Box>
        <Button type="submit" disabled={save.isPending || requests.isPending || requests.isError}>
          {sv ? "Spara underlag och fortsätt" : "Save source and continue"}
        </Button>
      </Box>
      <AccountingStatus
        locale={locale}
        pending={save.isPending}
        error={save.error ?? requests.error}
      />
    </Box>
  );
}
