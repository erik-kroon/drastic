import * as Settlement from "@open-erp/contracts/settlements";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import type { Locale } from "@/paraglide/runtime";
import { bankUnmatchCopy } from "./copy";

export function BankAllocationUnmatchNotice({
  unmatch,
  locale,
}: {
  unmatch: NonNullable<(typeof Settlement.BankAllocationView.Type)["unmatch"]>;
  locale: Locale;
}) {
  const copy = bankUnmatchCopy(locale);

  return (
    <Box display="grid" gap="sm">
      <Text role="status">{copy.done}</Text>
      <Text>
        {copy.reason}: {unmatch.reason}
      </Text>
      <Text>
        {copy.planId}: {unmatch.planId} · {unmatch.executedAt}
      </Text>
    </Box>
  );
}
