import { Api } from "@open-erp/contracts/api";
import { bookScope, httpQuery } from "@/lib/contract-client";
import { useState } from "react";
import { useInfiniteQuery, useQuery, skipToken } from "@tanstack/react-query";
import * as Cash from "@open-erp/contracts/cash-forecast";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, readAccounting } from "@/lib/accounting-api";
import { formatMinorAmount } from "@/lib/workspace-api";
import { CashBasisWorkspace } from "./basis-workspace";
import { CashForecastResult } from "./result";

export function CashForecastWorkspace(props: { recordId?: string; onOpen: (id: string) => void }) {
  const { book } = useBookWorkspace();

  return <Workspace key={book.id} {...props} />;
}

function Workspace({ recordId, onOpen }: { recordId?: string; onOpen: (id: string) => void }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const [sources, setSources] = useState(false);

  const history = useInfiniteQuery({
    queryKey: [...bookKey(book), "cash-forecasts", "list"],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        (client) =>
          client.cashForecast.listCashForecasts({
            params: { ...bookScope(book) },
            query: httpQuery(
              Api.groups.cashForecast.endpoints.listCashForecasts,
              `${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
            ),
          }),
        Cash.CashForecastPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const selected = useQuery({
    queryKey: [...bookKey(book), "cash-forecasts", recordId],
    queryFn: recordId
      ? ({ signal }) =>
          readAccounting(
            (client) =>
              client.cashForecast.getCashForecast({ params: { ...bookScope(book), id: recordId } }),
            Cash.CashForecastView,
            { signal },
          )
      : skipToken,
    retry: false,
  });

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Heading>{sv ? "Kassaflöde" : "Cash flow"}</Heading>
      <Text>{sv ? "Prognos, inte utlovat belopp" : "Forecast, not a promised amount"}</Text>
      <Text>
        {sv
          ? "Kända poster. Företagets täckning är ofullständig."
          : "Known items. Company coverage is incomplete."}
      </Text>
      <Box display="flex" flexWrap="wrap" gap="md">
        <Button variant="outline" aria-expanded={sources} onClick={() => setSources(!sources)}>
          {sv ? "Underlag för prognosen" : "Forecast basis"}
        </Button>
        <Button
          variant="ghost"
          disabled={history.isFetching || selected.isFetching}
          onClick={() => {
            void history.refetch();

            if (recordId) void selected.refetch();
          }}
        >
          {sv ? "Läs in igen" : "Refresh"}
        </Button>
      </Box>
      {sources ? (
        <CashBasisWorkspace
          onSaved={(id) => {
            setSources(false);
            onOpen(id);
          }}
        />
      ) : null}
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {history.data ? (
        <Box display="grid" gap="sm">
          <Text>
            {sv ? "Sparade bilder" : "Saved forecasts"} {history.data.pages[0]?.total}
          </Text>
          {history.data.pages[0]?.total === 0 ? (
            <Text>{sv ? "Inga sparade prognoser" : "No saved forecasts"}</Text>
          ) : null}
          {history.data.pages
            .flatMap((page) => page.items)
            .map((item) => (
              <Button
                key={item.id}
                variant={item.id === recordId ? "secondary" : "ghost"}
                aria-pressed={item.id === recordId}
                onClick={() => onOpen(item.id)}
              >
                {item.asOf},{" "}
                {item.horizonDays === 91
                  ? sv
                    ? "13 veckor"
                    : "13 weeks"
                  : `${item.horizonDays} ${sv ? "dagar" : "days"}`}
                ,{" "}
                {item.closingMinor === null
                  ? sv
                    ? "Saldo saknas"
                    : "Balance unavailable"
                  : formatMinorAmount(item.closingMinor, 2, locale)}
              </Button>
            ))}
          {history.hasNextPage ? (
            <Button
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => {
                void history.fetchNextPage();
              }}
            >
              {sv ? "Visa fler" : "Load more"}
            </Button>
          ) : null}
        </Box>
      ) : null}
      {recordId ? (
        <AccountingStatus locale={locale} pending={selected.isPending} error={selected.error} />
      ) : null}
      {selected.data ? <CashForecastResult view={selected.data} /> : null}
    </Box>
  );
}
