import { bookScope, httpQuery, httpRequest } from "@/lib/contract-client";
import { Api } from "@open-erp/contracts/api";
import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { canonicalizeJson } from "@open-erp/domain/canonicalization";
import * as Result from "effect/Result";
import * as Option from "effect/Option";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { FormActions } from "@open-erp/ui/components/form-actions";
import { Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { sendSavedPostingCommand } from "@/components/posting-recovery/request";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { InvoiceDraftDocument } from "./invoice-draft-document";
import { Details, checkScope, commercePath, type CommerceProps } from "./shared";
import type { DraftSession, DraftEditingState } from "./invoice-draft-session";

type SaveProps = CommerceProps & {
  session: DraftSession;
  source: (fields: FormData) => typeof Accounting.CreateEvidence.Type;
  input: (fields: FormData, evidence: typeof Accounting.Evidence.Type) => unknown;
  children:
    | ReactNode
    | ((calculation: typeof Drafts.CommercialDraftCalculation.Type | undefined) => ReactNode);
  footerSummary:
    | ReactNode
    | ((calculation: typeof Drafts.CommercialDraftCalculation.Type | undefined) => ReactNode);
  previewInput?: (fields: FormData) => unknown;
};

class InvalidDraftInput extends Error {}

export function InvoiceDraftSave(props: SaveProps) {
  const { book, locale, session } = props;
  const sv = locale === "sv";
  const baseline = session.state.baseline;
  const path = `${commercePath(book)}/invoice-drafts${baseline ? `/${encodeURIComponent(baseline.id)}/revisions` : ""}`;
  const schema = baseline ? Drafts.ReviseInvoiceDraft : Drafts.CreateInvoiceDraft;
  const client = useQueryClient();
  const [invalid, setInvalid] = useState(false);
  const problem = useRef<HTMLDivElement>(null);

  const editingKey = JSON.stringify([
    session.state.fields,
    session.state.lines,
    session.state.customer,
    session.state.expected,
    session.state.purpose,
  ]);

  const [previewInput, setPreviewInput] = useState<{ key: string; json: string } | null>(null);

  function capturePreview(element: HTMLFormElement | null) {
    if (!element) return;

    if (!props.previewInput) {
      setPreviewInput(null);

      return;
    }

    const candidate = Schema.decodeUnknownOption(
      Schema.Struct({ commercial: Drafts.CommercialContent }),
    )(props.previewInput(new FormData(element)));

    const next = Option.isSome(candidate)
      ? { key: editingKey, json: JSON.stringify(candidate.value.commercial) }
      : null;

    setPreviewInput((previous) =>
      previous?.key === next?.key && previous?.json === next?.json ? previous : next,
    );
  }

  const calculation = useCommercialPreview(props, previewInput, editingKey);

  const save = useMutation({
    mutationFn: async (pending: NonNullable<DraftEditingState["pending"]>) => {
      if (book.role !== "operator") throw new Error("Operator access required");
      let input = pending.input;

      if (input === null) {
        const retained = await sendSavedPostingCommand({
          book,
          actorId: session.actorId,
          command: { operation: "create_evidence", input: pending.source },
          storageMessage: sv
            ? "Tillåt lokal lagring för att spara."
            : "Allow local storage to save.",
        });

        if (
          retained.outcome?.state !== "committed" ||
          !Schema.is(Accounting.Evidence)(retained.outcome.result)
        )
          throw new Error(
            sv
              ? "Underlaget är inte bekräftat. Försök spara igen."
              : "The source is not confirmed. Retry the save.",
          );
        const fields = new FormData();

        for (const [name, value] of Object.entries(pending.fields)) fields.set(name, value);

        const parsed = Schema.decodeUnknownOption(schema)(
          props.input(fields, retained.outcome.result),
        );

        if (Option.isNone(parsed)) throw new InvalidDraftInput();
        input = parsed.value;
      }

      const command = Schema.decodeUnknownSync(schema)(input);

      if (!session.update({ pending: { ...pending, input: command } }))
        throw new Error(
          sv
            ? "Sparandet har pausats. Begäran måste behållas innan den skickas."
            : "Saving is paused. The request must be kept before it is sent.",
        );

      const result = await readAccounting(path, Drafts.InvoiceDraftRevision, {
        method: "POST",
        body: JSON.stringify(command),
        headers: { "Idempotency-Key": pending.key },
      });

      checkScope(book, result.scope);

      if (result.draftKey !== session.state.draftKey || (baseline && result.id !== baseline.id))
        throw new Error("Saved invoice draft identity mismatch");

      return result;
    },
    onError: (error) => {
      if (error instanceof Accounting.AccountingError && error.code === "StaleDependency")
        void client.invalidateQueries({ queryKey: bookKey(book) });
    },
    onSuccess: (record) => {
      session.saved(record);
      void client.invalidateQueries({ queryKey: bookKey(book) });
    },
    retry: false,
  });

  const refused = save.error instanceof Accounting.AccountingError;
  const invalidInput = save.error instanceof InvalidDraftInput;

  const conflict =
    save.error instanceof Accounting.AccountingError && save.error.code === "StaleDependency";

  const pending = session.state.pending;

  return (
    <Box
      as="form"
      ref={capturePreview}
      display="grid"
      gap="lg"
      minWidth="zero"
      onChange={(event) => {
        const target = event.target;

        if (
          !pending &&
          (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target instanceof HTMLSelectElement) &&
          target.name
        )
          session.update({ fields: { ...session.state.fields, [target.name]: target.value } });
      }}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();

        if (pending || !session.state.customer || book.role !== "operator") return;
        const fields = new FormData(event.currentTarget);
        const source = Schema.decodeOption(Accounting.CreateEvidence)(props.source(fields));
        setInvalid(Option.isNone(source));

        if (Option.isNone(source)) return;

        const values = Object.fromEntries(
          Array.from(fields.entries()).map(([name, value]) => [name, String(value)]),
        );

        const request = {
          key: crypto.randomUUID(),
          source: source.value,
          fields: values,
          input: null,
        };

        if (session.update({ fields: values, pending: request })) save.mutate(request);
      }}
    >
      <Box
        as="fieldset"
        disabled={!!pending || book.role !== "operator"}
        display="grid"
        gap="xl"
        minWidth="zero"
        borderWidth="none"
        margin="none"
        padding="none"
      >
        {typeof props.children === "function" ? props.children(calculation.data) : props.children}
      </Box>
      {calculation.status}
      {invalid || invalidInput ? (
        <Text role="alert">
          {sv
            ? "Kontrollera datum, belopp och obligatoriska uppgifter."
            : "Check dates, amounts and required details."}
        </Text>
      ) : null}
      <AccountingStatus
        locale={locale}
        write
        pending={save.isPending}
        error={refused && !conflict ? save.error : null}
      />
      {pending && !save.isPending && !save.isSuccess && (refused || invalidInput) ? (
        <Box ref={problem} display="grid" gap="md">
          {conflict && baseline ? (
            <DraftConflict
              {...props}
              onUseLatest={(latest) => {
                if (
                  session.update({
                    expected: { revision: latest.revision, digest: latest.digest },
                    pending: null,
                  })
                )
                  save.reset();
              }}
            />
          ) : null}
          <Box>
            <Button
              variant="outline"
              onClick={() => {
                if (session.update({ pending: null })) save.reset();
              }}
            >
              {sv ? "Tillbaka till mina ändringar" : "Back to my changes"}
            </Button>
          </Box>
        </Box>
      ) : null}
      <DraftSaveFooter
        {...props}
        footerSummary={
          typeof props.footerSummary === "function"
            ? props.footerSummary(calculation.data)
            : props.footerSummary
        }
        saving={save.isPending}
        problem={refused || invalidInput}
        conflict={conflict}
        onContinue={() => {
          if (pending) save.mutate(pending);
        }}
        onReview={() => problem.current?.scrollIntoView({ block: "center" })}
      />
    </Box>
  );
}

function useCommercialPreview(
  props: SaveProps,
  previewInput: { key: string; json: string } | null,
  editingKey: string,
) {
  const { book, session } = props;
  const baseline = session.state.baseline;
  const currentPreview = previewInput?.key === editingKey ? previewInput : null;

  const target: typeof Drafts.CalculationTarget.Type = baseline
    ? {
        kind: "existing",
        id: baseline.id,
        revision: session.state.expected?.revision ?? baseline.revision,
        digest: session.state.expected?.digest ?? baseline.digest,
      }
    : { kind: "new" };

  const preview = useQuery({
    queryKey: [...bookKey(book), "commercial-preview", currentPreview?.json, target],
    enabled: currentPreview !== null,
    retry: false,
    queryFn: async ({ signal }) => {
      if (!currentPreview) throw new Error("Commercial preview input is missing");

      const commercial = Schema.decodeSync(Schema.fromJsonString(Drafts.CommercialContent))(
        currentPreview.json,
      );

      const canonical = canonicalizeJson(commercial);

      if (Result.isFailure(canonical)) throw canonical.failure;
      const bytes = new Uint8Array(canonical.success.bytes);
      const hashed = await crypto.subtle.digest("SHA-256", bytes);
      const inputDigest = `sha256:${Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;

      const result = await readAccounting(
        (client, requestOptions) =>
          client.invoiceDrafts.calculateCommercialDraft(
            httpRequest(
              Api.groups.invoiceDrafts.endpoints.calculateCommercialDraft,
              { params: { ...bookScope(book) } },
              requestOptions,
            ),
          ),
        Drafts.CommercialDraftCalculation,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ target, commercial, inputDigest }),
        },
      );

      checkScope(book, result.scope);

      if (
        result.inputDigest !== inputDigest ||
        JSON.stringify(result.target) !== JSON.stringify(target)
      )
        throw new Error("Commercial preview identity mismatch");

      return result;
    },
  });

  return {
    data: currentPreview === null ? undefined : preview.data,
    status: props.previewInput ? (
      <AccountingStatus
        locale={props.locale}
        pending={currentPreview !== null && preview.isPending}
        error={currentPreview === null ? null : preview.error}
      />
    ) : null,
  };
}

function DraftSaveFooter(
  props: Omit<SaveProps, "footerSummary"> & { footerSummary: ReactNode } & {
    saving: boolean;
    problem: boolean;
    conflict: boolean;
    onContinue: () => void;
    onReview: () => void;
  },
) {
  const sv = props.locale === "sv";
  const session = props.session;
  const pending = session.state.pending;

  return (
    <FormActions sticky>
      <Box display="grid" gap="sm">
        {props.footerSummary}
        {pending && !props.saving && !props.problem ? (
          <Text role="status">
            {sv
              ? "Sparandet är inte bekräftat. Fortsätt med samma begäran."
              : "The save is not confirmed. Continue with the same request."}
          </Text>
        ) : null}
      </Box>
      {!pending || props.saving ? (
        <Button
          type="submit"
          disabled={!!pending || !session.state.customer || session.storageError}
        >
          {props.saving ? (sv ? "Sparar…" : "Saving…") : sv ? "Spara utkast" : "Save draft"}
        </Button>
      ) : !props.problem ? (
        <Button disabled={session.storageError} onClick={props.onContinue}>
          {sv ? "Fortsätt spara" : "Continue saving"}
        </Button>
      ) : (
        <Button variant="outline" onClick={props.onReview}>
          {props.conflict
            ? sv
              ? "Granska ändringarna"
              : "Review changes"
            : sv
              ? "Granska uppgifterna"
              : "Review details"}
        </Button>
      )}
    </FormActions>
  );
}

function DraftConflict(
  props: SaveProps & { onUseLatest: (record: typeof Drafts.InvoiceDraftRevision.Type) => void },
) {
  const sv = props.locale === "sv";
  const id = props.session.state.baseline?.id;

  const latest = useQuery({
    queryKey: [...bookKey(props.book), "invoice-conflict", id],
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const view = await readAccounting(
        (client) =>
          client.invoiceDrafts.getInvoiceDraft({
            params: { ...bookScope(props.book), id: id ?? "" },
            query: httpQuery(Api.groups.invoiceDrafts.endpoints.getInvoiceDraft, ``),
          }),
        Drafts.InvoiceDraftView,
        { signal },
      );

      checkScope(props.book, view.record.scope);

      if (
        view.record.id !== id ||
        view.record.revision !== view.currentRevision ||
        view.record.digest !== view.currentDigest
      )
        throw new Error("Current invoice draft mismatch");

      return view.record;
    },
  });

  const changed =
    latest.data &&
    latest.data.digest !==
      (props.session.state.expected?.digest ?? props.session.state.baseline?.digest);

  return (
    <Box display="grid" gap="md">
      <Text role="alert">
        {sv
          ? "Fakturan eller kunduppgifterna ändrades sedan du började. Dina ändringar finns kvar och har inte skrivit över den sparade versionen."
          : "The invoice or customer details changed since you started. Your changes are kept and have not overwritten the saved version."}
      </Text>
      <AccountingStatus locale={props.locale} pending={latest.isPending} error={latest.error} />
      {latest.isSuccess && latest.isFetchedAfterMount && !latest.isFetching ? (
        <>
          <Details
            title={
              sv
                ? `Senast sparat, version ${latest.data.revision}`
                : `Latest saved, revision ${latest.data.revision}`
            }
          >
            <Text>
              <strong>{latest.data.content.title}</strong>
            </Text>
            <InvoiceDraftDocument record={latest.data} locale={props.locale} />
          </Details>
          {changed ? (
            <>
              <Text tone="muted">
                {sv
                  ? "Granska den sparade versionen. Fortsätt sedan med dina egna uppgifter om de ska ersätta den; inget sparas förrän du väljer Spara utkast igen."
                  : "Review the saved version. Then continue with your entered details if they should replace it; nothing is saved until you choose Save draft again."}
              </Text>
              <Box>
                <Button variant="outline" onClick={() => props.onUseLatest(latest.data)}>
                  {sv ? "Fortsätt med mina ändringar" : "Continue with my changes"}
                </Button>
              </Box>
            </>
          ) : (
            <Text>
              {sv
                ? "Välj kunden igen för att läsa in aktuella kunduppgifter innan du försöker spara."
                : "Select the customer again to use their current details before saving."}
            </Text>
          )}
        </>
      ) : null}
      {latest.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void latest.refetch();
          }}
        >
          {sv ? "Läs senaste versionen igen" : "Reload the latest revision"}
        </Button>
      ) : null}
    </Box>
  );
}
