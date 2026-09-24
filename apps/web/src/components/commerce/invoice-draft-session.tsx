import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import * as Commerce from "@open-erp/contracts/commerce";
import * as Drafts from "@open-erp/contracts/invoice-drafts";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Text } from "@open-erp/ui/components/typography";
import { FormDialog } from "@open-erp/ui/components/form-dialog";
import { AccountingStatus } from "@/components/accounting-status";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { checkScope, type CommerceProps } from "./shared";
import { editableInvoiceLine } from "./invoice-editor-lines";

type Draft = typeof Drafts.InvoiceDraftRevision.Type;
const PendingSave = Schema.Struct({
  key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  source: Accounting.CreateEvidence,
  fields: Schema.Record(Schema.String, Schema.String),
  input: Schema.NullOr(Schema.Unknown),
});
const EditingState = Schema.Struct({
  baseline: Schema.NullOr(Drafts.InvoiceDraftRevision),
  expected: Schema.optional(
    Schema.Struct({ revision: Commerce.Version, digest: Accounting.Digest }),
  ),
  draftKey: Accounting.Identifier,
  customer: Schema.NullOr(Commerce.CounterpartyRevision),
  fields: Schema.Record(Schema.String, Schema.String),
  lines: Schema.Array(
    Schema.Struct({
      id: Accounting.Identifier,
      defaults: Schema.optional(Drafts.DraftLine),
      quantity: Schema.String,
      price: Schema.String,
      amount: Schema.String,
      tax: Schema.String,
      explicitAmount: Schema.Boolean,
    }),
  ),
  pending: Schema.NullOr(PendingSave),
});
export type DraftEditingState = typeof EditingState.Type;
export type DraftSession = {
  state: DraftEditingState;
  actorId: string;
  storageError: boolean;
  update: (patch: Partial<DraftEditingState>) => boolean;
  saved: (record: Draft) => void;
};
type SessionProps = CommerceProps & {
  baseline?: Draft;
  onClose: () => void;
  onSaved: (record: Draft) => void;
  children: (session: DraftSession) => ReactNode;
};

export function InvoiceDraftSession(props: SessionProps) {
  const actor = useSavedPostingRequests(props.book);
  const actorId = actor.data?.actorId;
  const identity = JSON.stringify([
    "openerp:invoice-editor:v1",
    actorId,
    props.book.entityId,
    props.book.id,
    props.baseline?.id ?? "new",
  ]);
  const local = useQuery({
    queryKey: ["invoice-editor", identity],
    enabled: actor.isSuccess && !actor.isFetching && typeof window !== "undefined",
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    gcTime: 0,
    retry: false,
    queryFn: () => {
      const text = localStorage.getItem(identity);
      if (text === null) return null;
      const saved = Schema.decodeUnknownSync(EditingState)(JSON.parse(text));
      if (saved.baseline) checkScope(props.book, saved.baseline.scope);
      if (saved.customer) checkScope(props.book, saved.customer.scope);
      if ((saved.baseline?.id ?? undefined) !== props.baseline?.id)
        throw new Error("Invoice editor identity mismatch");
      if (saved.pending?.input != null)
        Schema.decodeUnknownSync(
          saved.baseline ? Drafts.ReviseInvoiceDraft : Drafts.CreateInvoiceDraft,
        )(saved.pending.input);
      return saved;
    },
  });
  if (!actorId || !local.isSuccess || !local.isFetchedAfterMount)
    return (
      <FormDialog
        title={props.locale === "sv" ? "Fakturautkast" : "Invoice draft"}
        closeLabel={props.locale === "sv" ? "Stäng" : "Close"}
        onClose={props.onClose}
      >
        <AccountingStatus
          locale={props.locale}
          pending={!actor.isError && !local.isError}
          error={actor.error ?? local.error}
        />
        {actor.isError || local.isError ? (
          <Button
            variant="outline"
            onClick={() => {
              void actor.refetch();
              void local.refetch();
            }}
          >
            {props.locale === "sv" ? "Försök igen" : "Try again"}
          </Button>
        ) : null}
      </FormDialog>
    );
  return (
    <EditingSession
      key={identity}
      {...props}
      identity={identity}
      actorId={actorId}
      restored={local.data}
    />
  );
}

function canonical(text: string | null) {
  return text === null
    ? null
    : JSON.stringify(Schema.decodeUnknownSync(EditingState)(JSON.parse(text)));
}
class ConcurrentInvoiceEdit extends Error {}

function initialState(baseline?: Draft): DraftEditingState {
  return {
    baseline: baseline ?? null,
    draftKey: baseline?.draftKey ?? `draft_${crypto.randomUUID().replaceAll("-", "")}`,
    customer: baseline?.counterparty ?? null,
    fields: {},
    lines: baseline
      ? baseline.content.lines.map((line) =>
          editableInvoiceLine(baseline.content.currencyScale, line),
        )
      : [editableInvoiceLine(0)],
    pending: null,
  };
}

function EditingSession(
  props: SessionProps & { identity: string; actorId: string; restored: DraftEditingState | null },
) {
  const sv = props.locale === "sv";
  const [state, setState] = useState(() => props.restored ?? initialState(props.baseline));
  const current = useRef(state);
  const leaving = useRef(false);
  const retained = useRef(props.restored ? JSON.stringify(props.restored) : null);
  const [restored] = useState(props.restored !== null);
  const [dirty, setDirty] = useState(props.restored !== null);
  const [storageError, setStorageError] = useState(false);
  const [storageIssue, setStorageIssue] = useState<"conflict" | "pending_elsewhere" | "unavailable" | null>(null);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [closing, setClosing] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    withResolver: true,
    enableBeforeUnload: () => storageError && dirty && !leaving.current,
  });
  function update(patch: Partial<DraftEditingState>) {
    const next = { ...current.current, ...patch };
    current.current = next;
    setState(next);
    setDirty(true);
    try {
      const existing = localStorage.getItem(props.identity);
      if (canonical(existing) !== canonical(retained.current))
        throw new ConcurrentInvoiceEdit("Invoice edits changed in another tab");
      const text = JSON.stringify(Schema.decodeSync(EditingState)(next));
      localStorage.setItem(props.identity, text);
      if (localStorage.getItem(props.identity) !== text) throw new Error("Draft not retained");
      retained.current = text;
      setStorageError(false);
      setStorageIssue(null);
      return true;
    } catch (error) {
      setStorageError(true);
      setStorageIssue(error instanceof ConcurrentInvoiceEdit ? "conflict" : "unavailable");
      return false;
    }
  }
  function clear() {
    const existing = localStorage.getItem(props.identity);
    if (canonical(existing) !== canonical(retained.current))
      throw new ConcurrentInvoiceEdit("Invoice edits changed in another tab");
    localStorage.removeItem(props.identity);
    if (localStorage.getItem(props.identity) !== null)
      throw new Error("Invoice edits could not be cleared");
  }
  function leave(discard: boolean) {
    if (discard) {
      try {
        clear();
      } catch (error) {
        setStorageError(true);
        setStorageIssue(error instanceof ConcurrentInvoiceEdit ? "conflict" : "unavailable");
        return;
      }
    }
    leaving.current = true;
    if (blocker.status === "blocked") blocker.proceed();
    else props.onClose();
  }
  function saved(record: Draft) {
    try {
      clear();
    } catch {
      // The server result is authoritative. Never remove another tab's edits.
    }
    leaving.current = true;
    props.onSaved(record);
  }
  function loadOtherTab() {
    try {
      const text = localStorage.getItem(props.identity);
      if (text === null) throw new Error("No retained invoice edits");
      const next = Schema.decodeUnknownSync(EditingState)(JSON.parse(text));
      if (next.baseline) checkScope(props.book, next.baseline.scope);
      if (next.customer) checkScope(props.book, next.customer.scope);
      if ((next.baseline?.id ?? undefined) !== props.baseline?.id)
        throw new Error("Invoice editor identity mismatch");
      if (next.pending?.input != null)
        Schema.decodeUnknownSync(
          next.baseline ? Drafts.ReviseInvoiceDraft : Drafts.CreateInvoiceDraft,
        )(next.pending.input);
      current.current = next;
      setState(next);
      setEditorVersion((version) => version + 1);
      retained.current = text;
      setDirty(true);
      setStorageError(false);
      setStorageIssue(null);
    } catch {
      setStorageIssue("unavailable");
    }
  }
  function takeOver() {
    setTakeoverOpen(false);
    try {
      const existing = localStorage.getItem(props.identity);
      if (existing && Schema.decodeUnknownSync(EditingState)(JSON.parse(existing)).pending) {
        setStorageIssue("pending_elsewhere");
        return;
      }
      const text = JSON.stringify(Schema.decodeSync(EditingState)(current.current));
      localStorage.setItem(props.identity, text);
      if (localStorage.getItem(props.identity) !== text) throw new Error("Draft not retained");
      retained.current = text;
      setStorageError(false);
      setStorageIssue(null);
    } catch {
      setStorageIssue("unavailable");
    }
  }
  const cancelClose = () => {
    setClosing(false);
    blocker.reset?.();
  };
  return (
    <>
      <FormDialog
        title={
          state.baseline
            ? sv
              ? "Redigera faktura"
              : "Edit invoice"
            : sv
              ? "Ny faktura"
              : "New invoice"
        }
        closeLabel={sv ? "Stäng" : "Close"}
        onClose={() => (dirty ? setClosing(true) : props.onClose())}
      >
        <Box display="grid" gap="md">
          {restored && !state.pending ? (
            <Text tone="muted">
              {sv
                ? "Dina osparade ändringar har återställts från den här webbläsaren."
                : "Your unsaved changes have been restored from this browser."}
            </Text>
          ) : null}
          {storageError ? (
            <StorageRecovery
              sv={sv}
              issue={storageIssue}
              pending={!!state.pending}
              retry={() => update({})}
              loadOtherTab={loadOtherTab}
              requestTakeover={() => setTakeoverOpen(true)}
            />
          ) : null}
          <Box key={editorVersion}>
            {props.children({
              state,
              actorId: props.actorId,
              storageError,
              update,
              saved,
            })}
          </Box>
        </Box>
      </FormDialog>
      {takeoverOpen ? (
        <TakeoverDialog sv={sv} onClose={() => setTakeoverOpen(false)} onTakeOver={takeOver} />
      ) : null}
      {closing || blocker.status === "blocked" ? (
        <FormDialog
          size="compact"
          title={sv ? "Stäng fakturautkastet?" : "Close this invoice draft?"}
          closeLabel={sv ? "Fortsätt redigera" : "Keep editing"}
          onClose={cancelClose}
        >
          <Box display="grid" gap="lg">
            <Text>
              {state.pending
                ? sv
                  ? "Sparandet är inte bekräftat. Begäran behålls så att du kan fortsätta med samma uppgifter när du öppnar utkastet igen."
                  : "The save is not confirmed. Its request will be kept so you can continue with the same details when you reopen this draft."
                : sv
                  ? "Ändringarna är inte sparade till fakturan. Du kan behålla dem i den här webbläsaren och fortsätta senare."
                  : "These changes are not saved to the invoice. You can keep them in this browser and continue later."}
            </Text>
            <Box display="flex" flexWrap="wrap" gap="md">
              <Button onClick={cancelClose}>{sv ? "Fortsätt redigera" : "Keep editing"}</Button>
              <Button variant="outline" disabled={storageError} onClick={() => leave(false)}>
                {sv ? "Stäng och behåll ändringar" : "Close and keep changes"}
              </Button>
              {!state.pending ? (
                <Button variant="ghost" onClick={() => leave(true)}>
                  {sv ? "Kasta ändringar" : "Discard changes"}
                </Button>
              ) : null}
            </Box>
          </Box>
        </FormDialog>
      ) : null}
    </>
  );
}

function StorageRecovery(props: {
  sv: boolean;
  issue: "conflict" | "pending_elsewhere" | "unavailable" | null;
  pending: boolean;
  retry: () => void;
  loadOtherTab: () => void;
  requestTakeover: () => void;
}) {
  const { sv, issue } = props;
  const message = issue === "pending_elsewhere"
    ? sv
      ? "Den andra fliken har en obekräftad begäran. Återuppta den innan ändringarna ersätts."
      : "The other tab has an unconfirmed request. Recover it before replacing its edits."
    : issue === "conflict"
    ? props.pending
      ? sv
        ? "En annan flik har sparat ändringar medan en begäran väntar. Återuppta begäran i den ursprungliga fliken innan du fortsätter här."
        : "Another tab saved edits while a request is pending. Recover the request in the original tab before continuing here."
      : sv
        ? "En annan flik har sparat ändringar i det här utkastet. Välj vilken fliks osparade ändringar du vill fortsätta med."
        : "Another tab saved edits for this draft. Choose which tab’s unsaved edits to continue with."
    : sv
      ? "Ändringarna kunde inte behållas i webbläsaren. Stanna kvar och försök igen innan du laddar om."
      : "Your changes could not be kept in this browser. Stay here and retry before reloading.";
  return (
    <Box display="grid" gap="sm">
      <Text role="alert">{message}</Text>
      {issue === "pending_elsewhere" ? (
        <Button variant="outline" onClick={props.loadOtherTab}>
          {sv ? "Öppna andra flikens begäran" : "Open the other tab’s request"}
        </Button>
      ) : issue === "conflict" && !props.pending ? (
        <Box display="flex" flexWrap="wrap" gap="md">
          <Button variant="outline" onClick={props.loadOtherTab}>
            {sv ? "Använd andra flikens ändringar" : "Use the other tab’s edits"}
          </Button>
          <Button variant="outline" onClick={props.requestTakeover}>
            {sv ? "Behåll den här flikens ändringar" : "Keep this tab’s edits"}
          </Button>
        </Box>
      ) : issue === "unavailable" ? (
        <Button variant="outline" onClick={props.retry}>
          {sv ? "Försök behålla ändringarna igen" : "Retry keeping changes"}
        </Button>
      ) : null}
    </Box>
  );
}

function TakeoverDialog(props: { sv: boolean; onClose: () => void; onTakeOver: () => void }) {
  return (
    <FormDialog
      size="compact"
      title={props.sv ? "Behåll den här flikens ändringar?" : "Keep this tab’s edits?"}
      closeLabel={props.sv ? "Avbryt" : "Cancel"}
      onClose={props.onClose}
    >
      <Box display="grid" gap="lg">
        <Text>
          {props.sv
            ? "De osparade ändringarna från den andra fliken ersätts i den här webbläsaren."
            : "The other tab’s unsaved edits will be replaced in this browser."}
        </Text>
        <Button onClick={props.onTakeOver}>
          {props.sv ? "Behåll mina ändringar" : "Keep my edits"}
        </Button>
      </Box>
    </FormDialog>
  );
}

export function restoredField(session: DraftSession, name: string, fallback = "") {
  return session.state.fields[name] ?? fallback;
}
export function selectDraftCustomer(
  session: DraftSession,
  customer: typeof Commerce.CounterpartyRevision.Type,
) {
  const fields = { ...session.state.fields };
  for (const key of ["customerName", "customerRegistration", "customerAddress", "customerCountry"])
    delete fields[key];
  session.update({ customer, fields });
}
