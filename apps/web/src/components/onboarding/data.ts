import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Schema from "effect/Schema";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { useBookWorkspace } from "@/lib/book-context";
import {
  bookKey,
  bookPath,
  isUncertainWriteError,
  mutationOptions,
  readAccounting,
} from "@/lib/accounting-api";

export function useOnboardingCommand<
  I extends Schema.Top & { readonly DecodingServices: never },
  O extends Schema.Top & { readonly DecodingServices: never },
>(path: string, input: I, output: O, onSuccess?: (result: O["Type"]) => void) {
  const { book } = useBookWorkspace();
  const cache = useQueryClient();
  const keys = useRef(new Map<string, string>());

  const mutation = useMutation({
    mutationFn: (value: I["Type"]) =>
      readAccounting(
        path,
        output,
        mutationOptions(path, JSON.stringify(Schema.decodeUnknownSync(input)(value)), keys.current),
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
          `${bookPath(book)}/company-facts${after ? `?after=${encodeURIComponent(after)}` : ""}`,
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
  return `${formatDate(value)} ${new Intl.DateTimeFormat("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" }).format(new Date(value))}`;
}

export function formatMinor(value: string) {
  const amount = BigInt(value);
  const magnitude = amount < 0n ? -amount : amount;

  return `${amount < 0n ? "−" : ""}${new Intl.NumberFormat("sv-SE").format(magnitude / 100n)},${(magnitude % 100n).toString().padStart(2, "0")}`;
}
