import { queryOptions } from "@tanstack/react-query";
import type * as Accounting from "@open-erp/contracts/accounting";
import * as Workspace from "@open-erp/contracts/workspace";
import { bookKey, bookPath, readAccounting } from "./accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function workQueryOptions(
  book: typeof Accounting.Book.Type,
  filters: typeof Workspace.WorkQuery.Type,
) {
  const query = new URLSearchParams();

  if (filters.period) query.set("period", filters.period);

  if (filters.status) query.set("status", filters.status);

  if (filters.sort) query.set("sort", filters.sort);

  if (filters.q) query.set("q", filters.q);

  if (filters.after) query.set("after", filters.after);

  return queryOptions({
    queryKey: [...bookKey(book), "work", query.toString()],
    queryFn: async ({ signal }) => {
      const page = await readAccounting(`${bookPath(book)}/work?${query}`, Workspace.WorkPage, {
        signal,
      });

      if (page.scope.entityId !== book.entityId || page.scope.bookId !== book.id)
        throw new Error("Work list scope mismatch");

      return page;
    },
    retry: false,
  });
}

export function formatMinorAmount(minor: string, scale: number, locale: Locale) {
  const amount = BigInt(minor);
  const divisor = 10n ** BigInt(scale);
  const whole = amount / divisor;
  const remainder = amount < 0n ? -(amount % divisor) : amount % divisor;

  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  });

  return formatter
    .formatToParts(amount < 0n && whole === 0n ? -0 : whole)
    .map((part) =>
      part.type === "fraction" ? remainder.toString().padStart(scale, "0") : part.value,
    )
    .join("");
}

/** Decimal entry accepts either decimal separator, never grouping or floating-point rounding. */
export function decimalToMinor(value: string, scale: number): string | null {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6) return null;
  const normalized = value.trim();

  if (normalized === "") return "0";

  if (!/^\d+(?:[.,]\d+)?$/.test(normalized)) return null;
  const [whole = "", fraction = ""] = normalized.replace(",", ".").split(".");

  if (fraction.length > scale || whole.length > 38) return null;
  const minor = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");

  return minor.toString().length <= 38 ? minor.toString() : null;
}

export function minorToDecimal(value: string, scale: number) {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(scale + 1, "0");

  return `${negative ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}

export function signedDecimalToMinor(value: string, scale: number) {
  const text = value.trim();
  const negative = text.startsWith("-");
  const amount = decimalToMinor(negative ? text.slice(1) : text, scale);

  return amount === null ? null : negative && amount !== "0" ? `-${amount}` : amount;
}
