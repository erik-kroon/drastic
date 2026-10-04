import {
  readOnboardingProjectionInTransaction,
  qualifiedBankExplanationsInTransaction,
} from "./onboarding-projection";
import * as Profiles from "@open-erp/contracts/company-profiles";
import { resolveCompanyProfileInTransaction } from "./company-profiles";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as O from "@open-erp/contracts/onboarding";
import * as Sie from "@open-erp/contracts/sie-import";
import * as Closing from "@open-erp/contracts/closing";
import * as CaseDb from "../db/onboarding";
import * as Db from "../db/onboarding-lifecycle";
import * as Ledger from "../db/posting";
import type { Transaction } from "../db/transaction";
import { databaseFailure } from "../db/transaction";
import { recheckPrincipal, type VerifiedPrincipal } from "../db/identity";
import { withAdmittedPrincipal } from "./identity";
import { decode, toJsonObject, objectField, textField, type Scope } from "./commerce/support";
import { digest, isoNow, newId, replay, saveCommand } from "./posting";
import { failure } from "./failures";
import { qualifyControlInTransaction } from "./onboarding-controls";
import { readSourceBytesInTransaction } from "./source-retention";

type Command<Input> = { scope: Scope; idempotencyKey: string; input: Input };

type Snapshot = typeof O.OnboardingSnapshot.Type;

type Policy = typeof O.OnboardingResponsibilities.Type;

type Control = typeof O.OnboardingControl.Type;

type Decision = typeof O.OnboardingDecision.Type;

const acceptanceKinds = {
  opening: "accept_opening",
  book_zero: "accept_book_zero",
  final_delta: "accept_final_delta",
  activation: "confirm_activation",
  first_live: "reject",
} as const;

function withOnboardingBook<A, E, R>(
  token: string,
  scope: Scope,
  operation: (tx: Transaction, principal: VerifiedPrincipal) => Effect.Effect<A, E, R>,
  write = true,
) {
  return withAdmittedPrincipal(
    { token },
    scope,
    {
      operatorOnly: write,
      beforeBook: (tx) =>
        Db.lockParticipants(tx, scope.bookId).pipe(Effect.asVoid, Effect.mapError(databaseFailure)),
    },
    (tx, principal) => operation(tx, principal).pipe(Effect.mapError(databaseFailure)),
    write ? "update" : "share",
  );
}

function records<A>(
  tx: Transaction,
  scope: Scope,
  kind: keyof typeof Db.lifecycleRecords,
  schema: Schema.Decoder<A>,
  id?: string,
) {
  return Effect.gen(function* () {
    const rows = yield* Db.readRecords(tx, kind, scope.bookId, id);

    if (rows.length > 1000) return yield* failure("UnsupportedProfile");

    return yield* Effect.forEach(rows, (row) => decode(schema, row.body));
  });
}

function record<A>(
  tx: Transaction,
  scope: Scope,
  kind: keyof typeof Db.lifecycleRecords,
  schema: Schema.Decoder<A>,
  id: string,
) {
  return records(tx, scope, kind, schema, id).pipe(
    Effect.flatMap((items) =>
      items[0] === undefined ? failure("NotFound") : Effect.succeed(items[0]),
    ),
  );
}

export function currentOnboardingCase(tx: Transaction, scope: Scope) {
  return CaseDb.readCurrent(tx, scope.bookId).pipe(
    Effect.flatMap((rows) =>
      rows[0] === undefined ? failure("NotFound") : decode(O.OnboardingCase, rows[0].body),
    ),
  );
}

function currentPolicy(tx: Transaction, scope: Scope) {
  return records(tx, scope, "responsibilities", O.OnboardingResponsibilities).pipe(
    Effect.map((policies) => policies.sort((a, b) => b.revision - a.revision)[0] ?? null),
  );
}

function retain(
  tx: Transaction,
  scope: Scope,
  kind: keyof typeof Db.lifecycleRecords,
  value: { id: string },
  snapshotId?: string,
) {
  return toJsonObject(value).pipe(
    Effect.flatMap((body) =>
      Db.insertRecord(tx, kind, { bookId: scope.bookId, id: value.id, snapshotId, body }),
    ),
  );
}

function currentDigest(
  tx: Transaction,
  scope: Scope,
  snapshot: Pick<Snapshot, "asOf" | "controlIds">,
) {
  return Db.readDependencies(tx, scope, snapshot.asOf, snapshot.controlIds).pipe(
    Effect.flatMap((rows) =>
      rows[0] === undefined ? failure("InternalError") : Effect.succeed(rows[0].digest),
    ),
  );
}

export function onboardingSnapshotCurrent(tx: Transaction, snapshot: Snapshot) {
  return currentDigest(tx, snapshot.scope, snapshot).pipe(
    Effect.map((value) => value === snapshot.dependencyDigest),
  );
}

function requireCurrent(
  tx: Transaction,
  scope: Scope,
  input: typeof O.RequestOnboardingActivation.Type,
) {
  return Effect.gen(function* () {
    const snapshot = yield* record(tx, scope, "snapshots", O.OnboardingSnapshot, input.snapshotId);

    if (
      snapshot.digest !== input.expectedDigest ||
      !(yield* onboardingSnapshotCurrent(tx, snapshot))
    )
      return yield* failure("StaleDependency");

    return snapshot;
  });
}

function supportedCase(tx: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const current = yield* currentOnboardingCase(tx, scope);
    const book = (yield* Ledger.readBook(tx, scope))[0];

    if (!book) return yield* failure("UnsupportedProfile");

    return { current, book };
  });
}

export const qualifyOnboardingControl = Effect.fn("onboarding.qualifyControl")(function* (
  token: string,
  command: Command<typeof O.QualifyOnboardingControl.Type>,
) {
  return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
    Effect.gen(function* () {
      const operation = "qualify_onboarding_control";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        O.OnboardingControl,
      );

      if (request.previous) return request.previous;
      yield* currentOnboardingCase(tx, command.scope);

      const control = yield* qualifyControlInTransaction(
        tx,
        command.scope,
        principal.actorId,
        command.input,
      );

      const sources = yield* CaseDb.readSources(tx, command.scope.bookId, "");

      if (
        sources.some(
          (source) =>
            textField(source.body, "category") === "previous_books" &&
            textField(objectField(source.body, "occurrence"), "sha256") === control.sourceSha256,
        )
      )
        return yield* failure("InvalidJournal");

      yield* retain(tx, command.scope, "controls", control);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        control,
      );

      return control;
    }),
  );
});

export const saveOnboardingResponsibilities = Effect.fn("onboarding.saveResponsibilities")(
  function* (token: string, command: Command<typeof O.SaveOnboardingResponsibilities.Type>) {
    return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
      Effect.gen(function* () {
        const operation = "save_onboarding_responsibilities";

        const request = yield* replay(
          tx,
          command.scope,
          command.idempotencyKey,
          operation,
          principal.actorId,
          command.input,
          O.OnboardingResponsibilities,
        );

        if (request.previous) return request.previous;
        yield* currentOnboardingCase(tx, command.scope);
        const previous = yield* currentPolicy(tx, command.scope);

        if ((previous?.revision ?? 0) !== command.input.expectedRevision)
          return yield* failure("StaleDependency");
        const assignments = command.input.assignments;
        const people = yield* Db.readPeople(tx, command.scope.bookId);

        const assigned = [
          assignments.preparerId,
          assignments.bookkeepingApproverId,
          assignments.paymentApproverId,
          assignments.vatResponsibleId,
          ...assignments.activationConfirmerIds,
        ];

        if (
          new Set(assignments.activationConfirmerIds).size !==
            assignments.activationConfirmerIds.length ||
          assigned.some(
            (id) =>
              !people.some(
                (person) => person.id === id && person.enabled && person.role === "operator",
              ),
          )
        )
          return yield* failure("Forbidden");

        const body = {
          id: newId("onboardingpolicy"),
          scope: command.scope,
          revision: (previous?.revision ?? 0) + 1,
          assignments,
          recordedBy: principal.actorId,
          recordedAt: yield* isoNow(tx),
        };

        const policy = yield* decode(O.OnboardingResponsibilities, {
          ...body,
          digest: yield* digest(body),
        });

        yield* retain(tx, command.scope, "responsibilities", policy);
        yield* saveCommand(
          tx,
          command.scope,
          command.idempotencyKey,
          request.expected,
          operation,
          principal.actorId,
          policy,
        );

        return policy;
      }),
    );
  },
);

function boundary(current: typeof O.OnboardingCase.Type, purpose: Snapshot["purpose"]) {
  const dates = current.configuration.dates;

  if (purpose === "opening") return dates.openingOn;

  if (purpose === "first_live") return dates.provingPeriodEndsOn;

  if (purpose === "final_delta" || purpose === "activation") {
    if (dates.candidateLiveOn === null) return null;
    const date = new Date(`${dates.candidateLiveOn}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 1);

    return date.toISOString().slice(0, 10);
  }

  return dates.acceptanceEndsOn;
}

function approvedSnapshot(tx: Transaction, scope: Scope, purpose: Snapshot["purpose"]) {
  return Effect.gen(function* () {
    const snapshots = yield* records(tx, scope, "snapshots", O.OnboardingSnapshot);
    const decisions = yield* records(tx, scope, "decisions", O.OnboardingDecision);

    const accepted = snapshots.filter(
      (snapshot) =>
        snapshot.purpose === purpose &&
        decisions.some(
          (decision) =>
            decision.snapshotId === snapshot.id &&
            decision.decision.kind === acceptanceKinds[purpose],
        ) &&
        !decisions.some(
          (decision) => decision.snapshotId === snapshot.id && decision.decision.kind === "reject",
        ),
    );

    for (const snapshot of accepted) {
      if (yield* onboardingSnapshotCurrent(tx, snapshot)) return snapshot;
    }

    return null;
  });
}

function comparisons(
  controls: readonly Control[],
  balances: readonly { accountId: string; amount: string }[],
) {
  return Effect.gen(function* () {
    const result: Array<typeof O.OnboardingComparison.Type> = [];

    for (const control of controls.filter((item) => item.kind !== "bank_reconciling_items")) {
      const sums = new Map<string, bigint>();

      for (const fact of control.facts)
        sums.set(fact.accountId, (sums.get(fact.accountId) ?? 0n) + BigInt(fact.amountMinor));

      for (const [accountId, expected] of sums) {
        const balance = balances.find((item) => item.accountId === accountId);

        if (balance === undefined) return yield* failure("StaleDependency");
        const actual = BigInt(balance.amount);
        result.push({
          kind: control.kind,
          controlId: control.id,
          accountId,
          expectedMinor: expected.toString(),
          actualMinor: actual.toString(),
          differenceMinor: (actual - expected).toString(),
          explainedMinor: "0",
          unexplainedDifferenceMinor: (actual - expected).toString(),
          evidenceIds: [],
        });
      }
    }

    return result;
  });
}

function deltaBlockers(
  tx: Transaction,
  scope: Scope,
  runs: typeof O.CaptureOnboardingSnapshot.Type.historicalRunIds,
) {
  return Effect.gen(function* () {
    const completeInventory = yield* Db.allHistoricalRunIds(tx, scope.bookId);

    if (completeInventory.some((row) => !runs.includes(row.id)))
      return ["final_delta_run_inventory_incomplete"];

    const rows = yield* Db.readHistoricalRuns(tx, scope.bookId, runs);

    if (rows.length !== runs.length || rows.some((row) => row.status !== "posted"))
      return ["historical_effects_not_complete"];
    const references = new Map<string, string>();
    let mappings: string | null = null;
    const blockers: string[] = [];

    for (const row of rows) {
      const mapping = yield* digest(row.mappings);

      if (mappings !== null && mapping !== mappings) blockers.push("delta_mapping_changed");
      mappings = mapping;

      const vouchers = yield* Schema.decodeUnknownEffect(Sie.SiePreview.fields.vouchers)(
        row.vouchers,
      ).pipe(Effect.mapError(() => failure("InternalError")));

      for (const voucher of vouchers) {
        const content = yield* digest({ ...voucher, ordinal: 0, recordOrdinal: 0 });
        const previous = references.get(voucher.sourceReference);

        if (previous !== undefined && previous !== content)
          blockers.push("delta_changed_identity_requires_reviewed_correction");

        if (previous !== undefined && previous === content)
          blockers.push("delta_duplicate_financial_effect");
        references.set(voucher.sourceReference, content);
      }
    }

    return blockers;
  });
}

function requiredControlKinds(
  tx: Transaction,
  scope: Scope,
  asOf: string,
  purpose: Snapshot["purpose"],
) {
  return Effect.gen(function* () {
    const kinds: Control["kind"][] =
      purpose === "opening"
        ? ["trial_balance"]
        : ["trial_balance", "bank", "sales_open_items", "purchase_open_items"];

    const blockers: string[] = [];

    const facts = yield* Effect.forEach(
      yield* Db.readReviewedFacts(tx, scope.entityId, asOf),
      (row) => decode(Profiles.FactRevision, row.body),
    );

    if (purpose !== "opening") {
      for (const kind of [
        "vat_registration",
        "payroll_applicability",
        "asset_applicability",
        "foreign_currency_applicability",
      ] as const) {
        const fact = facts.find((row) => row.factKind === kind);

        if (fact === undefined || fact.value.state === "unknown")
          blockers.push(`applicability_unknown:${kind}`);
        else if (fact.value.state === "known") {
          if (fact.factKind === "vat_registration" && fact.value.value === "registered")
            kinds.push("vat");

          if (fact.factKind !== "vat_registration" && fact.value.value === true)
            blockers.push(`qualified_handoff_required:${kind}`);
        }
      }
    }

    return { kinds, blockers };
  });
}

function lifecycleBlockers(
  tx: Transaction,
  scope: Scope,
  input: typeof O.CaptureOnboardingSnapshot.Type,
  asOf: string,
  authority: string,
) {
  return Effect.gen(function* () {
    const blockers: string[] = [];

    if (input.purpose !== "opening" && (yield* approvedSnapshot(tx, scope, "opening")) === null)
      blockers.push("opening_not_accepted");

    if (
      ["final_delta", "activation", "first_live"].includes(input.purpose) &&
      (yield* approvedSnapshot(tx, scope, "book_zero")) === null
    )
      blockers.push("book_zero_not_accepted");

    if (input.purpose === "final_delta") {
      if (input.historicalRunIds.length === 0) blockers.push("final_delta_source_effects_missing");
      blockers.push(...(yield* deltaBlockers(tx, scope, input.historicalRunIds)));
    }

    if (input.purpose === "activation") {
      if ((yield* approvedSnapshot(tx, scope, "final_delta")) === null)
        blockers.push("final_delta_not_accepted");

      if (authority !== "onboarding_fenced")
        blockers.push("maintenance_writer_fence_not_established");
    }

    if (input.purpose === "first_live") {
      const activation = (yield* records(
        tx,
        scope,
        "activations",
        O.OnboardingActivationReceipt,
      ))[0];

      if (activation === undefined) blockers.push("activation_missing");
      else if (
        BigInt(
          (yield* Db.pendingAccountingWork(tx, scope.bookId, activation.authoritativeFrom, asOf))[0]
            ?.count ?? "0",
        ) > 0n
      )
        blockers.push("mandatory_accounting_work_pending");

      if (input.closingCertificateId === null) blockers.push("period_not_closed");
      else {
        const certificate = (yield* Db.readCertificate(
          tx,
          scope.bookId,
          input.closingCertificateId,
        ))[0];

        if (
          !certificate?.current ||
          certificate.endsOn !== asOf ||
          certificate.startsOn !== activation?.authoritativeFrom
        )
          blockers.push("first_period_certificate_not_current");
      }
    }

    return blockers;
  });
}

export const captureOnboardingSnapshot = Effect.fn("onboarding.capture")(function* (
  token: string,
  command: Command<typeof O.CaptureOnboardingSnapshot.Type>,
) {
  return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
    Effect.gen(function* () {
      const operation = "capture_onboarding_snapshot";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        O.OnboardingSnapshot,
      );

      if (request.previous) return request.previous;
      const { current, book } = yield* supportedCase(tx, command.scope);
      const asOf = boundary(current, command.input.purpose);

      if (asOf === null || current.configuration.migrationDepth === null)
        return yield* failure("StaleDependency");
      const controls: Control[] = [];

      if (
        new Set(command.input.controlIds).size !== command.input.controlIds.length ||
        new Set(command.input.historicalRunIds).size !== command.input.historicalRunIds.length
      )
        return yield* failure("InvalidJournal");

      const retainedControls = yield* Effect.forEach(command.input.controlIds, (id) =>
        record(tx, command.scope, "controls", O.OnboardingControl, id),
      );

      for (const control of retainedControls) {
        const original = yield* readSourceBytesInTransaction(
          tx,
          command.scope,
          control.occurrenceId,
        );

        if (
          original.occurrence.sha256 !== control.sourceSha256 ||
          control.asOf !== asOf ||
          control.currency !== book.currency
        )
          return yield* failure("StaleDependency");
        controls.push(control);
      }

      const policy = yield* currentPolicy(tx, command.scope);
      const balances = yield* Db.readBalances(tx, command.scope.bookId, asOf);

      const explanations = yield* qualifiedBankExplanationsInTransaction(
        tx,
        command.scope,
        asOf,
        controls,
      );

      const compared = (yield* comparisons(controls, balances)).map((comparison) => {
        const explanation = explanations.find(
          (entry) =>
            entry.controlId === comparison.controlId && entry.accountId === comparison.accountId,
        );

        const explainedMinor = explanation?.explainedMinor ?? "0";

        return {
          ...comparison,
          explainedMinor,
          evidenceIds: [...(explanation?.evidenceIds ?? [])],
          unexplainedDifferenceMinor: (
            BigInt(comparison.differenceMinor) - BigInt(explainedMinor)
          ).toString(),
        };
      });

      const blockers: string[] = [];
      const kinds = new Set(controls.map((control) => control.kind));

      const coverage = yield* requiredControlKinds(tx, command.scope, asOf, command.input.purpose);
      const required = coverage.kinds;
      blockers.push(...coverage.blockers);

      const profile = yield* resolveCompanyProfileInTransaction(
        tx,
        command.scope,
        current.recordClass,
        {
          postingOn: asOf,
          taxPointOn: asOf,
          paymentOn: null,
          reportOn: asOf,
          taxPeriodOn: null,
        },
      );

      if (
        profile.families.find((family) => family.family === "posting_eligibility")?.status !==
        "resolved"
      )
        blockers.push("posting_profile_not_qualified");

      for (const kind of required) if (!kinds.has(kind)) blockers.push(`missing_control:${kind}`);

      if (compared.some((comparison) => comparison.unexplainedDifferenceMinor !== "0"))
        blockers.push("independent_controls_differ");
      const trial = controls.find((control) => control.kind === "trial_balance");

      if (
        trial !== undefined &&
        balances.some(
          (balance) =>
            balance.amount !== "0" &&
            !trial.facts.some((fact) => fact.accountId === balance.accountId),
        )
      )
        blockers.push("trial_balance_account_coverage_missing");

      if (policy === null) blockers.push("responsibilities_missing");

      blockers.push(
        ...(yield* lifecycleBlockers(tx, command.scope, command.input, asOf, book.authority)),
      );

      const body = {
        id: newId("onboardingsnapshot"),
        scope: command.scope,
        purpose: command.input.purpose,
        deltaId: command.input.deltaId ?? null,
        dependencyDigest: yield* currentDigest(tx, command.scope, {
          asOf,
          controlIds: command.input.controlIds,
        }),
        caseRevision: current.revision,
        bookSequence: book.committedSequence.toString(),
        writerEpoch: book.writerEpoch.toString(),
        asOf,
        controlIds: command.input.controlIds,
        historicalRunIds: command.input.historicalRunIds,
        closingCertificateId: command.input.closingCertificateId,
        responsibilityPolicyId: policy?.id ?? null,
        comparisons: compared,
        blockers,
        permittedLimitations:
          command.input.purpose === "opening" || kinds.has("tax") ? [] : ["missing_tax_statement"],
        capturedBy: principal.actorId,
        capturedAt: yield* isoNow(tx),
      };

      const snapshot = yield* decode(O.OnboardingSnapshot, {
        ...body,
        digest: yield* digest(body),
      });

      yield* retain(tx, command.scope, "snapshots", snapshot);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        snapshot,
      );

      return snapshot;
    }),
  );
});

function expires(now: string) {
  return new Date(Date.parse(now) + 3_600_000).toISOString();
}

function acceptedLimitations(snapshot: Snapshot, decisions: readonly Decision[]) {
  return snapshot.permittedLimitations.every((limitation) =>
    decisions.some(
      (decision) =>
        decision.snapshotId === snapshot.id &&
        decision.decision.kind === "accept_limitation" &&
        decision.decision.limitation === limitation,
    ),
  );
}

export const decideOnboardingSnapshot = Effect.fn("onboarding.decide")(function* (
  token: string,
  command: Command<typeof O.DecideOnboardingSnapshot.Type>,
) {
  return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
    Effect.gen(function* () {
      const operation = "decide_onboarding_snapshot";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        O.OnboardingDecision,
      );

      if (request.previous) return request.previous;
      const snapshot = yield* requireCurrent(tx, command.scope, command.input);
      const policy = yield* currentPolicy(tx, command.scope);
      const decision = command.input.decision;
      const all = yield* records(tx, command.scope, "decisions", O.OnboardingDecision);

      if (decision.kind === "accept_limitation") {
        if (policy === null || policy.assignments.bookkeepingApproverId !== principal.actorId)
          return yield* failure("Forbidden");

        if (!snapshot.permittedLimitations.includes(decision.limitation))
          return yield* failure("UnsupportedProfile");
      } else if (decision.kind !== "reject") {
        if (decision.kind !== acceptanceKinds[snapshot.purpose])
          return yield* failure("InvalidJournal");

        if (snapshot.blockers.length !== 0 || !acceptedLimitations(snapshot, all))
          return yield* failure("StaleDependency");

        if (
          policy === null ||
          (decision.kind === "confirm_activation"
            ? !policy.assignments.activationConfirmerIds.includes(principal.actorId)
            : policy.assignments.bookkeepingApproverId !== principal.actorId)
        )
          return yield* failure("Forbidden");
      }

      const now = yield* isoNow(tx);

      const retained = yield* decode(O.OnboardingDecision, {
        id: newId("onboardingdecision"),
        scope: command.scope,
        snapshotId: snapshot.id,
        snapshotDigest: snapshot.digest,
        decision,
        actorId: principal.actorId,
        recordedAt: now,
        authority: principal,
        expiresAt: expires(now),
      });

      yield* retain(tx, command.scope, "decisions", retained, snapshot.id);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        retained,
      );

      return retained;
    }),
  );
});

function confirmations(tx: Transaction, scope: Scope, snapshot: Snapshot, policy: Policy) {
  return Effect.gen(function* () {
    const decisions = yield* records(tx, scope, "decisions", O.OnboardingDecision);
    const now = yield* isoNow(tx);

    if (
      decisions.some(
        (decision) => decision.snapshotId === snapshot.id && decision.decision.kind === "reject",
      )
    )
      return yield* failure("ApprovalRequired");
    const result: Decision[] = [];

    for (const actor of policy.assignments.activationConfirmerIds) {
      const decision = decisions.find(
        (entry) =>
          entry.actorId === actor &&
          entry.snapshotId === snapshot.id &&
          entry.snapshotDigest === snapshot.digest &&
          entry.decision.kind === "confirm_activation" &&
          Date.parse(entry.expiresAt) > Date.parse(now),
      );

      if (decision === undefined) return yield* failure("ApprovalRequired");
      yield* recheckPrincipal(tx, decision.authority, scope, { operatorOnly: true }, "share");
      result.push(decision);
    }

    return result;
  });
}

export const requestOnboardingActivation = Effect.fn("onboarding.requestActivation")(function* (
  token: string,
  command: Command<typeof O.RequestOnboardingActivation.Type>,
) {
  return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
    Effect.gen(function* () {
      const operation = "request_onboarding_activation";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        O.OnboardingActivationIntent,
      );

      if (request.previous) return request.previous;
      const snapshot = yield* requireCurrent(tx, command.scope, command.input);
      const policy = yield* currentPolicy(tx, command.scope);

      if (snapshot.purpose !== "activation" || snapshot.blockers.length !== 0 || policy === null)
        return yield* failure("StaleDependency");
      yield* confirmations(tx, command.scope, snapshot, policy);
      const now = yield* isoNow(tx);

      const intent = yield* decode(O.OnboardingActivationIntent, {
        id: newId("onboardingintent"),
        scope: command.scope,
        snapshotId: snapshot.id,
        snapshotDigest: snapshot.digest,
        requestedBy: principal.actorId,
        requestedAt: now,
        authority: principal,
        expiresAt: expires(now),
      });

      yield* retain(tx, command.scope, "intents", intent, snapshot.id);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        intent,
      );

      return intent;
    }),
  );
});

export const executeOnboardingActivationInTransaction = Effect.fn("onboarding.executeActivation")(
  function* (tx: Transaction, scope: Scope, intentId: string, proofId: string) {
    if (!(yield* Db.maintenancePrivilege(tx))[0]?.allowed) return yield* failure("Forbidden");
    const previous = (yield* records(tx, scope, "activations", O.OnboardingActivationReceipt))[0];

    if (previous !== undefined) {
      if (previous.intentId !== intentId || previous.operationalProof.id !== proofId)
        return yield* failure("IdempotencyConflict");

      return previous;
    }

    const intent = yield* record(tx, scope, "intents", O.OnboardingActivationIntent, intentId);
    yield* Db.lockParticipants(tx, scope.bookId);
    yield* recheckPrincipal(tx, intent.authority, scope, { operatorOnly: true }, "update");
    const now = yield* isoNow(tx);

    if (Date.parse(intent.expiresAt) <= Date.parse(now)) return yield* failure("ApprovalRequired");

    const snapshot = yield* requireCurrent(tx, scope, {
      snapshotId: intent.snapshotId,
      expectedDigest: intent.snapshotDigest,
    });

    const { current, book } = yield* supportedCase(tx, scope);
    const policy = yield* currentPolicy(tx, scope);

    if (
      current.recordClass !== "synthetic" ||
      book.profile !== "synthetic-core-v1" ||
      snapshot.purpose !== "activation" ||
      snapshot.blockers.length !== 0 ||
      book.authority !== "onboarding_fenced" ||
      policy === null ||
      current.configuration.dates.candidateLiveOn === null
    )
      return yield* failure("StaleDependency");
    const proof = yield* record(tx, scope, "proofs", O.OnboardingOperationalProof, proofId);

    if (
      proof.snapshotId !== snapshot.id ||
      proof.snapshotDigest !== snapshot.digest ||
      Date.parse(proof.expiresAt) <= Date.parse(now) ||
      Date.parse(proof.observedAt) > Date.parse(now)
    )
      return yield* failure("StaleDependency");
    const approvals = yield* confirmations(tx, scope, snapshot, policy);
    const promoted = (yield* Db.promote(tx, scope.bookId))[0];

    if (promoted === undefined || BigInt(promoted.epoch) !== book.writerEpoch + 1n)
      return yield* failure("InternalError");

    const historicalSnapshots = yield* records(tx, scope, "snapshots", O.OnboardingSnapshot);
    const limitationDecisions = yield* records(tx, scope, "decisions", O.OnboardingDecision);
    const currentHistorical = yield* Effect.filter(historicalSnapshots, (entry) => onboardingSnapshotCurrent(tx, entry));
    const retainedLimitations = limitationDecisions.filter((decision) => decision.decision.kind === "accept_limitation" &&
      currentHistorical.some((entry) => entry.id === decision.snapshotId) &&
      !limitationDecisions.some((rejection) => rejection.snapshotId === decision.snapshotId && rejection.decision.kind === "reject"));

    const receipt = yield* decode(O.OnboardingActivationReceipt, {
      id: newId("onboardingactivation"),
      scope,
      intentId,
      snapshot,
      projection: yield* readOnboardingProjectionInTransaction(tx, scope),
      acceptedLimitations: retainedLimitations,
      operationalProof: proof,
      confirmations: approvals,
      authoritativeFrom: current.configuration.dates.candidateLiveOn,
      activatedAt: now,
      activatedBy: intent.requestedBy,
      previousEpoch: book.writerEpoch.toString(),
      promotedEpoch: promoted.epoch,
      kind: "synthetic_onboarding_activation_v1",
      statutoryReady: false,
    });

    yield* retain(tx, scope, "activations", receipt, snapshot.id);

    return receipt;
  },
);

export const completeOnboardingFirstPeriod = Effect.fn("onboarding.completeFirstPeriod")(function* (
  token: string,
  command: Command<typeof O.CompleteOnboardingFirstPeriod.Type>,
) {
  return yield* withOnboardingBook(token, command.scope, (tx, principal) =>
    Effect.gen(function* () {
      const operation = "complete_onboarding_first_period";

      const request = yield* replay(
        tx,
        command.scope,
        command.idempotencyKey,
        operation,
        principal.actorId,
        command.input,
        O.OnboardingFirstPeriodCompletion,
      );

      if (request.previous) return request.previous;
      const snapshot = yield* requireCurrent(tx, command.scope, command.input);
      const policy = yield* currentPolicy(tx, command.scope);

      const activation = (yield* records(
        tx,
        command.scope,
        "activations",
        O.OnboardingActivationReceipt,
      ))[0];

      if (
        snapshot.purpose !== "first_live" ||
        snapshot.blockers.length !== 0 ||
        snapshot.closingCertificateId === null ||
        activation === undefined ||
        policy === null
      )
        return yield* failure("StaleDependency");

      if (policy.assignments.bookkeepingApproverId !== principal.actorId)
        return yield* failure("Forbidden");
      const decisions = yield* records(tx, command.scope, "decisions", O.OnboardingDecision);

      if (!acceptedLimitations(snapshot, decisions)) return yield* failure("ApprovalRequired");

      const certificate = (yield* Db.readCertificate(
        tx,
        command.scope.bookId,
        snapshot.closingCertificateId,
      ))[0];

      if (!certificate?.current) return yield* failure("StaleDependency");
      yield* decode(Closing.ClosingCertificate, certificate.body);

      const receipt = yield* decode(O.OnboardingFirstPeriodCompletion, {
        id: newId("onboardingcompletion"),
        scope: command.scope,
        activationReceiptId: activation.id,
        snapshot,
        closingCertificateId: snapshot.closingCertificateId,
        completedBy: principal.actorId,
        completedAt: yield* isoNow(tx),
        kind: "synthetic_first_live_period_v1",
        statutoryReady: false,
      });

      yield* retain(tx, command.scope, "completions", receipt, snapshot.id);
      yield* saveCommand(
        tx,
        command.scope,
        command.idempotencyKey,
        request.expected,
        operation,
        principal.actorId,
        receipt,
      );

      return receipt;
    }),
  );
});

export function readOnboardingLifecycleInTransaction(
  tx: Transaction,
  scope: Scope,
  viewerActorId: string,
) {
  return Effect.gen(function* () {
    yield* currentOnboardingCase(tx, scope);
    const snapshots = yield* records(tx, scope, "snapshots", O.OnboardingSnapshot);
    const completions = yield* records(tx, scope, "completions", O.OnboardingFirstPeriodCompletion);
    const completion = completions.sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0];

    return {
      scope,
      projection: yield* readOnboardingProjectionInTransaction(tx, scope),
      viewerActorId,
      people: yield* Db.readPeople(tx, scope.bookId),
      controls: yield* records(tx, scope, "controls", O.OnboardingControl),
      responsibilities: yield* currentPolicy(tx, scope),
      snapshots: yield* Effect.forEach(snapshots, (snapshot) =>
        onboardingSnapshotCurrent(tx, snapshot).pipe(
          Effect.map((current) => ({ snapshot, current })),
        ),
      ),
      decisions: yield* records(tx, scope, "decisions", O.OnboardingDecision),
      intents: yield* records(tx, scope, "intents", O.OnboardingActivationIntent),
      activation:
        (yield* records(tx, scope, "activations", O.OnboardingActivationReceipt))[0] ?? null,
      completion:
        completion === undefined
          ? null
          : {
              receipt: completion,
              current: yield* onboardingSnapshotCurrent(tx, completion.snapshot),
            },
    } satisfies typeof O.OnboardingLifecycle.Type;
  });
}

export const getOnboardingLifecycle = Effect.fn("onboarding.lifecycle")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withOnboardingBook(
    token,
    command.scope,
    (tx, principal) => readOnboardingLifecycleInTransaction(tx, command.scope, principal.actorId),
    false,
  );
});
