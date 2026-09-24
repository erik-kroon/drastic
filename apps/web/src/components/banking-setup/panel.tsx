import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import * as Connector from "@open-erp/contracts/bank-connector";
import { Box } from "@open-erp/ui/components/box";
import { Button } from "@open-erp/ui/components/button";
import { Link } from "@open-erp/ui/components/link";
import { Text } from "@open-erp/ui/components/typography";
import { RecordHeading, RecordSection } from "@open-erp/ui/components/record-layout";
import { WorkspaceHeader } from "@open-erp/ui/components/workspace";
import { PageContent } from "@open-erp/ui/components/accounting-page";
import { AccountingStatus } from "@/components/accounting-status";
import { checkScope } from "@/components/commerce/shared";
import { useBookWorkspace, workspacePath } from "@/lib/book-context";
import { bookKey, bookPath, readAccounting } from "@/lib/accounting-api";
import { ConsentForm } from "./consent-form";
import { ConsentDetail } from "./consent-detail";

export function BankingSetup({ consent }: { consent?: string }) {
  const { book, setup, locale } = useBookWorkspace();
  const sv = locale === "sv";
  const navigate = useNavigate();
  const cache = useQueryClient();
  const queryKey = [...bookKey(book), "connector-consents"];
  const inventory = useInfiniteQuery({
    queryKey,
    initialPageParam: "",
    enabled: !consent,
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${bookPath(book)}/bank-connector-consents${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Connector.ConnectorInventory,
        { signal },
      );
      checkScope(book, result.scope);
      for (const item of result.items) checkScope(book, item.scope);
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const feedInventory = useInfiniteQuery({
    queryKey: [...queryKey, "feeds"],
    initialPageParam: "",
    enabled: !consent,
    retry: false,
    queryFn: async ({ signal, pageParam }) => {
      const result = await readAccounting(
        `${bookPath(book)}/bank-connector-feeds${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        Connector.ConnectorFeedInventory,
        { signal },
      );
      checkScope(book, result.scope);
      for (const item of result.items) {
        checkScope(book, item.scope);
        checkScope(book, item.consent.scope);
      }
      return result;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const base = `${workspacePath(book)}/banking-setup`;
  const open = (id: string) => void navigate({ to: base, search: { consent: id } });
  return (
    <>
      <WorkspaceHeader title={sv ? "Bankinställningar" : "Banking setup"} />
      <PageContent>
        <Box display="flex" gap="lg" flexWrap="wrap">
          <Link href={`${workspacePath(book)}/setup`}>
            {sv ? "Till företagsinställningar" : "Back to company setup"}
          </Link>
          <Link href={`${workspacePath(book)}/accounts?view=imports`}>
            {sv ? "Importera ett kontoutdrag" : "Import a statement"}
          </Link>
          <Link href={`${workspacePath(book)}/overview`}>
            {sv ? "Fortsätt utan bankanslutning" : "Continue without a bank connection"}
          </Link>
        </Box>
        <RecordHeading
          title={sv ? "Bankunderlag på dina villkor" : "Choose how to bring in bank records"}
          subtitle={
            sv
              ? "Bankanslutning är valfri. Du kan importera kontoutdrag och fortsätta med resten av företaget."
              : "A bank connection is optional. You can import statements and continue setting up your company."
          }
        />
        <Text>
          {sv
            ? "Här visas registrerade samtycken och underlag från anslutningsjobb. Bankåtkomst verifieras inte på den här sidan. Levererade underlag behöver granskas före avstämning."
            : "This page shows recorded consents and records delivered by connector jobs. It does not verify bank access. Delivered records need review before reconciliation."}
        </Text>
        {consent ? (
          <>
            <Link href={base}>
              {sv ? "Alla sparade kontokopplingar" : "All saved account mappings"}
            </Link>
            <ConsentDetail key={consent} id={consent} />
          </>
        ) : (
          <>
            <RecordSection title={sv ? "Sparade kontokopplingar" : "Saved account mappings"}>
              <AccountingStatus
                locale={locale}
                pending={inventory.isPending}
                error={inventory.error}
              />
              {inventory.isSuccess &&
              inventory.data.pages.every((page) => page.items.length === 0) ? (
                <Text>
                  {sv
                    ? "Inga samtycken eller kontokopplingar har sparats."
                    : "No consents or account mappings have been saved."}
                </Text>
              ) : null}
              {inventory.data?.pages
                .flatMap((page) => page.items)
                .map((item) => (
                  <Box key={item.id} display="grid" gap="sm">
                    <Text>
                      {item.providerId} · {item.externalAccountId}
                    </Text>
                    <Text>
                      {setup.accounts.find((account) => account.id === item.accountId)?.code ??
                        item.accountId}{" "}
                      ·{" "}
                      {item.revoked
                        ? sv
                          ? "Stoppad"
                          : "Stopped"
                        : sv
                          ? "Samtycke registrerat"
                          : "Consent recorded"}
                    </Text>
                    <Box>
                      <Button variant="outline" onClick={() => open(item.id)}>
                        {sv ? "Granska konto och leveranser" : "Review account and deliveries"}
                      </Button>
                    </Box>
                  </Box>
                ))}
              <Box display="flex" gap="sm" flexWrap="wrap">
                <Button
                  variant="ghost"
                  disabled={inventory.isFetching}
                  onClick={() => {
                    void inventory.refetch();
                  }}
                >
                  {sv ? "Uppdatera kontokopplingar" : "Refresh mappings"}
                </Button>
                {inventory.hasNextPage ? (
                  <Button
                    variant="outline"
                    disabled={inventory.isFetchingNextPage}
                    onClick={() => {
                      void inventory.fetchNextPage();
                    }}
                  >
                    {sv ? "Visa fler" : "Load more"}
                  </Button>
                ) : null}
              </Box>
             </RecordSection>
             <RecordSection title={sv ? "Anslutningsflöde och återhämtning" : "Feed evidence and recovery"}>
               <AccountingStatus
                 locale={locale}
                 pending={feedInventory.isPending}
                 error={feedInventory.error}
               />
               {feedInventory.isSuccess &&
               feedInventory.data.pages.every((page) => page.items.length === 0) ? (
                 <Text>
                   {sv
                     ? "Ingen bevarad leveransstatus finns."
                     : "No retained feed evidence is available."}
                 </Text>
               ) : null}
               {feedInventory.data?.pages
                 .flatMap((page) => page.items)
                 .map((feed) => (
                   <Box key={feed.consent.id} display="grid" gap="sm">
                     <Text>
                       {feed.consent.providerId} · {feed.consent.externalAccountId} ·{" "}
                       {feed.account.accountId}
                     </Text>
                     <Text>
                       {sv ? "Läst" : "Read at"}: {feed.readAt} · {sv ? "Sidor" : "Pages"}:{" "}
                       {feed.cursorSnapshot.retainedPageCount}
                       {feed.pageEvidenceTruncated
                         ? sv
                           ? " · listan är förkortad"
                           : " · list truncated"
                         : ""}
                     </Text>
                     <Text>
                       {sv ? "Leverantörsgodkännande" : "Provider acceptance"}:{" "}
                       {sv ? "Ej fastställt" : "Not established"}
                     </Text>
                     {feed.recoveryBlockers.map((blocker) => (
                       <Text key={blocker.code} role="alert">
                         {blocker.message}
                       </Text>
                     ))}
                     <Button
                       variant="outline"
                       onClick={() => open(feed.consent.id)}
                     >
                       {sv ? "Granska bevarad leverans" : "Review retained feed"}
                     </Button>
                   </Box>
                 ))}
               <Box display="flex" gap="sm" flexWrap="wrap">
                 <Button
                   variant="ghost"
                   disabled={feedInventory.isFetching}
                   onClick={() => void feedInventory.refetch()}
                 >
                   {sv ? "Uppdatera leveransstatus" : "Refresh feed evidence"}
                 </Button>
                 {feedInventory.hasNextPage ? (
                   <Button
                     variant="outline"
                     disabled={feedInventory.isFetchingNextPage}
                     onClick={() => void feedInventory.fetchNextPage()}
                   >
                     {sv ? "Visa fler" : "Load more"}
                   </Button>
                 ) : null}
               </Box>
             </RecordSection>
             <RecordSection
               title={sv ? "Registrera ett befintligt samtycke" : "Record existing consent"}
             >

              <ConsentForm
                onSaved={(id) => {
                  void cache.invalidateQueries({ queryKey });
                  open(id);
                }}
              />
            </RecordSection>
          </>
        )}
      </PageContent>
    </>
  );
}
