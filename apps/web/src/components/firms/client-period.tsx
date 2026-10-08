import * as Accounting from "@open-erp/contracts/accounting";
import type * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Badge } from "@open-erp/ui/components/badge";
import { Link } from "@open-erp/ui/components/link";
import { workspacePath } from "@/lib/book-context";
import type { Locale } from "@/paraglide/runtime";

export function ClientPeriod({
  book,
  period,
  locale,
  onOpen,
}: {
  book: typeof Accounting.Book.Type;
  period: (typeof Firms.PortfolioClientFacts.Type)["period"];
  locale: Locale;
  onOpen?: () => void;
}) {
  const sv = locale === "sv";

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
