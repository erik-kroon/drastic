import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function clientPeriodQueryOptions(book: typeof Accounting.Book.Type) {
  return {
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  };
}

export function latestClientPeriod(setup: typeof Accounting.BookSetup.Type) {
  return [...setup.periods].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0];
}

export function ClientPeriod({
  book,
  locale,
  onOpen,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
  onOpen?: () => void;
}) {
  const setup = useQuery(clientPeriodQueryOptions(book));
  const sv = locale === "sv";

  if (setup.isError) return sv ? "Ej tillgängligt" : "Unavailable";

  if (setup.isPending) return "…";
  const period = latestClientPeriod(setup.data);

  if (!period) return sv ? "Ingen period" : "No period";

  return (
    <Box display="grid" gap="sm">
      <Link
        href={`${workspacePath(book)}/closing?record=${encodeURIComponent(period.id)}`}
        onClick={onOpen}
      >
        {period.startsOn} – {period.endsOn}
      </Link>
      <Box>
        <Badge variant="secondary">
          {period.locked ? (sv ? "Låst" : "Locked") : sv ? "Öppen" : "Open"}
        </Badge>
      </Box>
    </Box>
  );
}
