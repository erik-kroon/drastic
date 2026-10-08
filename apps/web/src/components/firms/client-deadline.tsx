import type * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import type { Locale } from "@/paraglide/runtime";

type Deadline = (typeof Firms.PortfolioClientFacts.Type)["deadlines"][number];

export function nextClientDeadline(facts: typeof Firms.PortfolioClientFacts.Type) {
  return (
    [...facts.deadlines]
      .filter((deadline) => deadline.current_outcome === null)
      .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at) || a.id.localeCompare(b.id))[0] ??
    null
  );
}

export function compareClientDeadlines(a: Deadline | null, b: Deadline | null) {
  if (a === null) return b === null ? 0 : 1;

  if (b === null) return -1;

  return Date.parse(a.due_at) - Date.parse(b.due_at);
}

export function ClientDeadline({
  deadline,
  locale,
}: {
  deadline: Deadline | null;
  locale: Locale;
}) {
  if (deadline === null) return "—";

  return (
    <Box display="grid" gap="sm">
      <Text variant="control">
        {new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: deadline.time_zone,
        }).format(new Date(deadline.due_at))}
      </Text>
      <PageCaption>{deadline.title}</PageCaption>
    </Box>
  );
}
