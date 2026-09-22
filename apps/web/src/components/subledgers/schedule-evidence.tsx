import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Label } from "@open-erp/ui/components/label";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookPath, mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { subledgerCopy } from "./copy";

export function ScheduleEvidence({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const copy = subledgerCopy(locale);
  const contentId = useId();
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: (input: typeof Accounting.CreateEvidence.Type) => {
      const path = `${bookPath(book)}/evidence`;
      return readAccounting(
        path,
        Accounting.Evidence,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );
    },
  });
  return (
    <details>
      <summary>{copy.evidenceCreate}</summary>
      <Box
        as="form"
        display="grid"
        gap="lg"
        paddingBlock="lg"
        minWidth="zero"
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const decoded = Schema.decodeUnknownOption(Accounting.CreateEvidence)({
            title: fields.get("title"),
            content: fields.get("content"),
            origin: fields.get("origin"),
            mediaType: "text/plain",
          });
          if (decoded._tag === "None") {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          save.mutate(decoded.value);
        }}
      >
        <Box
          as="fieldset"
          disabled={save.isPending || save.isSuccess}
          borderWidth="none"
          padding="none"
          margin="none"
          minWidth="zero"
          display="grid"
          gap="md"
        >
          <InputField label={copy.evidenceTitle} name="title" required maxLength={2000} />
          <InputField label={copy.origin} name="origin" required maxLength={2000} />
          <Label htmlFor={contentId}>{copy.content}</Label>
          <Box
            display="grid"
            minWidth="zero"
            padding="md"
            borderWidth="thin"
            borderColor="default"
            borderRadius="control"
          >
            <textarea id={contentId} name="content" required maxLength={65536} rows={6} cols={16} />
          </Box>
          <Box>
            <Button type="submit" size="xl">
              {copy.evidenceCreate}
            </Button>
          </Box>
        </Box>
        <Text role="status">{invalid ? copy.invalid : ""}</Text>
        <AccountingStatus locale={locale} write pending={save.isPending} error={save.error} />
        {save.data ? (
          <Box role="status" display="grid" gap="md">
            <Text>{copy.evidenceSaved}</Text>
            <Text>{save.data.id}</Text>
            <Text>SHA-256: {save.data.sha256}</Text>
          </Box>
        ) : null}
      </Box>
    </details>
  );
}
