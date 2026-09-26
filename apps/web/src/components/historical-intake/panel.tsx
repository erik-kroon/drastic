import { useRef } from "react";
import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Sources from "@open-erp/contracts/source-intake";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { SelectField } from "@open-erp/ui/components/field";
import { Text } from "@open-erp/ui/components/typography";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { DocumentUpload } from "@/components/document-inbox";
import { statementImportsOptions } from "@/components/statement-imports";
import { checkScope } from "@/components/commerce/shared";
import { SiePlanReview, SavedSiePlan } from "./plan";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  mutationOptions,
  readAccounting,
  isUncertainWriteError,
} from "@/lib/accounting-api";

const Encoding = Sie.SiePreview.fields.encoding;

export function HistoricalIntake({
  source,
  preview,
  plan,
}: {
  source?: string;
  preview?: string;
  plan?: string;
}) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const navigate = useNavigate();
  const base = `${workspacePath(book)}/history`;
  const inventory = useInfiniteQuery({ ...statementImportsOptions(book), enabled: !source });
  const openSource = (id: string) => void navigate({ to: base, search: { source: id } });

  return (
    <>
      <WorkspaceHeader title={sv ? "Tidigare bokföring" : "Previous bookkeeping"} />
      <PageContent>
        <Link href={`${workspacePath(book)}/setup`}>
          {sv ? "Till företagsinställningar" : "Back to company setup"}
        </Link>
        {source ? (
          <SieSource key={source} source={source} preview={preview} plan={plan} />
        ) : (
          <>
            <RecordHeading
              title={sv ? "Importera en SIE-fil" : "Import a SIE file"}
              subtitle={
                sv
                  ? "Bevara originalet och kontrollera innehållet före kontomappning och avstämning."
                  : "Retain the original and inspect its contents before account mapping and reconciliation."
              }
            />
            <DocumentUpload sie onSaved={openSource} />
            <RecordSection title={sv ? "Fortsätt med en sparad fil" : "Continue with a saved file"}>
              <AccountingStatus
                locale={locale}
                pending={inventory.isPending}
                error={inventory.error}
              />
              {inventory.data?.pages
                .flatMap((page) => page.items)
                .filter((item) => /\.(se|si|sie|txt)$/i.test(item.occurrence.filename))
                .map(({ occurrence }) => (
                  <Box key={occurrence.id}>
                    <Button variant="ghost" onClick={() => openSource(occurrence.id)}>
                      {occurrence.filename} · {occurrence.retainedAt.slice(0, 10)}
                    </Button>
                  </Box>
                ))}
              {inventory.hasNextPage ? (
                <Button
                  variant="outline"
                  disabled={inventory.isFetchingNextPage}
                  onClick={() => {
                    void inventory.fetchNextPage();
                  }}
                >
                  {sv ? "Visa fler" : "Show more"}
                </Button>
              ) : null}
              {inventory.isError ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    void inventory.refetch();
                  }}
                >
                  {sv ? "Försök igen" : "Try again"}
                </Button>
              ) : null}
            </RecordSection>
          </>
        )}
      </PageContent>
    </>
  );
}

function SieSource({ source, preview, plan }: { source: string; preview?: string; plan?: string }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const navigate = useNavigate();
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());
  const base = `${workspacePath(book)}/history`;
  const sourcePath = `${bookPath(book)}/source-occurrences/${encodeURIComponent(source)}`;

  const previews = useQuery({
    queryKey: [...bookKey(book), "sie-preview-inventory", source],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(`${sourcePath}/sie-previews`, Sie.SiePreviewInventory, {
        signal,
      });

      checkScope(book, result.scope);

      if (result.occurrenceId !== source) throw new Error("SIE inventory identity mismatch");

      return result;
    },
  });

  const original = useQuery({
    queryKey: [...bookKey(book), "source-metadata", source],
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${sourcePath}/metadata`,
        Sources.SourceOccurrenceMetadata,
        { signal },
      );

      checkScope(book, result.occurrence.scope);

      if (result.occurrence.id !== source) throw new Error("Source identity mismatch");

      return result;
    },
  });

  const capture = useMutation({
    mutationFn: (encoding: typeof Encoding.Type) =>
      readAccounting(
        `${sourcePath}/sie-previews`,
        Sie.SiePreview,
        mutationOptions(`${sourcePath}/sie-previews`, JSON.stringify({ encoding }), keys.current),
      ),
    onSuccess: (result) => {
      checkScope(book, result.scope);

      if (result.occurrenceId !== source) throw new Error("SIE source identity mismatch");
      cache.setQueryData([...bookKey(book), "sie-preview", result.id], result);
      void cache.invalidateQueries({
        queryKey: [...bookKey(book), "sie-preview-inventory", source],
      });
      void navigate({ to: base, search: { source, preview: result.id } });
    },
  });

  const form = useForm({
    defaultValues: { encoding: Schema.decodeSync(Encoding)("ibm437") },
    onSubmit: async ({ value }) => {
      await capture.mutateAsync(
        capture.variables && isUncertainWriteError(capture.error)
          ? capture.variables
          : value.encoding,
      );
    },
  });

  const inspection = useQuery({
    queryKey: [...bookKey(book), "sie-preview", preview],
    enabled: Boolean(preview),
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await readAccounting(
        `${bookPath(book)}/sie-previews/${encodeURIComponent(preview ?? "")}`,
        Sie.SiePreview,
        { signal },
      );

      checkScope(book, result.scope);

      if (result.id !== preview || result.occurrenceId !== source)
        throw new Error("SIE preview identity mismatch");

      return result;
    },
  });

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Link href={base}>{sv ? "Alla historiska filer" : "All historical files"}</Link>
      <RecordSection title={sv ? "Sparade filkontroller" : "Saved file inspections"}>
        <AccountingStatus locale={locale} pending={previews.isPending} error={previews.error} />
        {previews.data?.items.map((item) => (
          <Box key={item.id}>
            <Button
              variant={item.id === preview ? "secondary" : "ghost"}
              onClick={() => {
                void navigate({
                  to: base,
                  search: { source, preview: item.id, plan: item.planId ?? undefined },
                });
              }}
            >
              {item.ordinal}. {item.encoding} · {item.createdAt.slice(0, 10)}
            </Button>
            <Text tone="muted">
              {item.ready
                ? sv
                  ? "Inga blockerande filfel"
                  : "No blocking file errors"
                : sv
                  ? "Filfel att granska"
                  : "File errors to review"}
            </Text>
          </Box>
        ))}
        {previews.isSuccess && previews.data.items.length === 0 ? (
          <Text>
            {sv ? "Filen har inte kontrollerats ännu." : "This file has not been inspected yet."}
          </Text>
        ) : null}
        <Box>
          <Button
            variant="outline"
            disabled={previews.isFetching}
            onClick={() => {
              void previews.refetch();
            }}
          >
            {sv ? "Uppdatera sparade kontroller" : "Refresh saved inspections"}
          </Button>
        </Box>
      </RecordSection>
      <AccountingStatus locale={locale} pending={original.isPending} error={original.error} />
      {original.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void original.refetch();
          }}
        >
          {sv ? "Läs in originalets uppgifter igen" : "Reload original details"}
        </Button>
      ) : null}
      {original.data ? (
        <>
          <RecordHeading
            title={original.data.occurrence.filename}
            subtitle={
              sv
                ? "Originalet är bevarat. En innehållskontroll bokför inga belopp."
                : "The original is retained. Inspecting its contents does not post any amounts."
            }
          />
          {previews.data?.items.some((item) => item.runId !== null) ? (
            <Text>
              {sv
                ? "Filkontrollen är låst till den påbörjade körningen."
                : "The source inspection is frozen for the existing run."}
            </Text>
          ) : (
            <Box
              as="form"
              display="grid"
              gap="lg"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit().catch(() => undefined);
              }}
            >
              <form.Field name="encoding">
                {(field) => (
                  <SelectField
                    label={sv ? "Teckenkodning" : "Text encoding"}
                    name={field.name}
                    value={field.state.value}
                    disabled={capture.isPending || isUncertainWriteError(capture.error)}
                    options={[
                      { value: "ibm437", label: "PC8 / IBM 437" },
                      { value: "utf-8", label: "UTF-8" },
                      { value: "windows-1252", label: "Windows-1252" },
                    ]}
                    onValueChange={(value) => {
                      field.handleChange(Schema.decodeUnknownSync(Encoding)(value));
                      field.handleBlur();
                    }}
                  />
                )}
              </form.Field>
              <Box>
                <Button type="submit" disabled={capture.isPending}>
                  {sv ? "Kontrollera filen" : "Inspect file"}
                </Button>
              </Box>
              <AccountingStatus locale={locale} pending={capture.isPending} error={capture.error} />
            </Box>
          )}
        </>
      ) : null}
      {preview ? (
        <>
          <AccountingStatus
            locale={locale}
            pending={inspection.isPending}
            error={inspection.error}
          />
          {inspection.isError ? (
            <Button
              variant="outline"
              onClick={() => {
                void inspection.refetch();
              }}
            >
              {sv ? "Läs in kontrollen igen" : "Reload inspection"}
            </Button>
          ) : null}
          {inspection.data ? <InspectionSummary preview={inspection.data} sv={sv} /> : null}
        </>
      ) : null}
      {plan ? (
        <SavedSiePlan
          key={plan}
          plan={plan}
          preview={preview}
          runId={previews.data?.items.find((item) => item.planId === plan)?.runId ?? undefined}
          onStarted={() => {
            void previews.refetch();
          }}
        />
      ) : inspection.data && original.data ? (
        <SiePlanReview
          key={inspection.data.digest}
          preview={inspection.data}
          sourceSystem={original.data.occurrence.sourceSystem}
          onSealed={(result) => {
            cache.setQueryData([...bookKey(book), "sie-plan", result.id], result);
            void previews.refetch();
            void navigate({ to: base, search: { source, preview, plan: result.id } });
          }}
        />
      ) : null}
    </Box>
  );
}

function InspectionSummary({ preview, sv }: { preview: typeof Sie.SiePreview.Type; sv: boolean }) {
  return (
    <RecordSection title={sv ? "Filkontroll" : "File inspection"}>
      <Text>
        {preview.ready
          ? sv
            ? "Inga blockerande filfel hittades."
            : "No blocking file errors found."
          : sv
            ? "Åtgärda filfelen innan du fortsätter."
            : "Resolve the file errors before continuing."}
      </Text>
      <Text>
        {preview.vouchers.length} {sv ? "verifikationer" : "vouchers"} · {preview.controls.length}{" "}
        {sv ? "kontrollsaldon" : "control balances"}
      </Text>
      {preview.diagnostics.map((item, index) => (
        <Text key={`${item.code}:${index}`} role={item.severity === "error" ? "alert" : undefined}>
          {sv ? "Rad" : "Line"} {item.line}: {item.message}
        </Text>
      ))}
      <Text tone="muted">
        {sv
          ? "Kontomappning, oberoende saldokontroller och val av historik krävs före bokföring."
          : "Account mapping, independent balance checks and a historical basis are required before posting."}
      </Text>
    </RecordSection>
  );
}
