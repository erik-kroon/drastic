import { useQuery } from "@tanstack/react-query";
import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function ClientPeriod({
  book,
  locale,
}: {
  book: typeof Accounting.Book.Type;
  locale: Locale;
}) {
  const setup = useQuery({
    queryKey: [...bookKey(book), "setup"],
    queryFn: ({ signal }) =>
      readAccounting(`${bookPath(book)}/setup`, Accounting.BookSetup, { signal }),
    retry: false,
  });
  const sv = locale === "sv";
  if (setup.isError) return sv ? "Ej tillgängligt" : "Unavailable";
  if (setup.isPending) return "…";
  const period = setup.data.periods.at(-1);
  if (!period) return sv ? "Ingen period" : "No period";
  return (
    <Box display="grid" gap="sm">
      <Link href={`${workspacePath(book)}/closing?record=${encodeURIComponent(period.id)}`}>
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
