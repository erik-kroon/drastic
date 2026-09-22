import { createFileRoute } from "@tanstack/react-router";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { StatementFilePreview } from "@/components/statement-preview/preview";
import { statementCopy } from "@/components/statement-preview/copy";
import { usePageLocale } from "@/lib/use-page-locale";
import { setLocale } from "@/paraglide/runtime";

export const Route = createFileRoute("/intake")({ component: IntakePage });

function IntakePage() {
  const locale = usePageLocale();
  const copy = statementCopy(locale);
  return (
    <Box
      maxWidth="wide"
      centered
      paddingInline="lg"
      paddingBlock="2xl"
      display="grid"
      gap="2xl"
      minWidth="zero"
    >
      <Box
        as="header"
        display="flex"
        flexWrap="wrap"
        justifyContent="between"
        alignItems="center"
        gap="lg"
      >
        <Link href="/">OpenERP · {copy.home}</Link>
        <Box display="flex" flexWrap="wrap" gap="sm">
          <Button
            size="xl"
            variant="ghost"
            aria-pressed={locale === "en"}
            onClick={() => {
              void setLocale("en");
            }}
          >
            English
          </Button>
          <Button
            size="xl"
            variant="ghost"
            aria-pressed={locale === "sv"}
            onClick={() => {
              void setLocale("sv");
            }}
          >
            Svenska
          </Button>
        </Box>
      </Box>
      <Box as="main" display="grid" gap="2xl" minWidth="zero">
        <Box display="grid" gap="md">
          <Heading level={1}>{copy.title}</Heading>
          <Text tone="muted">{copy.intro}</Text>
        </Box>
        <StatementFilePreview locale={locale} />
      </Box>
    </Box>
  );
}
