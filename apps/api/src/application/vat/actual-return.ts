import * as Vat from "@open-erp/contracts/vat-returns";
import { SupportedCalculatorVersion } from "@open-erp/contracts/vat-filing-release";
import {
  actualVatMonetary,
  calculateActualVat,
  type VatMonetary,
} from "@open-erp/jurisdiction-se/vat-actual";
import type { AccountingError } from "@open-erp/contracts/accounting";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as CompanyDb from "../../db/company-profiles";
import * as Ledger from "../../db/posting";
import * as Db from "../../db/vat/actual-return";
import * as TaxAccountDb from "../../db/vat/tax-account";
import type { Transaction } from "../../db/transaction";
import { decodeRelease } from "../company-profile-basis";
import { resolveCompanyProfileInTransaction } from "../company-profiles";
import { failure } from "../failures";
import { isoNow, newId, replay, saveCommand } from "../posting";
import { decode, toJsonObject, unsupported, withBook, type Scope } from "../commerce/support";
import { digestBody } from "./basis";

// The actual domestic VAT return. One consistent capture under the shared book
// barrier, one pure calculation with no lock held, and one sealing transaction
// that writes an immutable snapshot. Rate, box, filing unit, registered period,
// control opening balances and source coverage are qualified inputs this owner
// reads or refuses; it never supplies one and never establishes a tax position.

type Input = typeof Vat.PrepareActualVatReturn.Type;

type Basis = typeof Vat.VatActualBasis.Type;

type Calculation = typeof Vat.VatActualCalculation.Type;

export type ActualVatCalculator = (basis: Basis) => Effect.Effect<Calculation, AccountingError>;

export function makeActualVatCalculator(monetary: VatMonetary): ActualVatCalculator {
  return (basis) =>
    Effect.try({
      try: () => calculateActualVat(basis, monetary),
      catch: () => failure("Unavailable"),
    });
}

const defaultCalculator = makeActualVatCalculator(actualVatMonetary);

type Witness = (typeof Vat.VatActualBasis.Type)["profileWitness"];

type Binding = typeof Vat.VatControlAccountRoleBinding.Type;

type Role = typeof Vat.VatControlAccountRole.Type;

type ReturnRecord = typeof Vat.ActualVatReturn.Type;

const ReturnSchema = Vat.ActualVatReturn;

const ViewSchema = Vat.ActualVatReturnView;

const ListSchema = Vat.ActualVatReturnList;

const BasisSchema = Vat.VatActualBasis;

const roleOrder: ReadonlyArray<Role> = [
  "output_vat_control",
  "input_vat_control",
  "vat_settlement_control",
];

const treatments: ReadonlyArray<NonNullable<(typeof Vat.VatSelectedFact.Type)["treatment"]>> = [
  "domestic_sale",
  "domestic_purchase",
];

const factInventoryBound = 500;

const controlLineBound = 500;

const controlMovementBound = 500;

const returnInventoryBound = 500;

const profileBound = 20;

const ownerRecordBound = 500;

function requireAccess(transaction: Transaction, write: boolean) {
  return Db.readActualReturnAccess(transaction).pipe(
    Effect.flatMap((rows) => {
      if (rows.length !== Db.actualReturnTables.length) return unsupported();

      const denied = rows.some((row) => {
        if (!row.canSelect) return true;

        return write && Db.isActualReturnWritable(row.tableName) && !row.canInsert;
      });

      return denied ? unsupported() : Effect.void;
    }),
  );
}

// The registered period, every rate, box, filing unit and rounding mode come
// from the reviewed `vat` rule release the company admission owner resolved for
// this book on the date this operation uses. An unadmitted family, a release
// without a qualified VAT section, an unsupported calculator or a release
// qualified for another currency are refusals, never defaults.
function readQualifiedRelease(transaction: Transaction, scope: Scope, input: Input) {
  return Effect.gen(function* () {
    const resolved = yield* resolveCompanyProfileInTransaction(
      transaction,
      scope,
      "actual_company",
      {
        postingOn: null,
        taxPointOn: input.endsOn,
        paymentOn: null,
        reportOn: null,
      },
    );

    const witness = resolved.families.find((entry) => entry.family === "vat")?.witness ?? null;

    if (witness === null) return yield* unsupported();
    const book = (yield* Ledger.readBook(transaction, scope))[0];

    if (!book) return yield* failure("Forbidden");
    const releases = yield* CompanyDb.readRuleReleases(transaction, "vat");

    const row = releases.find(
      (entry) =>
        entry.id === witness.ruleReleaseId && entry.checksum === witness.ruleReleaseChecksum,
    );

    if (row === undefined) return yield* unsupported();

    const release = decodeRelease(row);

    if (release === null || release.vat === undefined) return yield* unsupported();
    const filing = release.vat;

    if (filing.calculatorVersion !== SupportedCalculatorVersion) return yield* unsupported();

    if (filing.currency !== book.currency) return yield* unsupported();

    if (filing.filingUnitScale > book.currencyScale) return yield* unsupported();

    return { book, witness, releaseId: row.id, checksum: row.checksum, filing };
  });
}

// A reviewed registered VAT period is a company fact revision the witness itself
// selected, covering the whole declared window. The released synthetic
// reclassification obligation is pinned to a synthetic registration namespace and
// cannot express an actual company period, so it is never used here.
function readRegisteredPeriod(
  transaction: Transaction,
  scope: Scope,
  input: Input,
  witness: Witness,
) {
  return Effect.gen(function* () {
    const revisions = yield* CompanyDb.readFactRevisions(
      transaction,
      scope.entityId,
      input.startsOn,
      input.endsOn,
    );

    const revision = revisions.find(
      (row) => row.factKind === "vat_period" && witness.factRevisionIds.includes(row.id),
    );

    if (revision === undefined) return yield* unsupported();

    if (
      revision.effectiveFrom > input.startsOn ||
      (revision.effectiveTo !== null && revision.effectiveTo < input.endsOn)
    ) {
      return yield* unsupported();
    }

    const sha256 = (yield* Ledger.readEvidence(
      transaction,
      scope.bookId,
      input.periodEvidenceId,
    ))[0]?.sha256;

    if (sha256 === undefined) return yield* failure("MissingEvidence");

    return yield* decode(
      BasisSchema.fields.registeredPeriod,
      yield* toJsonObject({
        factRevisionId: revision.id,
        factRevisionDigest: revision.digest,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        periodEvidenceId: input.periodEvidenceId,
        periodEvidenceSha256: sha256,
      }),
    );
  });
}

// The reviewed control account-role bindings, verified against the current
// account version and active state. A stale or inactive binding is refused; the
// captured roles are never taken on trust.
function readControlBindings(transaction: Transaction, scope: Scope) {
  return Effect.gen(function* () {
    const profiles = yield* Db.readControlProfiles(transaction, scope.bookId);

    if (profiles.length === 0 || profiles.length > profileBound) return yield* unsupported();
    const complete: Array<ReadonlyArray<Binding>> = [];

    for (const profile of profiles) {
      const roles = yield* Db.readControlRoles(transaction, scope.bookId, profile.id);

      if (roles.length !== roleOrder.length) continue;

      if (!roleOrder.every((role) => roles.some((row) => row.role === role && row.active))) {
        continue;
      }

      if (new Set(roles.map((row) => row.accountId)).size !== roles.length)
        return yield* unsupported();
      const bindings: Array<Binding> = [];

      for (const row of roles) {
        const role = roleOrder.find((candidate) => candidate === row.role);

        if (role === undefined) continue;
        bindings.push({
          role,
          accountId: row.accountId,
          accountVersion: row.accountVersion,
          code: row.code,
          name: row.name,
          active: row.active,
        });
      }

      complete.push(bindings);
    }

    if (complete.length !== 1) return yield* unsupported();

    const bindings = complete[0] ?? [];

    if (bindings.length === 0) return yield* unsupported();

    const accounts = yield* Ledger.readAccounts(
      transaction,
      scope.bookId,
      bindings.map((binding) => binding.accountId),
    );

    for (const binding of bindings) {
      const account = accounts.find((entry) => entry.id === binding.accountId);

      if (!account || !account.active) return yield* unsupported();

      if (account.version.toString() !== binding.accountVersion) {
        return yield* failure("StaleDependency");
      }
    }

    return yield* Schema.decodeEffect(BasisSchema.fields.accountRoles)(bindings).pipe(
      Effect.mapError(() => failure("InternalError")),
    );
  });
}

function readReviewedOpenings(input: Input, bindings: ReadonlyArray<Binding>) {
  if (input.controlOpenings.length !== bindings.length) return failure("InvalidJournal");

  const stated = new Map(input.controlOpenings.map((row) => [row.accountId, row.signedMinor]));

  if (stated.size !== input.controlOpenings.length) return failure("InvalidJournal");

  for (const binding of bindings) {
    if (!stated.has(binding.accountId)) return failure("InvalidJournal");
  }

  return Effect.succeed(stated);
}

// Independent coverage is stated per required source family and backed by a
// retained evidence digest. A release that names a family the caller did not
// answer, or a caller that answered a family the release does not name, is a
// malformed request rather than a silent partial coverage.
function readCoverage(
  transaction: Transaction,
  scope: Scope,
  input: Input,
  filing: (typeof Vat.VatActualBasis.Type)["mappingRelease"]["vat"],
) {
  return Effect.gen(function* () {
    if (
      new Set(input.sourceCoverage.map((row) => row.family)).size !== input.sourceCoverage.length
    ) {
      return yield* failure("InvalidJournal");
    }

    const required = new Set(filing.requiredSourceFamilies);
    const stated = new Map(input.sourceCoverage.map((row) => [row.family, row]));

    if (stated.size !== required.size) return yield* failure("InvalidJournal");

    for (const family of stated.keys()) {
      if (!required.has(family)) return yield* failure("InvalidJournal");
    }

    const members: Array<typeof Vat.VatSourceCoverageState.Type> = [];

    for (const family of filing.requiredSourceFamilies) {
      const member = stated.get(family);

      if (member === undefined) return yield* failure("InvalidJournal");

      if (member.evidenceId === null) {
        members.push({ family, state: member.state, evidenceId: null, evidenceSha256: null });
        continue;
      }

      const sha256 = (yield* Ledger.readEvidence(transaction, scope.bookId, member.evidenceId))[0]
        ?.sha256;

      if (sha256 === undefined) return yield* failure("MissingEvidence");
      members.push({
        family,
        state: member.state,
        evidenceId: member.evidenceId,
        evidenceSha256: sha256,
      });
    }

    return yield* Schema.decodeEffect(BasisSchema.fields.sourceCoverage)(members).pipe(
      Effect.mapError(() => failure("InternalError")),
    );
  });
}

function readControlSnapshot(
  transaction: Transaction,
  scope: Scope,
  binding: Binding,
  opening: string,
  startsOn: string,
  endsOn: string,
  ledgerBoundary: string,
) {
  return Effect.gen(function* () {
    const bound = yield* TaxAccountDb.readLedgerLineBound(
      transaction,
      scope.bookId,
      binding.accountId,
      endsOn,
      ledgerBoundary,
    );

    if ((bound[0]?.total ?? 0) > controlMovementBound) return yield* unsupported();

    const totals = (yield* TaxAccountDb.readLedgerTotals(
      transaction,
      scope.bookId,
      binding.accountId,
      startsOn,
      endsOn,
      ledgerBoundary,
    ))[0];

    if (totals === undefined) return yield* failure("StaleDependency");

    const rows = yield* TaxAccountDb.readLedgerLines(
      transaction,
      scope.bookId,
      binding.accountId,
      startsOn,
      endsOn,
      ledgerBoundary,
    );

    const movements: Array<typeof Vat.VatControlMovementRow.Type> = [];

    for (const row of rows) {
      const item = row.item;

      if (item["part"] !== "movement") continue;

      const voucherId = item["voucherId"];
      const lineId = item["lineId"];
      const postingDate = item["postingDate"];
      const signedMinor = item["amountMinor"];
      const postingPurpose = item["postingPurpose"];

      if (
        typeof voucherId !== "string" ||
        typeof lineId !== "string" ||
        typeof postingDate !== "string" ||
        typeof signedMinor !== "string" ||
        typeof postingPurpose !== "string"
      ) {
        return yield* failure("InternalError");
      }

      movements.push({ voucherId, lineId, postingDate, signedMinor, postingPurpose });
    }

    return yield* decode(
      Vat.VatControlSnapshot,
      yield* toJsonObject({
        role: binding.role,
        accountId: binding.accountId,
        reviewedOpeningMinor: opening,
        frozenGlOpeningMinor: totals.opening,
        frozenGlMovementMinor: totals.movement,
        frozenGlClosingMinor: totals.closing,
        movements,
      }),
    );
  });
}

function controlComponents(
  lines: ReadonlyArray<Db.ControlLineRow>,
  roles: ReadonlyMap<string, Role>,
  startsOn: string,
  endsOn: string,
) {
  const components: Array<typeof Vat.VatFactControlComponent.Type> = [];

  for (const line of lines) {
    const role = roles.get(line.accountId);

    if (role === undefined) continue;
    const signedMinor = (BigInt(line.debitMinor) - BigInt(line.creditMinor)).toString();
    components.push({
      voucherId: line.voucherId,
      lineId: line.lineId,
      accountId: line.accountId,
      role,
      signedMinor,
      postingDate: line.postingDate,
      withinControlInterval: line.postingDate >= startsOn && line.postingDate <= endsOn,
    });
  }

  return components;
}

function treatmentOf(value: string): (typeof Vat.VatSelectedFact.Type)["treatment"] {
  return treatments.find((treatment) => treatment === value) ?? null;
}

function signedSourceTax(row: Db.PurchaseComponentRow) {
  const amount = BigInt(row.sourceTaxMinor);

  return (row.adjustsTaxFactId === null ? amount : -amount).toString();
}

// Capture is set-based over the selected tax points. It reads the manual VAT fact
// admission and the owned purchase recognition components once, reads the
// released reclassification effects for every obligation, and reads the released
// amendment owner's committed inventory. It selects and summarises; it never
// chooses a treatment, activates a profile or computes an amount.
function captureBasis(transaction: Transaction, scope: Scope, input: Input) {
  return Effect.gen(function* () {
    if (input.startsOn > input.endsOn) return yield* failure("InvalidJournal");
    const qualified = yield* readQualifiedRelease(transaction, scope, input);
    const period = yield* readRegisteredPeriod(transaction, scope, input, qualified.witness);
    const bindings = yield* readControlBindings(transaction, scope);
    const openings = yield* readReviewedOpenings(input, bindings);
    const coverage = yield* readCoverage(transaction, scope, input, qualified.filing);

    const openingSha256 = (yield* Ledger.readEvidence(
      transaction,
      scope.bookId,
      input.openingEvidenceId,
    ))[0]?.sha256;

    if (openingSha256 === undefined) return yield* failure("MissingEvidence");
    const roles = new Map(bindings.map((binding) => [binding.accountId, binding.role]));
    const ledgerBoundary = qualified.book.committedSequence.toString();
    const controls: Array<typeof Vat.VatControlSnapshot.Type> = [];

    for (const binding of bindings) {
      controls.push(
        yield* readControlSnapshot(
          transaction,
          scope,
          binding,
          openings.get(binding.accountId) ?? "0",
          input.startsOn,
          input.endsOn,
          ledgerBoundary,
        ),
      );
    }

    const admitted = yield* Db.readAdmittedFacts(
      transaction,
      scope.bookId,
      input.startsOn,
      input.endsOn,
    );

    const purchased = yield* Db.readPurchaseComponents(
      transaction,
      scope.bookId,
      input.startsOn,
      input.endsOn,
    );

    if (admitted.length + purchased.length > factInventoryBound) return yield* unsupported();

    const effects = yield* Db.readControlEffectsInInterval(
      transaction,
      scope.bookId,
      input.startsOn,
      input.endsOn,
    );

    if (effects.length > ownerRecordBound) return yield* unsupported();
    const amendments = yield* Db.readAmendmentInventory(transaction, scope.bookId);

    if (amendments.length > ownerRecordBound) return yield* unsupported();
    const population = (yield* Db.readPopulation(transaction, scope.bookId))[0];

    if (population === undefined) return yield* failure("InternalError");

    const membership = yield* CompanyDb.readFamilyMembership(
      transaction,
      scope.bookId,
      "vat",
      "share",
    );

    const voucherIds = [
      ...new Set([
        ...admitted.flatMap((row) => (row.voucherId === null ? [] : [row.voucherId])),
        ...purchased.map((row) => row.voucherId),
        ...effects.flatMap((row) => (row.voucherId === null ? [] : [row.voucherId])),
      ]),
    ];

    const lines = yield* Db.readVoucherControlLines(
      transaction,
      scope.bookId,
      voucherIds,
      bindings.map((binding) => binding.accountId),
    );

    if (lines.length > controlLineBound * roleOrder.length) return yield* unsupported();
    const byVoucher = new Map<string, Array<Db.ControlLineRow>>();

    for (const line of lines) {
      byVoucher.set(line.voucherId, [...(byVoucher.get(line.voucherId) ?? []), line]);
    }

    const links = yield* Db.readPurchaseControlLinks(transaction, scope.bookId, [
      ...new Set(purchased.map((row) => row.recognitionId)),
    ]);

    const sourceOrdinals = new Map<string, Set<number>>();

    for (const link of links) {
      const key = JSON.stringify([link.recognitionId, link.sourceLineId]);
      const ordinals = sourceOrdinals.get(key) ?? new Set<number>();
      ordinals.add(link.journalOrdinal);
      sourceOrdinals.set(key, ordinals);
    }

    const ownedEffects: Array<typeof Vat.VatOwnedControlEffect.Type> = [];

    for (const row of effects) {
      if (row.voucherId === null) continue;
      ownedEffects.push({
        owner: "control_reclassification",
        effectId: row.id,
        obligationId: row.obligationId,
        voucherId: row.voucherId,
        postingDate: row.postingDate,
        controlComponents: controlComponents(
          byVoucher.get(row.voucherId) ?? [],
          roles,
          input.startsOn,
          input.endsOn,
        ),
      });
    }

    const facts: Array<typeof Vat.VatSelectedFact.Type> = [];

    for (const row of admitted) {
      if (row.voucherId === null || row.treatment === null || row.taxPointOn === null) {
        return yield* failure("StaleDependency");
      }

      const treatment = treatmentOf(row.treatment);

      facts.push({
        factId: row.factId,
        origin: "manual_admission",
        revisionId: row.revisionId,
        digest: row.digest,
        treatment,
        taxPointOn: row.taxPointOn,
        voucherId: row.voucherId,
        basisMinor: row.netMinor,
        taxMinor: row.vatMinor,
        sourceTaxMinor: row.vatMinor,
        adjustsFactId: null,
        ruleReleaseId: null,
        observation: {
          recordClass: row.recordClass === "synthetic" ? "synthetic" : "actual_company",
          treatment,
          withdrawn: row.withdrawn,
          voucherReversed: row.voucherReversed,
          withinLedgerBoundary:
            row.voucherSequence !== null && BigInt(row.voucherSequence) <= BigInt(ledgerBoundary),
        },
        controlComponents: controlComponents(
          byVoucher.get(row.voucherId) ?? [],
          roles,
          input.startsOn,
          input.endsOn,
        ),
      });
    }

    for (const row of purchased) {
      const ordinals = sourceOrdinals.get(JSON.stringify([row.recognitionId, row.sourceLineId]));

      facts.push({
        factId: row.id,
        origin: "owned_purchase_recognition",
        revisionId: row.id,
        digest: row.digest,
        treatment: "domestic_purchase",
        taxPointOn: row.taxPointOn,
        voucherId: row.voucherId,
        basisMinor: row.signedBaseMinor,
        taxMinor: row.signedDeductibleTaxMinor,
        sourceTaxMinor: signedSourceTax(row),
        adjustsFactId: row.adjustsTaxFactId,
        ruleReleaseId: row.ruleReleaseId,
        observation: {
          recordClass: "actual_company",
          treatment: "domestic_purchase",
          withdrawn: false,
          voucherReversed: row.voucherReversed,
          withinLedgerBoundary:
            row.voucherSequence !== null && BigInt(row.voucherSequence) <= BigInt(ledgerBoundary),
        },
        controlComponents: controlComponents(
          (byVoucher.get(row.voucherId) ?? []).filter((line) => ordinals?.has(line.ordinal)),
          roles,
          input.startsOn,
          input.endsOn,
        ),
      });
    }

    return yield* decode(
      BasisSchema,
      yield* digestBody(
        yield* toJsonObject({
          scope,
          engine: "vat-actual-return-v1",
          bookProfile: qualified.book.profile,
          currency: qualified.book.currency,
          currencyScale: qualified.book.currencyScale,
          ledgerBoundary,
          recordedCutoff: yield* isoNow(transaction),
          registeredPeriod: period,
          profileWitness: qualified.witness,
          mappingRelease: {
            releaseId: qualified.releaseId,
            checksum: qualified.checksum,
            vat: qualified.filing,
          },
          accountRoles: bindings,
          population: {
            bookAdmittedFactCount: population.admittedFacts,
            bookPurchaseComponentCount: population.purchaseComponents,
            selectedAdmittedFactCount: admitted.length,
            selectedPurchaseComponentCount: purchased.length,
            withoutTaxPoint: population.admittedWithoutTaxPoint,
            membershipEpoch: membership[0]?.membershipEpoch.toString() ?? "0",
          },
          recognitions: [...new Set(purchased.map((row) => row.recognitionId))].sort(),
          facts,
          controls,
          ownedEffects,
          sourceCoverage: coverage,
          ownerPorts: [
            {
              owner: "vat_control_reclassification",
              state: "read_committed_records",
              recordCount: effects.length,
              recordDigests: effects.map((row) => row.digest).sort(),
            },
            {
              // The released amendment owner commits no voucher and exposes no
              // per-account vector, so its complete bounded membership is all a
              // capture can read and all that can move a control.
              owner: "vat_draft_amendment",
              state: "no_committed_financial_effect",
              recordCount: amendments.length,
              recordDigests: amendments.map((row) => row.digest).sort(),
            },
          ],
          openingEvidenceId: input.openingEvidenceId,
          openingEvidenceSha256: openingSha256,
        }),
      ),
    );
  });
}

// The comparison between the first and the sealing capture ignores when each read
// happened. Everything a later change could invalidate is compared; the capture
// timestamp is retained, never compared.
function captureDependencies(basis: Basis) {
  return digestBody(
    toJsonObjectSync(
      Object.fromEntries(
        Object.entries(basis).filter(([key]) => key !== "digest" && key !== "recordedCutoff"),
      ),
    ),
  ).pipe(Effect.map((body) => body["digest"]));
}

function toJsonObjectSync(value: unknown) {
  return Schema.decodeUnknownSync(Schema.JsonObject)(value);
}

// Currentness is a live read of the retained identities. It never recalculates
// and never refuses: an old return still shows its saved calculation and its
// own separate currentness.
function currentnessReasons(transaction: Transaction, scope: Scope, saved: ReturnRecord) {
  return Effect.gen(function* () {
    const reasons: Array<string> = [];
    const period = saved.basis.registeredPeriod;
    const book = (yield* Ledger.readBook(transaction, scope))[0];

    if (!book) return yield* failure("Forbidden");

    if (book.committedSequence.toString() !== saved.basis.ledgerBoundary) {
      reasons.push("ledger_boundary_moved");
    }

    const membership = yield* CompanyDb.readFamilyMembership(
      transaction,
      scope.bookId,
      "vat",
      "share",
    );

    if (
      (membership[0]?.membershipEpoch.toString() ?? "0") !== saved.basis.population.membershipEpoch
    ) {
      reasons.push("vat_family_membership_changed");
    }

    const releases = yield* CompanyDb.readRuleReleases(transaction, "vat");

    if (!releases.some((row) => row.id === saved.basis.mappingRelease.releaseId)) {
      reasons.push("rule_release_missing");
    }

    const population = (yield* Db.readPopulation(transaction, scope.bookId))[0];

    if (population === undefined) return yield* failure("InternalError");

    if (population.admittedFacts !== saved.basis.population.bookAdmittedFactCount) {
      reasons.push("admitted_fact_population_changed");
    }

    if (population.purchaseComponents !== saved.basis.population.bookPurchaseComponentCount) {
      reasons.push("purchase_component_population_changed");
    }

    const facts = yield* Db.readAdmittedFacts(
      transaction,
      scope.bookId,
      period.startsOn,
      period.endsOn,
    );

    const purchased = yield* Db.readPurchaseComponents(
      transaction,
      scope.bookId,
      period.startsOn,
      period.endsOn,
    );

    if (facts.length !== saved.basis.population.selectedAdmittedFactCount) {
      reasons.push("admitted_fact_membership_changed");
    }

    if (purchased.length !== saved.basis.population.selectedPurchaseComponentCount) {
      reasons.push("purchase_component_membership_changed");
    }

    const selected = new Map(saved.basis.facts.map((fact) => [fact.factId, fact.digest]));

    const live: Array<{ readonly factId: string; readonly digest: string }> = [
      ...facts.map((row) => ({ factId: row.factId, digest: row.digest })),
      ...purchased.map((row) => ({ factId: row.id, digest: row.digest })),
    ];

    for (const row of live) {
      if (selected.get(row.factId) !== row.digest) {
        reasons.push("selected_component_changed");
        break;
      }
    }

    const recognitions = [...new Set(purchased.map((row) => row.recognitionId))].sort();

    if (recognitions.join("|") !== saved.basis.recognitions.join("|")) {
      reasons.push("purchase_recognition_changed");
    }

    const effects = yield* Db.readControlEffectsInInterval(
      transaction,
      scope.bookId,
      period.startsOn,
      period.endsOn,
    );

    if (effects.length !== saved.basis.ownedEffects.length) reasons.push("control_effects_changed");
    const amendments = yield* Db.readAmendmentInventory(transaction, scope.bookId);

    const retainedAmendments = saved.basis.ownerPorts.find(
      (port) => port.owner === "vat_draft_amendment",
    );

    if (amendments.length !== retainedAmendments?.recordCount) {
      reasons.push("amendment_membership_changed");
    }

    return [...new Set(reasons)].sort();
  });
}

export const prepareActualReturn = Effect.fn("vat.prepareActualReturn")(function* (
  token: string,
  command: { scope: Scope; idempotencyKey: string; input: Input },
  calculate: ActualVatCalculator = defaultCalculator,
) {
  const payload = yield* toJsonObject(command.input);

  const captured = yield* withBook(token, command.scope, true, function* (transaction, principal) {
    const request = yield* replay(
      transaction,
      command.scope,
      command.idempotencyKey,
      "prepare_actual_vat_return",
      principal.actorId,
      payload,
      ReturnSchema,
    );

    if (request.previous) return { replayed: request.previous, basis: null } as const;
    yield* requireAccess(transaction, false);
    yield* Ledger.lockBookForShare(transaction, command.scope);

    return {
      replayed: null,
      basis: yield* captureBasis(transaction, command.scope, command.input),
    } as const;
  });

  if (captured.replayed !== null) return captured.replayed;

  const basis = captured.basis;

  if (basis === null) return yield* failure("InternalError");

  // The selected calculator runs after capture closes, with no financial lock held.
  const calculation = yield* calculate(basis);
  const dependencies = yield* captureDependencies(basis);

  return yield* withBook(
    token,
    command.scope,
    true,
    function* (transaction, principal) {
      const request = yield* replay(
        transaction,
        command.scope,
        command.idempotencyKey,
        "prepare_actual_vat_return",
        principal.actorId,
        payload,
        ReturnSchema,
      );

      if (request.previous) return request.previous;
      yield* requireAccess(transaction, true);
      yield* Ledger.lockBookForUpdate(transaction, command.scope);
      const current = yield* captureBasis(transaction, command.scope, command.input);

      if ((yield* captureDependencies(current)) !== dependencies) {
        return yield* failure("StaleDependency");
      }

      const counted = yield* Db.countActualReturns(transaction, command.scope.bookId);

      if ((counted[0]?.total ?? 0) >= returnInventoryBound) return yield* unsupported();
      const ordinal = (yield* Db.readNextOrdinal(transaction, command.scope.bookId))[0]?.ordinal;

      if (ordinal === undefined) return yield* failure("InternalError");
      const id = newId("vatactual");
      const recordedAt = yield* isoNow(transaction);

      const body = yield* digestBody(
        yield* toJsonObject({
          id,
          scope: command.scope,
          version: 1,
          input: command.input,
          basis,
          calculation,
          recordedAt,
          receipt: {
            key: command.idempotencyKey,
            operation: "prepare_actual_vat_return",
            actorId: principal.actorId,
          },
          externalState: "not_submitted",
          assessedMinor: null,
          paymentState: "not_paid",
        }),
      );

      const result = yield* decode(ReturnSchema, body);
      const net = calculation.boxes.find((row) => row.box === "49");

      yield* Db.insertReturn(transaction, {
        bookId: command.scope.bookId,
        id,
        ordinal,
        startsOn: result.input.startsOn,
        endsOn: result.input.endsOn,
        basisDigest: basis.digest,
        basisEngine: basis.engine,
        ruleReleaseId: basis.mappingRelease.releaseId,
        ruleReleaseChecksum: basis.mappingRelease.checksum,
        periodFactRevisionId: basis.registeredPeriod.factRevisionId,
        filingReady: calculation.filingReady,
        controlsReconciled: calculation.controlsReconciled,
        coverageComplete: calculation.coverageComplete,
        calculationSupported: calculation.calculationSupported,
        exactNetMinor: net?.exactMinor ?? "0",
        reportedNetMinor: net?.reportedMinor ?? "0",
        residualNetMinor: net?.residualMinor ?? "0",
        ledgerBoundary: basis.ledgerBoundary,
        digest: result.digest,
        body: yield* toJsonObject(result),
        recordedAt,
      });

      yield* Db.insertBoxes(
        transaction,
        calculation.boxes.map((row) => ({
          bookId: command.scope.bookId,
          returnId: id,
          box: row.box,
          kind: row.kind,
          exactMinor: row.exactMinor,
          reportedMinor: row.reportedMinor,
          residualMinor: row.residualMinor,
        })),
      );

      yield* Db.insertContributions(
        transaction,
        calculation.contributions.map((row) => ({
          bookId: command.scope.bookId,
          returnId: id,
          ordinal: row.ordinal,
          factId: row.factId,
          origin: row.origin,
          mappingRuleId: row.mappingRuleId,
          rateId: row.rateId,
          box: row.box,
          signedMinor: row.signedMinor,
          basisMinor: row.basisMinor,
          taxMinor: row.taxMinor,
          revisionId: row.revisionId,
          factDigest: row.digest,
        })),
      );

      yield* Db.insertExclusions(
        transaction,
        calculation.exclusions.map((row) => ({
          bookId: command.scope.bookId,
          returnId: id,
          ordinal: row.ordinal,
          factId: row.factId,
          origin: row.origin,
          revisionId: row.revisionId,
          reason: row.reason,
          detail: row.detail,
        })),
      );

      yield* Db.insertControls(
        transaction,
        calculation.controls.map((row) => ({
          bookId: command.scope.bookId,
          returnId: id,
          accountId: row.accountId,
          role: row.role,
          reviewedOpeningMinor: row.reviewedOpeningMinor,
          expectedClosingMinor: row.expectedClosingMinor,
          frozenGlClosingMinor: row.frozenGlClosingMinor,
          differenceMinor: row.differenceMinor,
          reconciled: row.reconciled,
        })),
      );

      const unresolved: Array<Db.ControlRowWrite> = [];

      for (const control of calculation.controls) {
        [...control.unexplainedRows, ...control.missingRows].forEach((row, index) => {
          unresolved.push({
            bookId: command.scope.bookId,
            returnId: id,
            accountId: control.accountId,
            ordinal: index + 1,
            state: row.state,
            voucherId: row.voucherId,
            lineId: row.lineId,
            postingDate: row.postingDate,
            signedMinor: row.signedMinor,
          });
        });
      }

      yield* Db.insertControlRows(transaction, unresolved);
      yield* Db.insertCoverage(
        transaction,
        calculation.sourceCoverage.map((row) => ({
          bookId: command.scope.bookId,
          returnId: id,
          family: row.family,
          state: row.state,
          evidenceId: row.evidenceId,
          evidenceSha256: row.evidenceSha256,
        })),
      );

      const saved = yield* toJsonObject(result);

      yield* saveCommand(
        transaction,
        command.scope,
        command.idempotencyKey,
        request.expected,
        "prepare_actual_vat_return",
        principal.actorId,
        saved,
      );

      return result;
    },
    "update",
  );
});

export const getActualReturn = Effect.fn("vat.getActualReturn")(function* (
  token: string,
  command: { scope: Scope; id: string },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);
    yield* Ledger.lockBookForShare(transaction, command.scope);
    const row = (yield* Db.readReturn(transaction, command.scope.bookId, command.id))[0];

    if (row === undefined) return yield* failure("NotFound");

    const saved = yield* decode(ReturnSchema, row.body);
    const staleReasons = yield* currentnessReasons(transaction, command.scope, saved);

    return yield* decode(
      ViewSchema,
      yield* toJsonObject({
        saved,
        currentness: {
          basisCurrent: staleReasons.length === 0,
          checkedAt: yield* isoNow(transaction),
          staleReasons,
        },
      }),
    );
  });
});

export const listActualReturns = Effect.fn("vat.listActualReturns")(function* (
  token: string,
  command: { scope: Scope },
) {
  return yield* withBook(token, command.scope, false, function* (transaction) {
    yield* requireAccess(transaction, false);
    yield* Ledger.lockBookForShare(transaction, command.scope);
    const counted = yield* Db.countActualReturns(transaction, command.scope.bookId);

    if ((counted[0]?.total ?? 0) > returnInventoryBound) return yield* unsupported();
    const rows = yield* Db.readReturnInventory(transaction, command.scope.bookId);

    return yield* decode(
      ListSchema,
      yield* toJsonObject({
        items: rows.map((row) => ({
          id: row.id,
          digest: row.digest,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          filingReady: row.filingReady,
          exactNetMinor: row.exactNetMinor,
          reportedNetMinor: row.reportedNetMinor,
          recordedAt: row.recordedAt,
        })),
      }),
    );
  });
});
