import { bookScope } from "@/lib/contract-client";
import { useState } from "react";
import { useInfiniteQuery, useQuery, skipToken } from "@tanstack/react-query";
import * as Cash from "@open-erp/contracts/cash-forecast";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Heading, Text } from "@open-erp/ui/components/typography";
import { AccountingStatus } from "@/components/accounting-status";
import { useBookWorkspace } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { CaptureCashBasis } from "./capture-basis";
import { CaptureCashForecast } from "./capture-forecast";
import { CashBasisResult } from "./result";

export function CashBasisWorkspace({ onSaved }: { onSaved: (id: string) => void }) {
  const { book, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const [basisId, setBasisId] = useState("");

  const history = useInfiniteQuery({
    queryKey: [...bookKey(book), "cash-bases", "list"],
    initialPageParam: "",
    queryFn: ({ signal, pageParam }) =>
      readAccounting(
        `${bookPath(book)}/cash-bases${pageParam ? `?after=${encodeURIComponent(pageParam)}` : ""}`,
        Cash.CashBasisPage,
        { signal },
      ),
    getNextPageParam: (page) => page.next ?? undefined,
    retry: false,
  });

  const basis = useQuery({
    queryKey: [...bookKey(book), "cash-bases", basisId],
    queryFn: basisId
      ? ({ signal }) =>
          readAccounting(
            (client) =>
              client.cashForecast.getCashBasis({ params: { ...bookScope(book), id: basisId } }),
            Cash.CashBasisView,
            { signal },
          )
      : skipToken,
    retry: false,
  });

  return (
    <Box display="grid" gap="xl" minWidth="zero">
      <Heading>{sv ? "Underlag för prognosen" : "Forecast basis"}</Heading>
      <AccountingStatus locale={locale} pending={history.isPending} error={history.error} />
      {history.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void history.refetch();
          }}
        >
          {sv ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {history.data?.pages[0]?.total === 0 ? (
        <Text>{sv ? "Inga sparade underlag" : "No saved bases"}</Text>
      ) : null}
      {history.data?.pages
        .flatMap((page) => page.items)
        .map((item) => (
          <Button
            key={item.id}
            variant={item.id === basisId ? "secondary" : "ghost"}
            aria-pressed={item.id === basisId}
            onClick={() => setBasisId(item.id)}
          >
            {item.asOf}, {item.recordedCutoff},{" "}
            {item.openingStatus === "qualified"
              ? sv
                ? "Öppningssaldo kvalificerat"
                : "Opening qualified"
              : sv
                ? "Öppningssaldo saknas"
                : "Opening unavailable"}
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
      <CaptureCashBasis onSaved={setBasisId} />
      {basisId ? (
        <AccountingStatus locale={locale} pending={basis.isPending} error={basis.error} />
      ) : null}
      {basis.isError ? (
        <Button
          variant="outline"
          onClick={() => {
            void basis.refetch();
          }}
        >
          {sv ? "Försök igen" : "Retry"}
        </Button>
      ) : null}
      {basis.data ? <CashBasisResult view={basis.data} /> : null}
      {basis.data ? (
        <CaptureCashForecast key={basis.data.basis.id} view={basis.data} onSaved={onSaved} />
      ) : null}
    </Box>
  );
}
