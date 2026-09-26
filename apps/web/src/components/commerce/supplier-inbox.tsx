import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Inbox from "@open-erp/contracts/supplier-inbox";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { DocumentUpload } from "@/components/document-inbox";
import { OriginalDocument } from "@/components/original-document";
import { bookKey, mutationOptions, readAccounting } from "@/lib/accounting-api";
import { CommandForm, commercePath, checkScope, type CommerceProps } from "./shared";
import { SupplierExtraction } from "./supplier-extraction";

function SupplierInboxList(props: {
  items: ReadonlyArray<typeof Inbox.SupplierInboxView.Type>;
  locale: CommerceProps["locale"];
  hasNextPage: boolean;
  isFetching: boolean;
  onOpen: (id: string) => void;
  onLoadMore: () => void;
}) {
  const sv = props.locale === "sv";

  return (
    <Box display="grid" gap="sm">
      <Text>{sv ? "Sparade leverantörsoriginal" : "Saved supplier originals"}</Text>
      {props.items.length === 0 ? (
        <Text>
          {sv
            ? "Inga original har registrerats i den här boken."
            : "No originals are registered in this book."}
        </Text>
      ) : null}
      {props.items.map((item) => (
        <Button
          key={item.occurrence.occurrence.id}
          type="button"
          variant="ghost"
          onClick={() => props.onOpen(item.occurrence.occurrence.id)}
        >
          {item.occurrence.occurrence.filename} · {item.channel} ·{" "}
          {item.draftId
            ? sv
              ? "Granskat utkast"
              : "Reviewed draft"
            : sv
              ? "Väntar på granskning"
              : "Awaiting review"}
          {item.reviewReason ? ` · ${item.reviewReason}` : ""}
        </Button>
      ))}
      {props.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={props.isFetching}
          onClick={props.onLoadMore}
        >
          {sv ? "Ladda fler" : "Load more"}
        </Button>
      ) : null}
    </Box>
  );
}

function SupplierInboxEntry(props: {
  entry: typeof Inbox.SupplierInboxView.Type;
  commerceProps: CommerceProps & { onDraft: (id: string) => void };
  id: string;
  path: string;
  onRefresh: () => void;
}) {
  const sv = props.commerceProps.locale === "sv";
  const extractionKeys = useRef(new Map<string, string>());

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Text>
        {props.entry.occurrence.occurrence.filename} · {props.entry.channel} ·{" "}
        {props.entry.draftId
          ? sv
            ? "Granskat utkast"
            : "Reviewed draft"
          : sv
            ? "Väntar på granskning"
            : "Awaiting review"}
      </Text>
      {props.entry.reviewReason ? (
        <Text>
          {sv ? "Granskning" : "Review"}: {props.entry.reviewReason}
        </Text>
      ) : null}
      {props.entry.reviewAttemptId ? (
        <Text>
          {sv ? "Valt tolkningsförsök" : "Selected extraction attempt"}:{" "}
          {props.entry.reviewAttemptId}
        </Text>
      ) : null}
      <OriginalDocument
        {...props.commerceProps}
        id={props.entry.occurrence.occurrence.id}
        sha256={props.entry.occurrence.occurrence.sha256}
      />
      <Text>
        {sv
          ? "Tolkningsförsök sparas separat från granskade uppgifter. Kontrollera varje uppgift mot originalet."
          : "Extraction attempts remain separate from reviewed facts. Check every field against the original."}
      </Text>
      {props.entry.attempts.map((attempt) => (
        <Box key={attempt.id} display="grid" gap="sm">
          <Text>
            {attempt.ordinal}. {attempt.parserVersion} · {attempt.status} · {attempt.createdAt}
          </Text>
          {attempt.diagnostics.map((message, index) => (
            <Text key={index}>{message}</Text>
          ))}
          {attempt.suggestions.map((suggestion, index) => (
            <Text key={index}>
              {suggestion.field}: {suggestion.value} · {suggestion.sourceLocation} ·{" "}
              {suggestion.confidence}
            </Text>
          ))}
        </Box>
      ))}
      <SupplierExtraction
        book={props.commerceProps.book}
        locale={props.commerceProps.locale}
        occurrenceId={props.id}
        onRefresh={props.onRefresh}
      />
      {!props.entry.draftId && props.commerceProps.book.role === "operator" ? (
        <>
          <CommandForm
            {...props.commerceProps}
            path={`${props.path}/${encodeURIComponent(props.id)}/extractions`}
            schema={Inbox.RecordSupplierExtraction}
            output={Inbox.SupplierInboxView}
            label={sv ? "Spara manuellt tolkningsförsök" : "Save manual extraction attempt"}
            keys={extractionKeys.current}
            onNewCommand={() => extractionKeys.current.clear()}
            input={(fields) => ({
              parserVersion: "manual-v1",
              status: "failed",
              suggestions: [],
              diagnostics: [fields.get("diagnostic")],
            })}
            onSuccess={props.onRefresh}
          >
            <InputField
              name="diagnostic"
              label={sv ? "Vad kunde inte tolkas?" : "What could not be extracted?"}
              required
              maxLength={200}
            />
          </CommandForm>
          <Button type="button" onClick={() => props.commerceProps.onDraft(`new:${props.id}`)}>
            {sv ? "Granska och fyll i faktura" : "Review and complete invoice"}
          </Button>
        </>
      ) : null}
      {props.entry.draftId ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => props.commerceProps.onDraft(props.entry.draftId!)}
        >
          {sv ? "Öppna granskat utkast" : "Open reviewed draft"}
        </Button>
      ) : null}
    </Box>
  );
}

export function SupplierInbox(props: CommerceProps & { onDraft: (id: string) => void }) {
  const { book, locale } = props;
  const sv = locale === "sv";
  const [id, setId] = useState("");
  const [upload, setUpload] = useState(false);
  const [registered, setRegistered] = useState(false);
  const keys = useRef(new Map<string, string>());
  const client = useQueryClient();
  const path = `${commercePath(book)}/supplier-inbox`;

  const inbox = useInfiniteQuery({
    queryKey: [...bookKey(book), "supplier-inbox", "list"],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) =>
      readAccounting(
        `${path}${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Inbox.SupplierInboxPage,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });

  const inboxItems = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  const view = useQuery({
    queryKey: [...bookKey(book), "supplier-inbox", id],
    enabled: !!id && registered,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${path}/${encodeURIComponent(id)}`,
        Inbox.SupplierInboxView,
        { signal },
      );

      checkScope(book, result.occurrence.occurrence.scope);

      if (result.occurrence.occurrence.id !== id) throw new Error("Inbox identity mismatch");

      return result;
    },
  });

  const register = useMutation({
    mutationFn: async (sourceId: string) => {
      const input = Schema.decodeSync(Inbox.RegisterSupplierInbox)({
        occurrenceId: sourceId,
        channel: "upload",
        messageIdentity: null,
      });

      const result = await readAccounting(
        path,
        Inbox.SupplierInboxView,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );

      checkScope(book, result.occurrence.occurrence.scope);

      if (result.occurrence.occurrence.id !== sourceId) throw new Error("Inbox identity mismatch");

      return result;
    },
    onSuccess: (result) => {
      setId(result.occurrence.occurrence.id);
      setRegistered(true);
      setUpload(false);
      void client.invalidateQueries({ queryKey: [...bookKey(book), "supplier-inbox"] });
    },
    retry: false,
  });

  const entry = view.data;

  return (
    <Box as="section" display="grid" gap="lg" minWidth="zero">
      <Text>
        {sv
          ? "Inkorg för leverantörsfakturor · originalet sparas innan granskning. Ingen automatisk e-posthämtning eller OCR är ansluten."
          : "Supplier invoice inbox · keep the original before review. Automatic email intake and OCR are not connected."}
      </Text>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button type="button" variant="outline" onClick={() => setUpload(!upload)}>
          {sv ? "Ladda upp original" : "Upload original"}
        </Button>
        {id && registered ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void view.refetch()}
            disabled={view.isFetching}
          >
            {sv ? "Uppdatera" : "Refresh"}
          </Button>
        ) : null}
      </Box>
      {upload ? (
        <DocumentUpload
          onSaved={(sourceId) => {
            setId(sourceId);
            setRegistered(false);
            register.mutate(sourceId);
          }}
        />
      ) : null}
      <Box
        as="form"
        display="flex"
        flexWrap="wrap"
        gap="md"
        alignItems="end"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("occurrenceId");

          if (typeof value === "string" && value && !register.isPending) register.mutate(value);
        }}
      >
        <InputField
          name="occurrenceId"
          label={sv ? "ID för sparat original" : "Retained original ID"}
          pattern="[a-z][a-z0-9_-]{2,127}"
          required
        />
        <Button type="submit" variant="outline" disabled={register.isPending}>
          {sv ? "Öppna i inkorgen" : "Open in inbox"}
        </Button>
      </Box>
      <SupplierInboxList
        items={inboxItems}
        locale={locale}
        hasNextPage={inbox.hasNextPage}
        isFetching={inbox.isFetching}
        onOpen={(occurrenceId) => {
          setId(occurrenceId);
          setRegistered(true);
        }}
        onLoadMore={() => void inbox.fetchNextPage()}
      />
      <AccountingStatus
        locale={locale}
        pending={inbox.isPending || register.isPending || (registered && view.isPending)}
        error={inbox.error ?? register.error ?? view.error}
        write={register.isPending}
      />
      {register.isError && register.variables ? (
        <Button type="button" variant="outline" onClick={() => register.mutate(register.variables)}>
          {sv ? "Försök igen med samma original" : "Retry same original"}
        </Button>
      ) : null}
      {entry ? (
        <SupplierInboxEntry
          entry={entry}
          commerceProps={props}
          id={id}
          path={path}
          onRefresh={() => void view.refetch()}
        />
      ) : null}
    </Box>
  );
}
