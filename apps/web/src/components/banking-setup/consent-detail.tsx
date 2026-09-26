import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Connector from "@open-erp/contracts/bank-connector";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { TextareaField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordSection, RecordSummary, RecordFact } from "@open-erp/ui/components/record-layout";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";

export function ConsentDetail({ id }: { id: string }) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const path = `${bookPath(book)}/bank-connector-consents/${encodeURIComponent(id)}`;

  const consent = useQuery({
    queryKey: [...bookKey(book), "connector-consent", id],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(path, Connector.ConnectorConsentState, { signal });
      checkScope(book, result.scope);

      if (result.id !== id) throw new Error("Connector consent identity mismatch");

      return result;
    },
  });

  const batches = useInfiniteQuery({
    queryKey: [...bookKey(book), "connector-batches", id],
    initialPageParam: "",
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${path}/batches${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Connector.ConnectorBatchInventory,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.consentId !== id) throw new Error("Connector delivery identity mismatch");

      for (const item of result.items) {
        checkScope(book, item.scope);

        if (item.consentId !== id) throw new Error("Connector delivery identity mismatch");
      }

      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const feed = useQuery({
    queryKey: [...bookKey(book), "connector-feed", id],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/bank-connector-feeds?consentId=${encodeURIComponent(id)}`,
        Connector.ConnectorFeedInventory,
        { signal },
      );

      checkScope(book, result.scope);
      const item = result.items[0];

      if (result.items.length !== 1 || !item || item.consent.id !== id) {
        throw new Error("Connector feed identity mismatch");
      }

      checkScope(book, item.consent.scope);
      checkScope(book, item.scope);

      return item;
    },
  });

  return (
    <Box display="grid" gap="lg">
      <AccountingStatus locale={locale} pending={consent.isPending} error={consent.error} />
      {consent.data ? (
        <RecordSection title={`${consent.data.providerId} · ${consent.data.externalAccountId}`}>
          <RecordSummary>
            <RecordFact label="Status">
              {consent.data.revoked
                ? sv
                  ? "Stoppad"
                  : "Stopped"
                : sv
                  ? "Samtycke registrerat"
                  : "Consent recorded"}
            </RecordFact>
            <RecordFact label={sv ? "Bokföringskonto" : "Ledger account"}>
              {setup.accounts.find((account) => account.id === consent.data?.accountId)?.code ??
                consent.data.accountId}
            </RecordFact>
            <RecordFact label={sv ? "Sparat" : "Recorded"}>
              {consent.data.createdAt.slice(0, 10)}
            </RecordFact>
          </RecordSummary>
          <Text>
            {sv ? "Kontoreferens i kontoutdrag" : "Statement account reference"}:{" "}
            {consent.data.sourceAccountId}
          </Text>
          <Text>
            {sv ? "Samtyckets underlag" : "Consent evidence"}: {consent.data.consentReference}
          </Text>
          <Text>{consent.data.rationale}</Text>
          {consent.data.revoked ? (
            <Text>
              {sv
                ? "Nya leveranser till detta samtycke stoppas. Sparade underlag finns kvar. Kontrollera även samtycket hos leverantören."
                : "New deliveries under this consent are stopped. Retained records remain available. Check the consent with the provider as well."}
            </Text>
          ) : (
            <RevokeConsent
              id={id}
              onSaved={() => {
                void consent.refetch();
              }}
            />
          )}
        </RecordSection>
      ) : null}
      <RetainedFeedEvidence
        locale={locale}
        data={feed.data}
        pending={feed.isPending}
        error={feed.error}
      />
      <RecordSection title={sv ? "Leveranshistorik" : "Delivery history"}>
        <Text tone="muted">
          {sv
            ? "Sparade leveranser verifierar inte leverantörens åtkomst och för inte in poster i avstämningen."
            : "Retained deliveries do not verify provider access or admit records for reconciliation."}
        </Text>
        <AccountingStatus locale={locale} pending={batches.isPending} error={batches.error} />
        {batches.isSuccess && batches.data.pages.every((page) => page.items.length === 0) ? (
          <Text>
            {sv
              ? "Ingen första leverans har registrerats. Ett sparat samtycke innebär inte att bankunderlag har hämtats."
              : "No initial delivery has been recorded. Saved consent does not mean bank records have been fetched."}
          </Text>
        ) : null}
        {batches.data?.pages
          .flatMap((page) => page.items)
          .map((batch) => (
            <Box key={batch.id} display="grid" gap="sm">
              <Text>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(batch.receivedAt))}{" "}
                UTC ·{" "}
                {batch.providerOutcome === "delivered"
                  ? sv
                    ? "Levererat"
                    : "Delivered"
                  : batch.providerOutcome === "uncertain"
                    ? sv
                      ? "Okänt resultat"
                      : "Outcome uncertain"
                    : sv
                      ? "Misslyckades"
                      : "Failed"}
              </Text>
              <Text>
                {sv ? "Nya poster" : "New records"}: {batch.recordCount} · {batch.overlapCount}{" "}
                {sv ? "redan sparade" : "already retained"}
              </Text>
              <details>
                <summary>{sv ? "Leveranskvitto" : "Delivery receipt"}</summary>
                <Text>
                  {batch.id} · {batch.sourceRevision}
                </Text>
                <Text>{batch.receivedAt}</Text>
                {batch.items.map((item) => (
                  <Text key={`${item.externalId}:${item.revision}`}>
                    {item.externalId} · {item.status} · {item.occurrenceId}
                  </Text>
                ))}
              </details>
            </Box>
          ))}
        <Box display="flex" gap="sm" flexWrap="wrap">
          <Button
            variant="outline"
            disabled={consent.isFetching || batches.isFetching}
            onClick={() => {
              void consent.refetch();
              void batches.refetch();
            }}
          >
            {sv ? "Uppdatera leveransstatus" : "Refresh delivery status"}
          </Button>
          {batches.hasNextPage ? (
            <Button
              variant="outline"
              disabled={batches.isFetchingNextPage}
              onClick={() => {
                void batches.fetchNextPage();
              }}
            >
              {sv ? "Visa fler leveranser" : "Load more deliveries"}
            </Button>
          ) : null}
        </Box>
      </RecordSection>
    </Box>
  );
}

function RetainedFeedEvidence({
  locale,
  data,
  pending,
  error,
}: {
  locale: "en" | "sv";
  data: typeof Connector.ConnectorFeed.Type | undefined;
  pending: boolean;
  error: Error | null;
}) {
  const sv = locale === "sv";

  return (
    <RecordSection title={sv ? "Bevarad anslutningsstatus" : "Retained feed evidence"}>
      <AccountingStatus locale={locale} pending={pending} error={error} />
      {data ? (
        <Box display="grid" gap="sm">
          <Text>
            {sv ? "Läst" : "Read at"}: {data.readAt} · {sv ? "Bevarade sidor" : "Retained pages"}:{" "}
            {data.cursorSnapshot.retainedPageCount}
            {data.pageEvidenceTruncated ? (sv ? " · förkortad vy" : " · truncated view") : ""}
          </Text>
          <Text>
            {sv ? "Konto" : "Account"}: {data.account.accountId} · {sv ? "aktiv" : "active"}:{" "}
            {data.account.active ? (sv ? "Ja" : "Yes") : sv ? "Nej" : "No"}
          </Text>
          <Text>
            {sv ? "Leverantörsgodkännande" : "Provider acceptance"}:{" "}
            {sv ? "Ej fastställt" : "Not established"} · {sv ? "Kontotäckning" : "Account coverage"}
            : {sv ? "Ej fastställt" : "Not established"}
          </Text>
          {data.recoveryBlockers.map((blocker) => (
            <Text key={blocker.code} role="alert">
              {blocker.message}
            </Text>
          ))}
          <Text>
            {sv
              ? "Bevarade sidor är operatörsleveranser eller connector-resultat. De verifierar inte bankens samtycke och för inte in poster i avstämningen."
              : "Retained pages are operator deliveries or connector results. They do not verify bank consent or admit records for reconciliation."}
          </Text>
        </Box>
      ) : null}
    </RecordSection>
  );
}

function RevokeConsent({ id, onSaved }: { id: string; onSaved: () => void }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const keys = useRef(new Map<string, string>());
  const path = `${bookPath(book)}/bank-connector-consents/${encodeURIComponent(id)}/revoke`;

  const save = useMutation({
    mutationFn: async (input: typeof Connector.RevokeConnectorConsent.Type) => {
      const result = await readAccounting(
        path,
        Connector.ConnectorRevocation,
        mutationOptions(path, JSON.stringify(input), keys.current),
      );

      if (result.consentId !== id) throw new Error("Connector revocation identity mismatch");

      return result;
    },
    onSuccess: onSaved,
  });

  const uncertain = isUncertainWriteError(save.error);
  const disabled = book.role !== "operator" || save.isPending || uncertain || save.isSuccess;

  const form = useForm({
    defaultValues: { reason: "" },
    validators: {
      onSubmit: ({ value }) =>
        Schema.is(Connector.RevokeConnectorConsent)(value) ? undefined : "Enter a reason.",
    },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value).catch(() => undefined);
    },
  });

  return (
    <details>
      <summary>{sv ? "Stoppa nya leveranser" : "Stop new deliveries"}</summary>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <Text>
          {sv
            ? "Stoppa nya underlag i OpenERP. Detta återkallar inte samtycket hos banken eller leverantören."
            : "Stop new records in OpenERP. This does not revoke consent with the bank or provider."}
        </Text>
        <form.Field name="reason">
          {(field) => (
            <TextareaField
              label={sv ? "Skäl" : "Reason"}
              required
              maxLength={2000}
              value={field.state.value}
              disabled={disabled}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          )}
        </form.Field>
        <AccountingStatus locale={locale} pending={save.isPending} error={save.error} write />
        <Box>
          {uncertain ? (
            <Button
              type="button"
              disabled={save.isPending || book.role !== "operator"}
              onClick={() => {
                if (save.variables) save.mutate(save.variables);
              }}
            >
              {sv ? "Återförsök samma stopp" : "Retry same stop request"}
            </Button>
          ) : (
            <Button type="submit" variant="outline" disabled={disabled}>
              {sv ? "Stoppa leveranser till detta samtycke" : "Stop deliveries under this consent"}
            </Button>
          )}
        </Box>
      </Box>
    </details>
  );
}
