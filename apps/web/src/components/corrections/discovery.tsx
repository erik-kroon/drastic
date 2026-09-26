import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Corrections from "@open-erp/contracts/corrections";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { InputField } from "@open-erp/ui/components/field";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";
import { correctionCopy } from "./copy";

export function CorrectionDiscovery({
  book,
  locale,
  onSelected,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onSelected: (id: string) => void;
}) {
  const copy = correctionCopy(locale);
  const [after, setAfter] = useState("");
  const [error, setError] = useState("");

  const bundles = useQuery({
    queryKey: [...bookKey(book), "correction-bundles", after],
    queryFn: ({ signal }) =>
      readAccounting(
        `${bookPath(book)}/correction-bundles${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        Corrections.CorrectionBundlePage,
        { signal },
      ),
    retry: false,
  });

  const recovery = useMutation({
    mutationFn: (key: string) =>
      readAccounting(
        `${bookPath(book)}/correction-requests/${encodeURIComponent(key)}`,
        Corrections.CorrectionRequestRecovery,
      ),
  });

  return (
    <Box display="grid" gap="lg" minWidth="zero">
      <Heading>{copy.discover}</Heading>
      <AccountingStatus locale={locale} pending={bundles.isPending} error={bundles.error} />
      {bundles.data?.items.length === 0 ? <Text>{copy.noBundles}</Text> : null}
      {bundles.data?.items.map((bundle) => (
        <Box key={bundle.id} display="grid" gap="sm" minWidth="zero">
          <Text>
            {copy.originalId}: {bundle.originalVoucherId}
          </Text>
          <Text>{bundle.createdAt}</Text>
          <Text>{bundle.receipt ? copy.committed : copy.review}</Text>
          <Box>
            <Button size="xl" variant="outline" onClick={() => onSelected(bundle.id)}>
              {copy.recover}: {bundle.id}
            </Button>
          </Box>
        </Box>
      ))}
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button
          size="xl"
          variant="outline"
          disabled={bundles.isFetching}
          onClick={() => {
            void bundles.refetch();
          }}
        >
          {copy.refresh}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!after || bundles.isFetching}
          onClick={() => setAfter("")}
        >
          {copy.first}
        </Button>
        <Button
          size="xl"
          variant="outline"
          disabled={!bundles.data?.next || bundles.isFetching}
          onClick={() => {
            if (bundles.data?.next) setAfter(bundles.data.next);
          }}
        >
          {copy.next}
        </Button>
      </Box>
      <Box
        as="form"
        display="grid"
        gap="md"
        onSubmit={(event) => {
          event.preventDefault();
          const key = new FormData(event.currentTarget).get("requestKey");

          if (!Schema.is(Accounting.IdempotencyHeaders.fields["idempotency-key"])(key)) {
            setError(copy.invalid);

            return;
          }

          setError("");
          recovery.mutate(key);
        }}
      >
        <InputField
          label={copy.requestKey}
          name="requestKey"
          required
          minLength={8}
          maxLength={128}
        />
        <Box>
          <Button type="submit" size="xl" variant="outline" disabled={recovery.isPending}>
            {copy.recoverRequest}
          </Button>
        </Box>
      </Box>
      <Text role="status">{error}</Text>
      <AccountingStatus locale={locale} pending={recovery.isPending} error={recovery.error} />
      {recovery.data ? (
        <Box role="status" display="grid" gap="md">
          <Text>
            {recovery.data.status === "recorded" ? copy.requestRecorded : copy.requestUnknown}
          </Text>
          <Text>
            {recovery.data.checkedAt} · {recovery.data.operation}
          </Text>
          {recovery.data.result && Schema.is(Corrections.CorrectionBundle)(recovery.data.result) ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                onClick={() => {
                  const result = recovery.data?.result;

                  if (Schema.is(Corrections.CorrectionBundle)(result)) onSelected(result.id);
                }}
              >
                {copy.recover}: {recovery.data.result.id}
              </Button>
            </Box>
          ) : null}
          {recovery.data.result &&
          (Schema.is(Corrections.CorrectionBundleApproval)(recovery.data.result) ||
            Schema.is(Corrections.CorrectionBundleReceipt)(recovery.data.result)) ? (
            <Box>
              <Button
                size="xl"
                variant="outline"
                onClick={() => {
                  const result = recovery.data?.result;

                  if (
                    Schema.is(Corrections.CorrectionBundleApproval)(result) ||
                    Schema.is(Corrections.CorrectionBundleReceipt)(result)
                  )
                    onSelected(result.bundleId);
                }}
              >
                {copy.recover}: {recovery.data.result.bundleId}
              </Button>
            </Box>
          ) : null}
          {recovery.data.result && Schema.is(Corrections.CorrectionImpact)(recovery.data.result) ? (
            <a
              href={`${bookPath(book)}/correction-impact-reviews/${recovery.data.result.id}`}
              target="_blank"
              rel="noreferrer"
            >
              {copy.impactId}: {recovery.data.result.id}
            </a>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
