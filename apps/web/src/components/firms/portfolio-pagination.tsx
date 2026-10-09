import { Box } from "@open-erp/ui/components/box";
import { Text } from "@open-erp/ui/components/typography";
import { Button } from "@open-erp/ui/components/button";
import type { Locale } from "@/paraglide/runtime";

export const portfolioPageSize = 15;

export function PortfolioPagination(props: {
  total: number;
  page: number;
  locale: Locale;
  onPage: (page: number) => void;
  includesRequests?: boolean;
}) {
  const sv = props.locale === "sv";
  const pages = Math.max(1, Math.ceil(props.total / portfolioPageSize));
  const start = props.page * portfolioPageSize + 1;
  const end = Math.min((props.page + 1) * portfolioPageSize, props.total);

  return (
    <Box
      as="nav"
      aria-label={sv ? "Klientsidor" : "Client pages"}
      display="flex"
      alignItems="center"
      justifyContent="between"
      flexWrap="wrap"
      gap="lg"
      paddingBlock="xl"
    >
      <Text as="span" variant="control">
        {sv
          ? `${start}–${end} av ${props.total} ${props.includesRequests ? "poster" : "klienter"}`
          : `${start}–${end} of ${props.total} ${props.includesRequests ? "entries" : "clients"}`}
      </Text>
      <Box display="flex" alignItems="center" flexWrap="wrap" gap="lg">
        <Text as="span" variant="control">
          {sv ? "15 per sida" : "15 per page"}
        </Text>
        <Text as="span" variant="control">
          {sv ? `Sida ${props.page + 1} av ${pages}` : `Page ${props.page + 1} of ${pages}`}
        </Text>
        <Button
          variant="outline"
          disabled={props.page === 0}
          onClick={() => props.onPage(props.page - 1)}
        >
          {sv ? "Föregående" : "Previous"}
        </Button>
        <Button
          variant="outline"
          disabled={props.page + 1 >= pages}
          onClick={() => props.onPage(props.page + 1)}
        >
          {sv ? "Nästa" : "Next"}
        </Button>
      </Box>
    </Box>
  );
}
