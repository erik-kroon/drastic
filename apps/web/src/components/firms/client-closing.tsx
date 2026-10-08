import type * as Firms from "@open-erp/contracts/firms";
import { Link } from "@open-erp/ui/components/link";
import { workspacePath } from "@/lib/book-context";
import type * as Accounting from "@open-erp/contracts/accounting";
import type { Locale } from "@/paraglide/runtime";

export function ClientClosing({
  book,
  closing,
  locale,
  onOpen,
}: {
  book: typeof Accounting.Book.Type;
  closing: (typeof Firms.PortfolioClientFacts.Type)["closing"];
  locale: Locale;
  onOpen: () => void;
}) {
  const sv = locale === "sv";

  if (!closing) return sv ? "Okänt" : "Unknown";

  const failed = closing.checks.filter((check) => !check.passed).length;

  if (failed === 0) return sv ? "Okänt" : "Unknown";

  return (
    <Link
      href={`${workspacePath(book)}/closing?record=${encodeURIComponent(closing.periodId)}`}
      onClick={onOpen}
    >
      {sv ? `${failed} hinder för bokslut` : `${failed} closing blockers`}
    </Link>
  );
}
