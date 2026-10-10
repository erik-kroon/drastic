import { runBookCommand } from "../book-commands";
import * as Effect from "effect/Effect";
import * as D from "@open-erp/contracts/onboarding-deltas";
import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Db from "../../db/onboarding-deltas";
import * as Cases from "../../db/onboarding";
import * as SourceDb from "../../db/sie-import";
import { databaseFailure, type Transaction } from "../../db/transaction";
import { withAdmittedPrincipal } from "../identity";
import { decode, toJsonObject, type Scope } from "../commerce/support";
import { digest } from "../json";
import { isoNow } from "../command-receipts";
import { newId } from "../identifiers";
import { failure } from "../failures";

function voucherFacts(voucher: typeof Sie.Voucher.Type, description: string) {
  return {
    series: voucher.series,
    number: voucher.number,
    date: voucher.date,
    description,
    transactions: voucher.transactions.map((line) => ({
      kind: line.kind,
      account: line.account,
      dimensions: line.dimensions,
      amount: line.amount,
    })),
  };
}

function deltaMaterial(tx: Transaction, scope: Scope, previewId: string, excludedDeltaId?: string) {
  return Effect.gen(function* () {
    const candidate = (yield* Db.readDeltaCandidate(tx, scope.bookId, previewId).pipe(
      Effect.mapError(databaseFailure),
    ))[0];

    const configuration = (yield* Cases.readCurrent(tx, scope.bookId).pipe(
      Effect.mapError(databaseFailure),
    ))[0];

    if (!candidate || !configuration) return yield* failure("NotFound");

    const current = yield* decode(O.OnboardingCase, configuration.body);

    const preview = yield* decode(Sie.SiePreview, candidate.body);

    const versions = yield* SourceDb.listPreviews(tx, scope.bookId, preview.occurrenceId).pipe(
      Effect.mapError(databaseFailure),
    );

    if (versions[0]?.body.id !== preview.id) return yield* failure("StaleDependency");

    const startsOn = current.configuration.dates.historyStartsOn;

    const endsOn = current.configuration.dates.historyEndsOn;

    const liveOn = current.configuration.dates.candidateLiveOn;

    if (!preview.ready || !startsOn || !endsOn || !liveOn || startsOn > endsOn || endsOn >= liveOn)
      return yield* failure("StaleDependency");

    const identities = preview.vouchers.map((voucher) => voucher.sourceReference);

    if (new Set(identities).size !== identities.length) return yield* failure("InvalidJournal");

    if (
      preview.vouchers.some((voucher) => {
        const date = `${voucher.date.slice(0, 4)}-${voucher.date.slice(4, 6)}-${voucher.date.slice(6, 8)}`;

        return date < startsOn || date > endsOn || date >= liveOn;
      })
    )
      return yield* failure("UnsupportedProfile");

    const rows = yield* Db.readDeltaBaseline(
      tx,
      scope.bookId,
      candidate.sourceSystem,
      candidate.sourceAccountId,
      excludedDeltaId,
    ).pipe(Effect.mapError(databaseFailure));

    if (rows.length > 10000 || new Set(rows.map((row) => row.sourceReference)).size !== rows.length)
      return yield* failure("UnsupportedProfile");

    const baseline = yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        return { ...row, voucher: yield* decode(Sie.Voucher, row.body) };
      }),
    );

    const baselineDigest = yield* digest(
      baseline.map((row) => ({
        sourceReference: row.sourceReference,
        voucherId: row.voucherId,
        sourceDigest: row.sourceDigest,
        facts: voucherFacts(row.voucher, row.description),
      })),
    );

    return { candidate, preview, baseline, baselineDigest };
  });
}

export function readOnboardingDeltaInTransaction(tx: Transaction, scope: Scope, id: string) {
  return Effect.gen(function* () {
    const row = (yield* Db.readDelta(tx, scope.bookId, id).pipe(
      Effect.mapError(databaseFailure),
    ))[0];

    if (!row) return yield* failure("NotFound");

    const delta = yield* decode(D.OnboardingDelta, row.body);

    const material = yield* deltaMaterial(tx, scope, delta.candidatePreviewId, delta.id).pipe(
      Effect.catchIf(
        (error) => ["NotFound", "StaleDependency", "UnsupportedProfile"].includes(error.code),
        () => Effect.succeed(null),
      ),
    );

    const rows = yield* Db.readDeltaDecisions(tx, scope.bookId, id).pipe(
      Effect.mapError(databaseFailure),
    );

    if (rows.length > 10000) return yield* failure("UnsupportedProfile");

    const decisions = yield* Effect.forEach(rows, (entry) =>
      decode(D.OnboardingDeltaDecision, entry.body),
    );

    const proposals = yield* Effect.forEach(
      yield* Db.readDeltaProposals(tx, scope.bookId, id).pipe(Effect.mapError(databaseFailure)),
      (entry) => decode(D.OnboardingDeltaProposal, entry.body),
    );

    const effects = yield* Effect.forEach(
      yield* Db.readDeltaEffects(tx, scope.bookId, id).pipe(Effect.mapError(databaseFailure)),
      (entry) => decode(D.OnboardingDeltaEffect, entry.body),
    );

    const current =
      material !== null &&
      material.baselineDigest === delta.baselineDigest &&
      material.preview.digest === delta.candidatePreviewDigest;

    const blockers: string[] = [];

    if (!current) blockers.push("source_delta_changed");

    for (const change of delta.rows.filter((entry) => entry.kind !== "unchanged")) {
      const choice = decisions
        .filter((entry) => entry.sourceReference === change.sourceReference)
        .at(-1);

      if (!choice) blockers.push("source_change_needs_decision");
      else if (
        choice.choice === "use_change" &&
        !effects.some(
          (effect) =>
            effect.sourceReference === change.sourceReference && effect.decisionId === choice.id,
        )
      )
        blockers.push("source_change_not_posted");
    }

    return yield* decode(D.OnboardingDeltaView, {
      delta,
      decisions,
      proposals,
      effects,
      current,
      blockers: [...new Set(blockers)],
    });
  });
}

export const compareOnboardingDelta = Effect.fn("onboarding.delta.compare")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof D.CompareOnboardingDelta.Type },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const operation = "compare_onboarding_delta";

        return yield* runBookCommand(
          tx,
          {
            scope: command.scope,
            idempotencyKey: command.idempotencyKey,
            operation: operation,
            actorId: principal.actorId,
            input: command.input,
          },
          D.OnboardingDelta,
          Effect.gen(function* () {
            const material = yield* deltaMaterial(
              tx,
              command.scope,
              command.input.candidatePreviewId,
            );

            if (material.preview.digest !== command.input.expectedPreviewDigest)
              return yield* failure("StaleDependency");

            const rows: Array<typeof D.OnboardingDeltaRow.Type> = [];

            for (const candidate of material.preview.vouchers) {
              const previous = material.baseline.find(
                (row) => row.sourceReference === candidate.sourceReference,
              );

              let kind: typeof D.OnboardingDeltaRow.Type.kind = "new";

              if (previous)
                kind =
                  (yield* digest(voucherFacts(previous.voucher, previous.description))) ===
                  (yield* digest(
                    voucherFacts(
                      candidate,
                      material.preview.records.find(
                        (record) => record.ordinal === candidate.recordOrdinal,
                      )?.fields[3] ?? "",
                    ),
                  ))
                    ? "unchanged"
                    : "changed";
              rows.push({
                sourceReference: candidate.sourceReference,
                kind,
                previous: previous?.voucher ?? null,
                candidate,
                originalVoucherId: previous?.voucherId ?? null,
              });
            }

            for (const previous of material.baseline) {
              if (
                !material.preview.vouchers.some(
                  (voucher) => voucher.sourceReference === previous.sourceReference,
                )
              )
                rows.push({
                  sourceReference: previous.sourceReference,
                  kind: "removed",
                  previous: previous.voucher,
                  candidate: null,
                  originalVoucherId: previous.voucherId,
                });
            }

            const body = {
              id: newId("onboardingdelta"),
              scope: command.scope,
              candidatePreviewId: material.preview.id,
              candidatePreviewDigest: material.preview.digest,
              sourceSystem: material.candidate.sourceSystem,
              sourceAccountId: material.candidate.sourceAccountId,
              baselineDigest: material.baselineDigest,
              rows,
              comparedBy: principal.actorId,
              comparedAt: yield* isoNow(tx),
            };

            const delta = yield* decode(D.OnboardingDelta, {
              ...body,
              digest: yield* digest(body),
            });

            yield* Db.insertDelta(
              tx,
              command.scope.bookId,
              delta.id,
              material.preview.id,
              yield* toJsonObject(delta),
            ).pipe(Effect.mapError(databaseFailure));

            return delta;
          }),
        );
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const getOnboardingDelta = Effect.fn("onboarding.delta.get")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withAdmittedPrincipal({ token }, command.scope, { operatorOnly: false }, (tx) =>
    readOnboardingDeltaInTransaction(tx, command.scope, command.id),
  );
});

export const decideOnboardingDelta = Effect.fn("onboarding.delta.decide")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: typeof D.DecideOnboardingDelta.Type },
) {
  return yield* withAdmittedPrincipal(
    { token },
    command.scope,
    { operatorOnly: true },
    (tx, principal) =>
      Effect.gen(function* () {
        const operation = "decide_onboarding_delta";

        return yield* runBookCommand(
          tx,
          {
            scope: command.scope,
            idempotencyKey: command.idempotencyKey,
            operation: operation,
            actorId: principal.actorId,
            input: command.input,
          },
          D.OnboardingDeltaDecision,
          Effect.gen(function* () {
            const view = yield* readOnboardingDeltaInTransaction(
              tx,
              command.scope,
              command.input.deltaId,
            );

            if (!view.current || view.delta.digest !== command.input.expectedDigest)
              return yield* failure("StaleDependency");

            const row = view.delta.rows.find(
              (entry) => entry.sourceReference === command.input.sourceReference,
            );

            if (
              view.effects.some(
                (effect) => effect.sourceReference === command.input.sourceReference,
              )
            )
              return yield* failure("AlreadyPosted");

            if (!row || row.kind === "unchanged") return yield* failure("InvalidJournal");

            if (row.kind === "new" && command.input.choice === "keep_previous")
              return yield* failure("InvalidJournal");

            const decision = yield* decode(D.OnboardingDeltaDecision, {
              ...command.input,
              id: newId("onboardingdeltadecision"),
              scope: command.scope,
              actorId: principal.actorId,
              decidedAt: yield* isoNow(tx),
            });

            yield* Db.insertDeltaDecision(
              tx,
              command.scope.bookId,
              decision.id,
              view.delta.id,
              principal.actorId,
              yield* toJsonObject(decision),
            ).pipe(Effect.mapError(databaseFailure));

            return decision;
          }),
        );
      }).pipe(Effect.mapError(databaseFailure)),
    "update",
  );
});

export const listOnboardingDeltas = Effect.fn("onboarding.delta.list")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withAdmittedPrincipal({ token }, command.scope, { operatorOnly: false }, (tx) =>
    Effect.gen(function* () {
      const rows = yield* Db.listDeltas(tx, command.scope.bookId).pipe(
        Effect.mapError(databaseFailure),
      );

      const items = yield* Effect.forEach(rows.slice(0, 50), (row) =>
        decode(D.OnboardingDelta, row.body),
      );

      return { items, hasMore: rows.length > 50 };
    }),
  );
});
