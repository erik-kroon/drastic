import * as Schema from "effect/Schema";
import * as Firms from "@open-erp/contracts/firms";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useHydrated, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import {
  AccessPanel,
  AccessIdentity,
  AccessScope,
  AccessFact,
  AccessField,
  AccessNote,
  AccessActions,
  AccessStatus,
} from "@open-erp/ui/kanon/access";
import { Action } from "@open-erp/ui/kanon/action";
import { AccountingAccess } from "@/components/accounting-access";
import { readAccounting } from "@/lib/accounting-api";
import { usePageLocale } from "@/lib/use-page-locale";

const PublicClient = Schema.Struct({
  client_id: Schema.String,
  client_name: Schema.optional(Schema.NullOr(Schema.String)),
  client_uri: Schema.optional(Schema.NullOr(Schema.String)),
});

const Selected = Schema.Struct({
  grant: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      firmId: Schema.String,
      bookId: Schema.String,
      firmName: Schema.String,
      bookName: Schema.String,
      available: Schema.Boolean,
    }),
  ),
});

const Selection = Schema.Struct({
  grantId: Schema.String,
  firmId: Schema.String,
  bookId: Schema.String,
});

const Continuation = Schema.Struct({ url: Schema.String });

function clientHost(uri: string | null | undefined) {
  if (!uri) return "Adress saknas";

  try {
    return new URL(uri).hostname;
  } catch {
    return "Adress saknas";
  }
}

async function continueAuthorization(query: string, accept?: boolean) {
  const response = await readAccounting(
    accept === undefined ? "/api/auth/oauth2/continue" : "/api/auth/oauth2/consent",
    Continuation,
    {
      method: "POST",
      body: JSON.stringify(
        accept === undefined
          ? { postLogin: true, oauth_query: query }
          : { accept, oauth_query: query },
      ),
    },
  );

  const destination = new URL(response.url, window.location.origin);

  if (!["https:", "http:"].includes(destination.protocol)) throw new Error("Ogiltig fortsättning");
  window.location.assign(destination.href);
}

export function OAuthAccess(props: { screen: "select" | "consent" | "login" }) {
  const locale = usePageLocale();

  return (
    <AccountingAccess locale={locale}>
      {() => <OAuthAccessContent screen={props.screen} />}
    </AccountingAccess>
  );
}

function useOAuthAccess(props: { screen: "select" | "consent" | "login" }) {
  const hydrated = useHydrated();
  const search = useLocation({ select: (location) => location.searchStr });

  const query = (typeof window === "undefined" ? search : window.location.search).replace(
    /^\?/,
    "",
  );

  const parameters = new URLSearchParams(query);
  const clientId = parameters.get("client_id") ?? "";
  const scopes = (parameters.get("scope") ?? "").split(" ").filter(Boolean);

  const supported =
    scopes.includes("mcp:read") &&
    scopes.every((scope) => ["openid", "offline_access", "mcp:read"].includes(scope));

  const [firmId, setFirmId] = useState("");
  const [bookId, setBookId] = useState("");

  const selected = useQuery({
    queryKey: ["oauth", "selected", query],
    enabled: hydrated,
    retry: false,
    staleTime: 0,
    queryFn: ({ signal }) =>
      readAccounting("/api/auth/oauth2/selected-grant", Selected, { signal }),
  });

  const client = useQuery({
    queryKey: ["oauth", "client", clientId],
    enabled: hydrated && clientId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      readAccounting(
        `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`,
        PublicClient,
        { signal },
      ),
  });

  const firms = useQuery({
    queryKey: ["oauth", "firms"],
    enabled: hydrated && props.screen === "select",
    retry: false,
    queryFn: ({ signal }) =>
      readAccounting((client) => client.firms.listFirms({}), Firms.FirmList, { signal }),
  });

  const workspace = useQuery({
    queryKey: ["oauth", "firm", firmId],
    enabled: hydrated && firmId !== "",
    retry: false,
    queryFn: ({ signal }) =>
      readAccounting(
        (client) => client.firms.getFirm({ params: { firmId: firmId } }),
        Firms.Workspace,
        { signal },
      ),
  });

  const action = useMutation({
    mutationFn: async (accept: boolean) => {
      if (!accept) return continueAuthorization(query, false);

      if (!supported || !client.data || client.data.client_id !== clientId)
        throw new Error("Åtkomsten kunde inte granskas");

      if (props.screen === "select") {
        if (!firmId || !workspace.data?.clients.some((entry) => entry.book.id === bookId))
          throw new Error("Välj byrå och bok");
        const retained = await selected.refetch();

        if (retained.isError) throw retained.error;

        if (
          retained.data?.grant?.available &&
          retained.data.grant.firmId === firmId &&
          retained.data.grant.bookId === bookId
        )
          return continueAuthorization(query);
        await readAccounting("/api/auth/oauth2/select-grant", Selection, {
          method: "POST",
          body: JSON.stringify({ firmId, bookId }),
        });

        return continueAuthorization(query);
      }

      if (props.screen === "login") return continueAuthorization(query);
      const current = await selected.refetch();

      if (!current.data?.grant?.available) throw new Error("Åtkomsten gäller inte längre");

      return continueAuthorization(query, true);
    },
  });

  return {
    selected,
    client,
    firms,
    workspace,
    action,
    firmId,
    bookId,
    setFirmId,
    setBookId,
    clientId,
    scopes,
    supported,
  };
}

function OAuthAccessContent(props: { screen: "select" | "consent" | "login" }) {
  const model = useOAuthAccess(props);
  const state = oauthViewState(model, props.screen);

  return (
    <AccessPanel title={state.select ? "Välj byrå och bok" : "Ge appen läsåtkomst"}>
      <AccessIdentity
        name={model.client.data?.client_name ?? model.clientId}
        host={clientHost(model.client.data?.client_uri)}
      />
      <OAuthScope model={model} select={state.select} />
      {state.select ? (
        <AccessNote secondary="Inget är valt i förväg.">
          Välj den bok appen ska få läsa. Du granskar åtkomsten innan du tillåter den.
        </AccessNote>
      ) : (
        <AccessNote
          secondary={
            model.scopes.includes("offline_access")
              ? "Åtkomsten kan fortsätta när du är utloggad. Du kan återkalla den i Drastic."
              : "Du kan återkalla åtkomsten i Drastic."
          }
        >
          Appen får läsa uppgifter i den valda boken. Den får inte ändra, godkänna, bokföra eller
          skicka något.
        </AccessNote>
      )}
      <OAuthStatus state={state} model={model} />
      <AccessActions>
        <Action
          kind="secondary"
          besidePrimary
          onClick={() => model.action.mutate(false)}
          blockedBy={model.action.isPending ? (state.select ? "Avbryt" : "Neka") : undefined}
        >
          {state.select ? "Avbryt" : "Neka"}
        </Action>
        <Action
          kind="primary"
          onClick={() => model.action.mutate(true)}
          blockedBy={
            state.unavailable
              ? "Åtkomsten gäller inte längre"
              : state.blocked
                ? state.primary
                : undefined
          }
        >
          {state.primary}
        </Action>
      </AccessActions>
    </AccessPanel>
  );
}

function OAuthScope({
  model,
  select,
}: {
  model: ReturnType<typeof useOAuthAccess>;
  select: boolean;
}) {
  const grant = model.selected.data?.grant;

  return (
    <AccessScope>
      {select ? (
        <>
          <AccessField
            label="Byrå"
            value={model.firmId}
            placeholder="Välj byrå"
            disabled={!model.firms.data || model.action.isPending}
            options={(model.firms.data ?? []).map((firm) => ({ value: firm.id, label: firm.name }))}
            onChange={(value) => {
              model.setFirmId(value);
              model.setBookId("");
            }}
          />
          <AccessField
            label="Bok"
            value={model.bookId}
            placeholder="Välj bok"
            disabled={!model.workspace.data || model.workspace.isFetching || model.action.isPending}
            options={(model.workspace.data?.clients ?? []).map((entry) => ({
              value: entry.book.id,
              label: entry.book.name,
            }))}
            onChange={model.setBookId}
          />
        </>
      ) : (
        <>
          <AccessFact label="Byrå" value={grant?.firmName ?? "Ingen byrå vald"} />
          <AccessFact label="Bok" value={grant?.bookName ?? "Ingen bok vald"} />
        </>
      )}
    </AccessScope>
  );
}

function oauthViewState(
  model: ReturnType<typeof useOAuthAccess>,
  screen: "select" | "consent" | "login",
) {
  const grant = model.selected.data?.grant;

  const pending =
    model.client.isPending ||
    model.selected.isPending ||
    model.client.isFetching ||
    model.selected.isFetching;

  const failed =
    model.client.isError ||
    model.selected.isError ||
    model.firms.isError ||
    model.workspace.isError;

  const select = screen === "select";

  const unavailable =
    !select && screen !== "login" && model.selected.isSuccess && !grant?.available;

  const blocked =
    pending ||
    failed ||
    !model.supported ||
    model.action.isPending ||
    unavailable ||
    (select && (!model.firmId || !model.bookId || model.workspace.isFetching));

  const primary = select
    ? model.firmId && model.bookId
      ? "Fortsätt"
      : "Välj byrå och bok"
    : screen === "login"
      ? "Fortsätt"
      : "Tillåt läsåtkomst";

  return { pending, failed, select, unavailable, blocked, primary };
}

function OAuthStatus(props: {
  state: ReturnType<typeof oauthViewState>;
  model: ReturnType<typeof useOAuthAccess>;
}) {
  const { state, model } = props;

  return (
    <>
      {state.pending ? (
        <AccessStatus>Hämtar åtkomsten…</AccessStatus>
      ) : state.unavailable ? (
        <AccessStatus>Den sparade behörigheten har återkallats eller ändrats.</AccessStatus>
      ) : state.failed ? (
        <AccessStatus>Åtkomsten kunde inte hämtas. Ladda om för att försöka igen.</AccessStatus>
      ) : !model.supported ? (
        <AccessStatus>Den begärda åtkomsten stöds inte.</AccessStatus>
      ) : null}
      {model.action.isError ? (
        <AccessStatus>
          Åtgärden kunde inte bekräftas. Försök igen för att kontrollera den sparade åtkomsten.
        </AccessStatus>
      ) : null}
    </>
  );
}
