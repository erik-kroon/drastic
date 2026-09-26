import * as Accounting from "@open-erp/contracts/accounting";
import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { accountingCopy } from "@/lib/accounting-copy";
import { isUncertainWriteError } from "@/lib/accounting-api";
import type { Locale } from "@/paraglide/runtime";

export function AccountingStatus({
  pending,
  error,
  locale,
  write = false,
}: {
  pending?: boolean;
  error: Error | null;
  locale: Locale;
  write?: boolean;
}) {
  const copy = accountingCopy(locale);

  if (!pending && !error) return null;

  return (
    <Box role="status" aria-live="polite" display="grid" gap="sm">
      {pending ? <Text>{copy.journal_working}</Text> : null}
      {error ? (
        <Text>
          {error instanceof Accounting.AccountingError
            ? error.message
            : write
              ? copy.journal_uncertain
              : copy.journal_read_error}
        </Text>
      ) : null}
      {write && error instanceof Accounting.AccountingError && isUncertainWriteError(error) ? (
        <Text>{copy.journal_uncertain}</Text>
      ) : null}
    </Box>
  );
}
