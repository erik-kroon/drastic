import { isCalendarDate } from "@open-erp/domain/values";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Db from "../db/onboarding-lifecycle";
import { decode, type Scope } from "./commerce/support";
import { failure } from "./failures";
import type { Transaction } from "../db/transaction";

const absolute = (value: bigint) => (value < 0n ? -value : value);

export function parseOpeningInvoiceRows(lines: readonly string[], provenance: string) {
  return Effect.gen(function* () {
    if (!lines.length || lines.length > 500) return yield* failure("UnsupportedProfile");

    const rows = yield* Effect.forEach(lines, (line) => {
      const fields = line.split(",");

      if (fields.length !== 8) return failure("InvalidJournal");

      return Schema.decodeUnknownEffect(
        Schema.Struct({
          kind: Schema.Literals(["sales_open_items", "purchase_open_items"]),
          item: Sie.HistoricalOpenItem,
        }),
      )({
        kind: fields[0],
        item: {
          asOf: fields[1],
          currency: fields[2],
          sourceIdentity: fields[3],
          sourceAccount: fields[4],
          originalMinor: fields[5],
          outstandingMinor: fields[6],
          assertedState: fields[7],
          detailAvailability: "source_asserted",
          basis: provenance,
        },
      }).pipe(Effect.mapError(() => failure("InvalidJournal")));
    });

    for (const { item } of rows) {
      const original = BigInt(item.originalMinor),
        outstanding = BigInt(item.outstandingMinor);

      if (item.currency !== "SEK") return yield* failure("UnsupportedProfile");

      if (
        !isCalendarDate(item.asOf) ||
        absolute(outstanding) > absolute(original) ||
        original * outstanding < 0n ||
        (item.assertedState === "unpaid" && original !== outstanding) ||
        (item.assertedState === "partly_paid" &&
          (outstanding === 0n || absolute(outstanding) >= absolute(original)))
      )
        return yield* failure("InvalidJournal");
    }

    return rows;
  });
}

export function openingInvoiceDetails(
  tx: Transaction,
  scope: Scope,
  asOf: string | null,
  mappings: typeof Sie.SealSiePlan.Type.mappings,
) {
  return Effect.gen(function* () {
    const records = yield* Db.readRecords(tx, "controls", scope.bookId);

    if (records.length > 1000) return yield* failure("UnsupportedProfile");

    const controls = (yield* Effect.forEach(records, (row) =>
      decode(O.OnboardingControl, row.body),
    ))
      .filter((row) => row.asOf === asOf)
      .toSorted(
        (left, right) =>
          right.qualifiedAt.localeCompare(left.qualifiedAt) || right.id.localeCompare(left.id),
      );

    const balance = controls.find((row) => row.kind === "trial_balance");

    const selected = ["sales_open_items", "purchase_open_items"].flatMap((kind) => {
      const latest = controls.find((row) => row.kind === kind);

      return latest?.openItemDetails ? [latest] : [];
    });

    if (!selected.length) return { openItems: [], openItemControls: [] };

    if (!balance) return yield* failure("MissingEvidence");

    const snapshots = yield* Effect.forEach(
      yield* Db.readRecords(tx, "snapshots", scope.bookId),
      (row) => decode(O.OnboardingSnapshot, row.body),
    );

    const decisions = yield* Effect.forEach(
      yield* Db.readRecords(tx, "decisions", scope.bookId),
      (row) => decode(O.OnboardingDecision, row.body),
    );

    for (const control of [...selected, balance]) {
      if (
        snapshots.some(
          (snapshot) =>
            snapshot.controlIds.includes(control.id) &&
            decisions.some(
              (decision) =>
                decision.snapshotId === snapshot.id && decision.decision.kind === "reject",
            ),
        )
      )
        return yield* failure("ApprovalRequired");
    }

    const openItems = selected.flatMap((row) => row.openItemDetails ?? []);

    if (openItems.length > 500) return yield* failure("UnsupportedProfile");

    if (new Set(openItems.map((row) => row.sourceIdentity)).size !== openItems.length)
      return yield* failure("InvalidJournal");
    const openItemControls: Array<typeof Sie.OpenItemControl.Type> = [];

    for (const sourceAccount of new Set(openItems.map((row) => row.sourceAccount))) {
      const mapping = mappings.find((row) => row.sourceAccount === sourceAccount);

      if (mapping && mappings.filter((row) => row.accountId === mapping.accountId).length !== 1)
        return yield* failure("UnsupportedProfile");

      const facts = balance.facts.filter((row) => row.accountId === mapping?.accountId);

      const owners = selected.filter((row) =>
        row.openItemDetails?.some((item) => item.sourceAccount === sourceAccount),
      );

      if (
        !mapping ||
        !facts.length ||
        owners.some((row) => row.occurrenceId === balance.occurrenceId)
      )
        return yield* failure("MissingEvidence");
      openItemControls.push({
        sourceAccount,
        currency: "SEK",
        independentOutstandingMinor: facts
          .reduce((total, row) => total + BigInt(row.amountMinor), 0n)
          .toString(),
        basis: `Retained trial balance ${balance.id}, ${balance.sourceSha256}`,
      });
    }

    return { openItems, openItemControls };
  });
}
