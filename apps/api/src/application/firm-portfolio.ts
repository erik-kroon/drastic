import * as Firms from "@open-erp/contracts/firms";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { getFirmPortfolioWorkspace } from "./firms";
import { getCompanySetup } from "./company-setup";
import { bookSetup } from "./posting";
import { listAttention } from "./workspace";
import { listObligations } from "./closing/deadlines";
import { listBureauObligations } from "./bureau-obligations";
import { listUnknownLegalDeliveryAttempts } from "./commerce/legal-delivery";
import { closingReadiness } from "./closing/proposals";
import { bankWorkspace } from "./banking/workspace";
import { listBankInventorySignoffs, getBankInventorySignoff } from "./banking/inventory-signoffs";
import { failure } from "./failures";

const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function observedTime() {
  return DateTime.now.pipe(Effect.map((now) => DateTime.toDateUtc(now).toISOString()));
}

function clientFacts(token: string, client: typeof Firms.Client.Type) {
  return Effect.gen(function* () {
    const scope = { entityId: client.book.entityId, bookId: client.book.id };
    const company = yield* getCompanySetup(token, { scope });
    const setup = yield* bookSetup(token, { scope });
    const period = [...setup.periods].sort((a, b) => b.endsOn.localeCompare(a.endsOn))[0] ?? null;
    const deadlines = yield* listObligations(token, { scope });
    const supplierObligations = yield* listBureauObligations(token, { scope });
    const unknownLegalDeliveries = yield* listUnknownLegalDeliveryAttempts(token, { scope });

    const knownDates = [
      ...deadlines
        .filter((item) => item.current_outcome === null)
        .map((item) => ({
          source: "deadline" as const,
          id: item.id,
          dueOn: stockholmDate.format(new Date(item.due_at)),
        })),
      ...supplierObligations.items
        .filter(
          (item) =>
            item.dueOn !== null &&
            (item.outstandingMinor === null || BigInt(item.outstandingMinor) > 0n),
        )
        .map((item) => ({
          source: "supplier_obligation" as const,
          id: item.obligationId,
          dueOn: item.dueOn!,
        })),
    ];

    const nearestKnownDeadline =
      knownDates.sort(
        (left, right) => left.dueOn.localeCompare(right.dueOn) || left.id.localeCompare(right.id),
      )[0] ?? null;

    const unknownOutcomes = {
      coverage: "legal_delivery_provider_attempts_only" as const,
      items: unknownLegalDeliveries.map((item) => ({
        id: item.id,
        kind: "legal_delivery_provider_unknown" as const,
        recordedAt: item.recordedAt,
      })),
    };

    const kinds = ["journal", "invoice", "expense", "document", "supplier", "recurring"] as const;

    const counts = yield* Effect.forEach(kinds, (kind) =>
      listAttention(token, { scope, kind, status: "open" }),
    );

    const latest = yield* listAttention(token, { scope, status: "all" });

    const byKind = {
      journal: counts[0]!.counts.open,
      invoice: counts[1]!.counts.open,
      expense: counts[2]!.counts.open,
      document: counts[3]!.counts.open,
      supplier: counts[4]!.counts.open,
      recurring: counts[5]!.counts.open,
    };

    const openWork = {
      total: Object.values(byKind)
        .reduce((sum, count) => sum + BigInt(count), 0n)
        .toString(),
      byKind,
      coverage: "canonical_attention_all_periods" as const,
    };

    const lastActivityAt = latest.items[0]?.updatedAt ?? null;

    const assignedAccountantId = client.leadAvailable ? client.leadId : null;

    if (period === null) {
      return {
        scope,
        company,
        period,
        openTasks: null,
        assignedAccountantId,
        openWork,
        supplierObligations,
        unknownOutcomes,
        nearestKnownDeadline,
        lastActivityAt,
        lastActivityCoverage: "canonical_attention_only",
        deadlines,
        bank: null,
        bankObservations: [],
        bankInventorySignoffs: [],
        closing: null,
      } satisfies typeof Firms.PortfolioClientFacts.Type;
    }

    const work = yield* listAttention(token, { scope, status: "open", period: period.id });

    const bank = yield* bankWorkspace(token, {
      scope,
      input: { startsOn: period.startsOn, endsOn: period.endsOn },
    });

    if (bank.accounts.length > 100) return yield* failure("UnsupportedProfile");

    const cutoffObservations = new Map([[period.endsOn, bank]]);

    const bankObservations = yield* Effect.forEach(
      bank.accounts.filter(
        (account) =>
          account.statementDate !== null &&
          account.statementDate >= period.startsOn &&
          account.statementDate <= period.endsOn,
      ),
      (account) =>
        Effect.gen(function* () {
          const endsOn = account.statementDate;

          if (endsOn === null) return yield* failure("InternalError");

          let observation = cutoffObservations.get(endsOn);

          if (!observation) {
            observation = yield* bankWorkspace(token, {
              scope,
              input: { startsOn: period.startsOn, endsOn },
            });
            cutoffObservations.set(endsOn, observation);
          }

          const observed = observation.accounts.find((candidate) => candidate.id === account.id);

          if (!observed || observed.statementId !== account.statementId) {
            return yield* failure("StaleDependency");
          }

          return {
            startsOn: period.startsOn,
            endsOn,
            checkedAt: observation.checkedAt,
            account: observed,
          };
        }),
    );

    const history = yield* listBankInventorySignoffs(token, { scope });

    const bankInventorySignoffs = yield* Effect.forEach(
      history.items.filter(
        (item) =>
          item.signedAt !== null &&
          item.startsOn === period.startsOn &&
          item.endsOn === period.endsOn,
      ),
      (item) =>
        Effect.gen(function* () {
          const view = yield* getBankInventorySignoff(token, { scope, planId: item.id });

          return {
            ...item,
            accountIds: view.plan.inventory.bankAccountIds,
            dependenciesCurrent: view.dependenciesCurrent,
            reviewScope: view.plan.reviewScope,
            coverage: view.plan.coverage,
            companyCompleteness: view.plan.companyCompleteness,
            financialCloseReady: view.plan.financialCloseReady,
            signedArtifact: view.signedArtifact
              ? { sha256: view.signedArtifact.sha256, byteLength: view.signedArtifact.byteLength }
              : null,
          };
        }),
    );

    const closing = yield* closingReadiness(token, { scope, periodId: period.id });

    return {
      scope,
      company,
      period,
      openTasks: work.counts.open,
      assignedAccountantId,
      openWork,
      supplierObligations,
      unknownOutcomes,
      nearestKnownDeadline,
      lastActivityAt,
      lastActivityCoverage: "canonical_attention_only",
      deadlines,
      bank,
      bankObservations,
      bankInventorySignoffs,
      closing,
    } satisfies typeof Firms.PortfolioClientFacts.Type;
  });
}

export const getFirmPortfolio = Effect.fn("firms.portfolio")(function* (
  token: string,
  command: { readonly firmId: string },
) {
  const observedFrom = yield* observedTime();
  const workspace = yield* getFirmPortfolioWorkspace(token, command);
  const clients = yield* Effect.forEach(workspace.clients, (client) => clientFacts(token, client));
  const current = yield* getFirmPortfolioWorkspace(token, command);

  if (JSON.stringify(current) !== JSON.stringify(workspace)) {
    return yield* failure("StaleDependency");
  }

  const observedUntil = yield* observedTime();

  return yield* Schema.decodeEffect(Firms.Portfolio)({
    workspace: current,
    observedFrom,
    observedUntil,
    clients,
    needsToday: clients.flatMap((facts, index) => {
      const review = current.clients[index]?.nextReviewOn;

      const today = stockholmDate.format(new Date(observedUntil));

      const firmReview =
        review && review <= today
          ? [
              {
                scope: facts.scope,
                source: "firm_review" as const,
                id: facts.scope.bookId,
                dueOn: review,
              },
            ]
          : [];

      const deadlines = facts.deadlines
        .filter(
          (deadline) =>
            stockholmDate.format(new Date(deadline.due_at)) <= today &&
            deadline.current_outcome === null,
        )
        .map((deadline) => ({
          scope: facts.scope,
          source: "deadline" as const,
          id: deadline.id,
          dueOn: stockholmDate.format(new Date(deadline.due_at)),
        }));

      const supplierObligations = facts.supplierObligations.items
        .filter(
          (item) =>
            item.dueOn !== null &&
            item.dueOn <= today &&
            (item.outstandingMinor === null || BigInt(item.outstandingMinor) > 0n),
        )
        .map((item) => ({
          scope: facts.scope,
          source: "supplier_obligation" as const,
          id: item.obligationId,
          dueOn: item.dueOn!,
        }));

      return [...firmReview, ...deadlines, ...supplierObligations];
    }),
  }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));
});
