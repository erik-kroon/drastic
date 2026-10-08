import type * as Firms from "@open-erp/contracts/firms";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { PageCaption } from "@open-erp/ui/components/accounting-page";
import type { Locale } from "@/paraglide/runtime";

export function ClientBank({
  facts,
  locale,
}: {
  facts: typeof Firms.PortfolioClientFacts.Type;
  locale: Locale;
}) {
  const sv = locale === "sv";

  const difference = [...facts.bankObservations]
    .filter(
      (observation) =>
        observation.account.differenceMinor !== null &&
        BigInt(observation.account.differenceMinor) !== 0n,
    )
    .sort(
      (a, b) => b.endsOn.localeCompare(a.endsOn) || a.account.id.localeCompare(b.account.id),
    )[0];

  const signed = facts.bankInventorySignoffs.find(
    (signoff) =>
      facts.period !== null &&
      signoff.periodId === facts.period.id &&
      signoff.startsOn === facts.period.startsOn &&
      signoff.endsOn === facts.period.endsOn &&
      signoff.signedAt !== null &&
      signoff.dependenciesCurrent &&
      signoff.signedArtifact !== null,
  );

  const date = difference?.endsOn ?? signed?.endsOn;

  if (!date) return sv ? "Okänt" : "Unknown";

  return (
    <Box display="grid" gap="sm">
      <Text variant="control">
        {difference ? (sv ? "Differens" : "Difference") : sv ? "Avstämd" : "Reconciled"}
      </Text>
      <PageCaption>
        {new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(`${date}T00:00:00.000Z`))}
      </PageCaption>
    </Box>
  );
}
