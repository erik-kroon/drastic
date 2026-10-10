import type * as Accounting from "@open-erp/contracts/accounting";
import type * as Effect from "effect/Effect";
import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery, type AccountingClient } from "@/lib/contract-client";
import { useCommandKeys } from "@/lib/command-keys";
import * as Onboarding from "@open-erp/contracts/onboarding";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, isUncertainWriteError, readAccounting } from "@/lib/accounting-api";

export async function readOnboardingWorkspace(
  book: typeof Accounting.Book.Type,
  signal: AbortSignal,
) {
  const first = await readAccounting(
    (client) => client.onboarding.getOnboarding({ params: bookScope(book), query: {} }),
    Onboarding.OnboardingWorkspace,
    { signal },
  );

  const sources = [...first.sources];
  const imports = [...first.imports];
  let sourceAfter = first.nextSourceCursor;
  let importAfter = first.nextImportCursor;
  const cursors = new Set<string>();

  while (sourceAfter || importAfter) {
    const query = new URLSearchParams();

    if (sourceAfter) query.set("sourceAfter", sourceAfter);

    if (importAfter) query.set("importAfter", importAfter);
    const cursor = query.toString();

    if (cursors.has(cursor)) throw new Error("Onboarding pagination did not advance.");
    cursors.add(cursor);

    const page = await readAccounting(
      (client) =>
        client.onboarding.getOnboarding({
          params: bookScope(book),
          query: httpQuery(Api.groups.onboarding.endpoints.getOnboarding, query),
        }),
      Onboarding.OnboardingWorkspace,
      {
        signal,
      },
    );

    if (
      page.sourceCount !== first.sourceCount ||
      page.case.digest !== first.case.digest ||
      page.case.scope.bookId !== first.case.scope.bookId ||
      page.case.scope.entityId !== first.case.scope.entityId
    )
      throw new Error("The onboarding workspace changed while loading sources.");

    if (sourceAfter) sources.push(...page.sources);

    if (importAfter) imports.push(...page.imports);
    sourceAfter = sourceAfter ? page.nextSourceCursor : null;
    importAfter = importAfter ? page.nextImportCursor : null;

    if (sources.length > 1000 || imports.length > 1000)
      throw new Error("The onboarding inventory exceeds its supported scope.");
  }

  if (BigInt(first.sourceCount) !== BigInt(sources.length))
    throw new Error("The onboarding source inventory is incomplete.");

  if (
    new Set(sources.map((source) => source.id)).size !== sources.length ||
    new Set(imports.map((item) => item.sourceRunId)).size !== imports.length
  )
    throw new Error("The onboarding inventory contains repeated entries.");

  return { ...first, sources, imports, nextSourceCursor: null, nextImportCursor: null };
}

export function useOnboardingCommand<
  I extends Schema.Top & { readonly DecodingServices: never },
  O extends Schema.Top & { readonly DecodingServices: never },
>(
  command: {
    readonly identity: string;
    readonly execute: (
      client: AccountingClient,
      options: RequestInit,
    ) => Effect.Effect<O["Type"], unknown>;
  },
  input: I,
  output: O,
  onSuccess?: (result: O["Type"]) => void,
) {
  const { book } = useBookWorkspace();
  const cache = useQueryClient();
  const keys = useCommandKeys();

  const mutation = useMutation({
    mutationFn: (value: I["Type"]) =>
      readAccounting(
        command.execute,
        output,
        keys.current.options(
          command.identity,
          JSON.stringify(Schema.decodeUnknownSync(input)(value)),
        ),
      ),
    onSuccess: async (result) => {
      await cache.invalidateQueries({ queryKey: bookKey(book) });
      onSuccess?.(result);
    },
  });

  const uncertain = isUncertainWriteError(mutation.error);

  return { ...mutation, uncertain, disabled: book.role !== "operator" || mutation.isPending };
}

export function useOnboardingFacts(asOf: string) {
  const { book } = useBookWorkspace();

  return useQuery({
    queryKey: [...bookKey(book), "company-facts", asOf],
    queryFn: async ({ signal }) => {
      const items: Array<(typeof Profiles.CompanyFactPage.Type.items)[number]> = [];
      const cursors = new Set<string>();
      let after: string | null = null;

      do {
        const page: typeof Profiles.CompanyFactPage.Type = await readAccounting(
          (client) =>
            client.companyProfile.listCompanyFacts({
              params: { ...bookScope(book) },
              query: httpQuery(
                Api.groups.companyProfile.endpoints.listCompanyFacts,
                `${after ? `?after=${encodeURIComponent(after)}` : ""}`,
              ),
            }),
          Profiles.CompanyFactPage,
          { signal },
        );

        items.push(...page.items);
        after = page.nextCursor;

        if (after && cursors.has(after))
          throw new Error("The company facts cursor did not advance.");

        if (after) cursors.add(after);
      } while (after);

      const applicable = items.filter(
        (item) =>
          item.revision.effectiveFrom <= asOf &&
          (item.revision.effectiveTo === null || item.revision.effectiveTo >= asOf),
      );

      return applicable.filter(
        (item) =>
          !applicable.some((candidate) => candidate.revision.supersedesId === item.revision.id),
      );
    },
    retry: false,
  });
}

export function formatDate(value: string | null, year = true) {
  if (!value) return "Ej angivet";

  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    year: year ? "numeric" : undefined,
    timeZone: "Europe/Stockholm",
  })
    .format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value))
    .replace(/\./g, "");
}

export function formatMoment(value: string) {
  return `${formatDate(value, false)} ${new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }).format(new Date(value))}`;
}

export function formatMinor(value: string) {
  const amount = BigInt(value);
  const magnitude = amount < 0n ? -amount : amount;

  return `${amount < 0n ? "−" : ""}${new Intl.NumberFormat("sv-SE").format(magnitude / 100n)},${(magnitude % 100n).toString().padStart(2, "0")}`;
}
