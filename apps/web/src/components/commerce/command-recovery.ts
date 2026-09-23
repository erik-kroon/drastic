import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Accounting from "@open-erp/contracts/accounting";
import { useSavedPostingRequests } from "@/components/posting-recovery/saved-requests";
import { bookKey } from "@/lib/accounting-api";

/** A tab-local pending request. Server reads/receipts remain the authority for its result. */
export function useCommerceCommandRecovery<
  S extends Schema.Top & { readonly DecodingServices: never },
>(props: { book: typeof Accounting.Book.Type; path: string; id?: string; schema: S }) {
  const actor = useSavedPostingRequests(props.book, null, props.id !== undefined);
  const client = useQueryClient();
  const actorId = actor.data?.actorId;
  const identity = JSON.stringify([
    "openerp:commerce-request:v1",
    actorId,
    props.book.entityId,
    props.book.id,
    props.path,
    props.id,
  ]);
  const queryKey = [...bookKey(props.book), "commerce-request", identity];
  const requestSchema = Schema.Struct({
    key: Accounting.IdempotencyHeaders.fields["idempotency-key"],
    input: Schema.Unknown,
  });
  function decode(text: string) {
    const stored = Schema.decodeUnknownSync(requestSchema)(JSON.parse(text));
    return { key: stored.key, input: Schema.decodeUnknownSync(props.schema)(stored.input) };
  }
  const saved = useQuery({
    queryKey,
    queryFn: () => {
      const text = sessionStorage.getItem(identity);
      return text === null ? null : decode(text);
    },
    enabled:
      props.id !== undefined &&
      actor.isSuccess &&
      !actor.isFetching &&
      typeof window !== "undefined",
    staleTime: Infinity,
    retry: false,
  });
  const enabled = props.id !== undefined;
  const ready = !enabled || (actor.isSuccess && !actor.isFetching && saved.isSuccess);
  function retain(request: { key: string; input: S["Type"] }) {
    if (!enabled) return;
    if (!ready || !actorId) throw new Error("Command recovery is not ready");
    const existing = sessionStorage.getItem(identity);
    if (existing !== null) {
      const original = decode(existing);
      if (
        original.key !== request.key ||
        JSON.stringify(original.input) !== JSON.stringify(request.input)
      )
        throw new Error("A different command is already waiting for recovery");
    }
    const text = JSON.stringify(request);
    sessionStorage.setItem(identity, text);
    if (sessionStorage.getItem(identity) !== text)
      throw new Error("Command recovery could not be saved");
    client.setQueryData(queryKey, request);
  }
  function clear(key: string) {
    if (!enabled) return;
    const text = sessionStorage.getItem(identity);
    if (text !== null) {
      const original = decode(text);
      if (original.key !== key) throw new Error("Command recovery identity changed");
      sessionStorage.removeItem(identity);
      if (sessionStorage.getItem(identity) !== null)
        throw new Error("Command recovery could not be cleared");
    }
    client.setQueryData(queryKey, null);
  }
  return {
    ready,
    saved: enabled && saved.isSuccess ? saved.data : null,
    error: enabled ? (actor.error ?? saved.error) : null,
    retain,
    clear,
    refresh: () => {
      void actor.refetch();
      void saved.refetch();
    },
  };
}
