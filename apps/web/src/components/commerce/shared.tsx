import { useId, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Disclosure } from "@open-erp/ui/components/disclosure";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { EvidenceInspector } from "@/components/evidence-inspector";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { commerceCopy } from "./copy";

export type CommerceProps = { book: typeof Accounting.Book.Type; locale: Locale };
export const commercePath = (book: CommerceProps["book"]) => `${bookPath(book)}/commerce`;
export const commerceKey = (book: CommerceProps["book"]) => [...bookKey(book), "commerce"];
export function Details({
  title,
  children,
  open,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <Disclosure open={open} label={title}>
      <Box display="grid" gap="lg" minWidth="zero">
        {children}
      </Box>
    </Disclosure>
  );
}
export function Facts({ title, value }: { title: string; value: unknown }) {
  return (
    <Details title={title}>
      <Box minWidth="zero" overflow="auto">
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </Box>
    </Details>
  );
}
export function Evidence({
  book,
  locale,
  reference,
}: CommerceProps & { reference: { evidenceId: string; sha256: string } }) {
  return (
    <EvidenceInspector
      book={book}
      locale={locale}
      reference={{ ...reference, locator: reference.evidenceId }}
    />
  );
}
export function checkScope(book: CommerceProps["book"], scope: typeof Accounting.Scope.Type) {
  if (scope.bookId !== book.id || scope.entityId !== book.entityId)
    throw new Error("Commerce response scope mismatch");
}
export function Field(props: {
  name: string;
  label: string;
  value?: string;
  type?: "text" | "date";
  maxLength?: number;
}) {
  return (
    <InputField
      name={props.name}
      label={props.label}
      defaultValue={props.value}
      type={props.type ?? "text"}
      required
      maxLength={props.maxLength ?? 2000}
      autoComplete="off"
    />
  );
}
export function Lookup({ label, onOpen }: { label: string; onOpen: (id: string) => void }) {
  return (
    <Box
      as="form"
      display="flex"
      flexWrap="wrap"
      gap="md"
      alignItems="end"
      onSubmit={(event) => {
        event.preventDefault();
        const id = new FormData(event.currentTarget).get("id");
        if (typeof id === "string") onOpen(id.trim());
      }}
    >
      <InputField
        label={label}
        name="id"
        required
        pattern="[a-z][a-z0-9_-]{2,127}"
        maxLength={128}
        autoComplete="off"
      />
      <Button type="submit" size="xl" variant="outline">
        {label}
      </Button>
    </Box>
  );
}
export function Pager({
  locale,
  next,
  first,
  onPage,
}: {
  locale: Locale;
  next: string | null | undefined;
  first: boolean;
  onPage: (after: string) => void;
}) {
  const copy = commerceCopy(locale);
  return (
    <Box display="grid" gap="md">
      <Text tone="muted">{copy.pageNote}</Text>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button size="xl" variant="outline" disabled={first} onClick={() => onPage("")}>
          {copy.first}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!next}
          onClick={() => {
            if (next) onPage(next);
          }}
        >
          {copy.next}
        </Button>
      </Box>
    </Box>
  );
}
export function CommandForm<
  S extends Schema.Top & { readonly DecodingServices: never },
  O extends Schema.Top & { readonly DecodingServices: never },
>(
  props: CommerceProps & {
    path: string;
    schema: S;
    output: O;
    input: (fields: FormData) => unknown;
    children?: ReactNode;
    label: string;
    allowed?: boolean;
    onSuccess?: (result: O["Type"]) => void;
    onNewCommand?: () => void;
  },
) {
  const { book, locale, path, schema } = props;
  const allowed = props.allowed ?? true;
  const copy = commerceCopy(locale);
  const client = useQueryClient();
  const errorId = useId();
  const [key, setKey] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const command = useMutation({
    mutationFn: async (request: { key: string; input: S["Type"] }) => {
      const result = await readAccounting(path, props.output, {
        method: "POST",
        body: JSON.stringify(request.input),
        headers: { "Idempotency-Key": request.key },
      });
      if (typeof result === "object" && result !== null && "scope" in result)
        checkScope(book, Schema.decodeUnknownSync(Accounting.Scope)(result.scope));
      return result;
    },
    onSuccess: (result) => {
      void client.invalidateQueries({ queryKey: commerceKey(book) });
      props.onSuccess?.(result);
    },
    retry: false,
  });
  const captured = command.variables;
  const artifact = {
    scope: { entityId: book.entityId, bookId: book.id },
    path,
    request: captured,
    outcome: command.data ?? null,
  };
  return (
    <Box
      as="form"
      display="grid"
      gap="lg"
      minWidth="zero"
      aria-describedby={errorId}
      onSubmit={(event) => {
        event.preventDefault();
        if (!allowed || command.isPending || captured) return;
        const parsed = Schema.decodeUnknownOption(schema)(
          props.input(new FormData(event.currentTarget)),
        );
        const validKey = Schema.decodeOption(
          Accounting.IdempotencyHeaders.fields["idempotency-key"],
        )(key);
        if (parsed._tag === "None" || validKey._tag === "None") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        command.mutate({ key: validKey.value, input: parsed.value });
      }}
    >
      <Box
        key={formVersion}
        as="fieldset"
        disabled={!allowed || !!captured}
        display="grid"
        gap="lg"
        minWidth="zero"
        borderWidth="none"
        padding="none"
        margin="none"
      >
        {props.children}
        <Text tone="muted">{copy.keyHelp}</Text>
        <InputField
          label={copy.key}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          required
          minLength={8}
          maxLength={128}
          pattern="[a-zA-Z0-9_-]{8,128}"
          autoComplete="off"
        />
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => setKey(crypto.randomUUID())}
          >
            {copy.generateKey}
          </Button>
          <Button type="submit" size="xl">
            {props.label}
          </Button>
        </Box>
      </Box>
      <Text id={errorId} role="alert">
        {invalid ? copy.invalid : ""}
      </Text>
      {!allowed ? <Text>{copy.waiting}</Text> : null}
      <AccountingStatus locale={locale} write pending={command.isPending} error={command.error} />
      {command.isSuccess ? <Text role="status">{copy.saved}</Text> : null}
      {captured ? (
        <Box display="grid" gap="md">
          <Facts title={copy.request} value={artifact} />
          <Box display="flex" flexWrap="wrap" gap="md">
            <Button
              type="button"
              size="xl"
              variant="outline"
              disabled={command.isPending}
              onClick={() => command.mutate(captured)}
            >
              {copy.retry}
            </Button>
            <Button
              type="button"
              size="xl"
              variant="outline"
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }),
                );
                const link = document.createElement("a");
                link.href = url;
                link.download = `commerce-${captured.key}.json`;
                document.body.append(link);
                link.click();
                link.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 0);
              }}
            >
              {copy.download}
            </Button>
          </Box>
        </Box>
      ) : null}
      <Box>
        <Button
          type="button"
          size="xl"
          variant="outline"
          disabled={command.isPending || !allowed}
          onClick={() => {
            command.reset();
            setKey("");
            setInvalid(false);
            props.onNewCommand?.();
            setFormVersion((version) => version + 1);
          }}
        >
          {copy.newCommand}
        </Button>
      </Box>
    </Box>
  );
}
