import type * as Firms from "@open-erp/contracts/firms";
import { Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";

export function ClientClosing({
  closing,
  locale,
}: {
  closing: (typeof Firms.PortfolioClientFacts.Type)["closing"];
  locale: Locale;
}) {
  const sv = locale === "sv";

  if (!closing) return sv ? "Okänt" : "Unknown";

  const failed = closing.checks.filter((check) => !check.passed).length;

  if (failed === 0) return sv ? "Okänt" : "Unknown";

  return (
    <Text variant="control">
      {sv ? `${failed} hinder för bokslut` : `${failed} closing blockers`}
    </Text>
  );
}
