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
import { bookKey, bookPath, readAccounting, isUncertainWriteError } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { commerceCopy } from "./copy";
import { useCommerceCommandRecovery } from "./command-recovery";

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
  expanded,
}: CommerceProps & { reference: { evidenceId: string; sha256: string }; expanded?: boolean }) {
  return (
    <EvidenceInspector
      book={book}
      locale={locale}
      expanded={expanded}
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
  if (first && !next) return null;
  return (
    <Box display="grid" gap="md">
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
    compact?: boolean;
    recoveryId?: string;
    allowed?: boolean;
    canSubmit?: boolean;
    onSuccess?: (result: O["Type"]) => void;
    onNewCommand?: () => void;
  },
) {
  const { book, locale, path, schema } = props;
  const allowed = props.allowed ?? true;
  const copy = commerceCopy(locale);
  const client = useQueryClient();
  const errorId = useId();

  const [invalid, setInvalid] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const recovery = useCommerceCommandRecovery({ book, path, id: props.recoveryId, schema });
  const command = useMutation({
    mutationFn: async (request: { key: string; input: S["Type"] }) => {
      recovery.retain(request);
      const result = await readAccounting(path, props.output, {
        method: "POST",
        body: JSON.stringify(request.input),
        headers: { "Idempotency-Key": request.key },
      });
      if (typeof result === "object" && result !== null && "scope" in result)
        checkScope(book, Schema.decodeUnknownSync(Accounting.Scope)(result.scope));
      return result;
    },
    onSuccess: (result, request) => {
      props.onSuccess?.(result);
      try {
        recovery.clear(request.key);
      } catch {
        setCleanupFailed(true);
      }
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
    retry: false,
  });
  const captured = command.variables ?? recovery.saved;
  const restored = command.isIdle && !!recovery.saved;
  const canReplace =
    command.isSuccess || (command.isError && !isUncertainWriteError(command.error));
  // Compact task actions disappear only when no request is in flight or its result is known.
  if (props.compact && !allowed && (!captured || command.isSuccess)) return null;
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
        if (
          !allowed ||
          !recovery.ready ||
          props.canSubmit === false ||
          command.isPending ||
          captured
        )
          return;
        const parsed = Schema.decodeUnknownOption(schema)(
          props.input(new FormData(event.currentTarget)),
        );
        if (parsed._tag === "None") {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        command.mutate({ key: crypto.randomUUID(), input: parsed.value });
      }}
    >
      <Box
        key={formVersion}
        as="fieldset"
        disabled={!allowed || !recovery.ready || !!captured}
        display="grid"
        gap="lg"
        minWidth="zero"
        borderWidth="none"
        padding="none"
        margin="none"
      >
        {!captured ? props.children : null}
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button
            type="submit"
            size={props.compact ? "default" : "xl"}
            disabled={props.canSubmit === false}
          >
            {command.isPending ? (locale === "sv" ? "Sparar…" : "Saving…") : props.label}
          </Button>
        </Box>
      </Box>
      {invalid ? (
        <Text id={errorId} role="alert">
          {copy.invalid}
        </Text>
      ) : null}
      {!allowed && !captured ? <Text>{copy.waiting}</Text> : null}
      <CommandRecoveryNotice
        locale={locale}
        restored={restored}
        failed={Boolean(recovery.error) || cleanupFailed}
        onRefresh={recovery.refresh}
      />
      <AccountingStatus locale={locale} write pending={command.isPending} error={command.error} />
      {command.isSuccess ? <Text role="status">{copy.saved}</Text> : null}
      {(command.isError || restored) && captured ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={!recovery.ready || command.isPending}
            onClick={() => command.mutate(captured)}
          >
            {copy.retry}
          </Button>
        </Box>
      ) : null}
      {captured ? (
        <Details title={copy.request}>
          <Facts title={copy.request} value={artifact} />
          <Box display="flex" flexWrap="wrap" gap="md">
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
        </Details>
      ) : null}
      {canReplace ? (
        <Box>
          <Button
            type="button"
            variant="outline"
            disabled={!allowed}
            onClick={() => {
              if (captured) {
                try {
                  recovery.clear(captured.key);
                } catch {
                  setCleanupFailed(true);
                  return;
                }
              }
              setCleanupFailed(false);
              command.reset();
              setInvalid(false);
              props.onNewCommand?.();
              setFormVersion((version) => version + 1);
            }}
          >
            {copy.newCommand}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}

function CommandRecoveryNotice({
  locale,
  restored,
  failed,
  onRefresh,
}: {
  locale: Locale;
  restored: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      {restored ? (
        <Text role="status">
          {locale === "sv"
            ? "En tidigare begäran väntar på bekräftelse. Försök samma begäran igen för att hämta resultatet."
            : "An earlier request is awaiting confirmation. Retry that same request to retrieve its result."}
        </Text>
      ) : null}
      {failed ? (
        <Box display="grid" gap="sm">
          <Text role="alert">
            {locale === "sv"
              ? "Begärans återställningsuppgifter kunde inte läsas eller uppdateras. Tillåt lagring i den här fliken och försök igen."
              : "The request’s recovery details could not be read or updated. Allow storage in this tab and try again."}
          </Text>
          <Box>
            <Button variant="outline" onClick={onRefresh}>
              {locale === "sv" ? "Försök läsa igen" : "Retry recovery read"}
            </Button>
          </Box>
        </Box>
      ) : null}
    </>
  );
}
