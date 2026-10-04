import { expect, test } from "vitest";
import * as Connector from "@open-erp/contracts/bank-connector";
import { decoded, fixture, post, request } from "./support/fixtures";
import { saveSanitizedJourney } from "./assurance/database-support";

test("bank feed inventory reads empty and retained pages without claiming provider coverage", async () => {
  const book = await fixture();
  const other = await fixture();

  const empty = await decoded(
    await request(book, "/bank-connector-feeds"),
    Connector.ConnectorFeedInventory,
  );

  expect(empty.items).toEqual([]);
  expect(empty.nextCursor).toBeNull();

  const consent = await post(
    book,
    "/bank-connector-consents",
    {
      providerId: "plaid",
      externalAccountId: "synthetic_inventory_account",
      sourceAccountId: "synthetic_inventory_source",
      accountId: "account_bank",
      consentReference: "Synthetic operator attestation",
      rationale: "Synthetic retained feed inventory regression",
    },
    Connector.ConnectorConsent,
  );

  const batch = await post(
    book,
    `/bank-connector-consents/${consent.id}/batches`,
    {
      providerOutcome: "delivered",
      previousCursor: "",
      nextCursor: "synthetic_inventory_cursor",
      sourceRevision: "synthetic_inventory_revision",
      records: [],
    },
    Connector.ConnectorBatch,
  );

  const inventory = await decoded(
    await request(book, "/bank-connector-feeds"),
    Connector.ConnectorFeedInventory,
  );

  expect(inventory.items).toHaveLength(1);
  const feed = inventory.items[0];

  expect(feed?.consent.id).toBe(consent.id);
  expect(feed?.cursorSnapshot.retainedPageCount).toBe(1);
  expect(feed?.pages.map((page) => page.id)).toEqual([batch.id]);
  expect(feed?.pages[0]?.source).toBeNull();
  expect(feed?.providerAcceptance).toBe("not_established");
  expect(feed?.accountCoverage).toBe("not_established");
  expect(feed?.automaticRecovery).toBe(false);
  expect(
    (await decoded(await request(other, "/bank-connector-feeds"), Connector.ConnectorFeedInventory))
      .items,
  ).toEqual([]);

  await saveSanitizedJourney("bank-feed-inventory", { empty, inventory, otherBookEmpty: true });
});
