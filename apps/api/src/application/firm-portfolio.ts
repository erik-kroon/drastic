import * as Firms from "@open-erp/contracts/firms";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { getFirm } from "./firms";
import { getCompanySetup } from "./company-setup";
import { bookSetup } from "./posting";
import { listAttention } from "./workspace";
import { listObligations } from "./closing/deadlines";
import { closingReadiness } from "./closing/proposals";
import { bankWorkspace } from "./banking/workspace";
import { listBankInventorySignoffs, getBankInventorySignoff } from "./banking/inventory-signoffs";
import { failure } from "./failures";

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

    if (period === null) {
      return {
        scope,
        company,
        period,
        openTasks: null,
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

          const observation =
            endsOn === period.endsOn
              ? bank
              : yield* bankWorkspace(token, {
                  scope,
                  input: { startsOn: period.startsOn, endsOn },
                });

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
  const workspace = yield* getFirm(token, command);
  const clients = yield* Effect.forEach(workspace.clients, (client) => clientFacts(token, client));
  const current = yield* getFirm(token, command);

  if (JSON.stringify(current) !== JSON.stringify(workspace)) {
    return yield* failure("StaleDependency");
  }

  const observedUntil = yield* observedTime();

  return yield* Schema.decodeEffect(Firms.Portfolio)({
    workspace: current,
    observedFrom,
    observedUntil,
    clients,
  }).pipe(Effect.mapError((cause) => failure("InternalError", cause)));
});
