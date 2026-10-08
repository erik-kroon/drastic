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
import { listBankSignoffs, getBankSignoff } from "./banking/signoffs";
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
        bankSignoffs: [],
        closing: null,
      } satisfies typeof Firms.PortfolioClientFacts.Type;
    }

    const work = yield* listAttention(token, { scope, status: "open", period: period.id });

    const bank = yield* bankWorkspace(token, {
      scope,
      input: { startsOn: period.startsOn, endsOn: period.endsOn },
    });

    const history = yield* listBankSignoffs(token, { scope });

    const bankSignoffs = yield* Effect.forEach(
      history.items.filter(
        (item) =>
          item.signedAt !== null &&
          item.startsOn === period.startsOn &&
          item.endsOn === period.endsOn,
      ),
      (item) =>
        Effect.gen(function* () {
          const view = yield* getBankSignoff(token, { scope, planId: item.id });

          return {
            ...item,
            dependenciesCurrent: view.dependenciesCurrent,
            reviewScope: view.plan.reviewScope,
            coverage: view.plan.coverage,
            financialCloseReady: view.plan.financialCloseReady,
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
      bankSignoffs,
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
