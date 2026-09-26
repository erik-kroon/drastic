import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AccountingError } from "@open-erp/contracts/accounting";
import * as Schema from "effect/Schema";
import * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { mutationOptions, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function FirmForm<S extends Schema.Top & { readonly DecodingServices: never }>(props: {
  title: string;
  label: string;
  path: string;
  schema: S;
  input: (fields: FormData) => unknown;
  locale: Locale;
  children: ReactNode;
  onClose: () => void;
  onSaved?: (result: typeof Firms.CommandResult.Type) => void;
}) {
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const [invalid, setInvalid] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: S["Type"]) =>
      readAccounting(
        props.path,
        Firms.CommandResult,
        mutationOptions(props.path, JSON.stringify(input), keys.current),
      ),
    onSuccess: async (result) => {
      keys.current.clear();
      await cache.invalidateQueries({ queryKey: ["accounting", "firms"] });
      props.onSaved?.(result);
      props.onClose();
    },
  });

  const sv = props.locale === "sv";

  return (
    <FormDialog
      size="compact"
      title={props.title}
      closeLabel={sv ? "Stäng" : "Close"}
      onClose={() => {
        if (!mutation.isPending) props.onClose();
      }}
    >
      <Box
        as="form"
        display="grid"
        gap="lg"
        onSubmit={(event) => {
          event.preventDefault();

          if (mutation.isPending) return;

          const input = Schema.decodeUnknownOption(props.schema)(
            props.input(new FormData(event.currentTarget)),
          );

          setInvalid(input._tag === "None");

          if (input._tag === "Some") mutation.mutate(input.value);
        }}
      >
        <Box as="fieldset" disabled={mutation.isPending} display="grid" gap="lg" minWidth="zero">
          {props.children}
        </Box>
        {invalid ? (
          <Text role="alert">
            {sv ? "Kontrollera uppgifterna och försök igen." : "Check the details and try again."}
          </Text>
        ) : null}
        <AccountingStatus
          locale={props.locale}
          error={mutation.error}
          pending={mutation.isPending}
          write
        />
        {mutation.error instanceof AccountingError && mutation.error.code === "StaleDependency" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void cache
                .invalidateQueries({ queryKey: ["accounting", "firms"] })
                .then(props.onClose);
            }}
          >
            {sv ? "Läs in aktuella detaljer" : "Reload current details"}
          </Button>
        ) : null}
        <Box display="flex" justifyContent="end" gap="md">
          <Button
            type="button"
            variant="ghost"
            disabled={mutation.isPending}
            onClick={props.onClose}
          >
            {sv ? "Avbryt" : "Cancel"}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? (sv ? "Sparar…" : "Saving…") : props.label}
          </Button>
        </Box>
      </Box>
    </FormDialog>
  );
}

export function formText(fields: FormData, name: string) {
  const value = fields.get(name);

  return typeof value === "string" ? value : "";
}
