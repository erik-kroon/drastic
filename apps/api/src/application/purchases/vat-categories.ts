import * as Recognition from "@open-erp/contracts/supplier-recognition";
import * as Profiles from "@open-erp/contracts/company-profiles";
import * as Vat from "@open-erp/contracts/vat-returns";
import * as Effect from "effect/Effect";
import { resolvePurchaseCategory } from "@open-erp/jurisdiction-se/vat-purchase-categories";
import * as Releases from "../../db/company-profiles";
import * as Facts from "../../db/vat/returns";
import type { Transaction } from "../../db/transaction";
import * as Shared from "./shared";
import { failure } from "../failures";

export const requireCapturedPurchaseCategories = Effect.fn("purchases.requireCapturedCategories")(
  function* (
    transaction: Transaction,
    bookId: string,
    treatments: ReadonlyArray<typeof Recognition.ReviewedTreatment.Type>,
  ) {
    for (const treatment of treatments) {
      const resolution = treatment.categoryResolution;

      if (resolution === undefined) continue;

      for (const support of resolution.supportFacts) {
        const retained = (yield* Facts.readIndependentFactRevision(
          transaction,
          bookId,
          support.revisionId,
        ))[0];

        if (!retained) return yield* failure("StaleDependency");
        const fact = yield* Shared.decode(Vat.VatFact, retained.body);
        const withdrawn = yield* Facts.readFactWithdrawal(transaction, bookId, fact.factId);
        const current = (yield* Facts.readCurrentFactRevision(transaction, bookId, fact.factId))[0];

        if (fact.digest !== support.digest || current?.id !== fact.id || withdrawn.length !== 0)
          return yield* failure("StaleDependency");
      }
    }
  },
);

function supportsWholeSource(
  fact: typeof Vat.VatFact.Type,
  input: { sourceEvidenceId: string; taxPointOn: string; netMinor: string; taxMinor: string },
) {
  const basis = fact.input;

  return (
    fact.cashMethodRecognition === undefined &&
    fact.cashMethodCredit === undefined &&
    basis.recordClass === "actual_company" &&
    basis.voucherId === null &&
    basis.expenseLink === null &&
    basis.taxLineIds.length === 0 &&
    basis.evidenceId === input.sourceEvidenceId &&
    basis.taxPointOn === input.taxPointOn &&
    basis.currency === "SEK" &&
    basis.netMinor === input.netMinor &&
    basis.vatMinor === input.taxMinor &&
    basis.grossMinor === (BigInt(input.netMinor) + BigInt(input.taxMinor)).toString() &&
    basis.treatment === "domestic_purchase" &&
    basis.domesticEligibility === "confirmed" &&
    basis.fullDeduction === "confirmed" &&
    basis.treatmentEvidenceId !== null &&
    basis.deductionEvidenceId !== null &&
    basis.method === "accrual" &&
    basis.registration === "registered"
  );
}

export const resolveSelectedPurchaseCategory = Effect.fn("purchases.resolveSelectedCategory")(
  function* (
    transaction: Transaction,
    input: {
      bookId: string;
      sourceEvidenceId: string;
      taxPointOn: string;
      lineCount: number;
      netMinor: string;
      taxMinor: string;
      treatment: typeof Recognition.ReviewedTreatment.Type;
      witness: unknown;
    },
  ) {
    const treatment = input.treatment;

    if (treatment.categoryResolution !== undefined) return yield* Shared.unsupported();

    if (treatment.category === undefined) return treatment;

    if (input.lineCount !== 1) return yield* Shared.unsupported();

    if (!Shared.isJsonObject(input.witness)) return yield* Shared.unsupported();
    const witness = yield* Shared.decode(Profiles.ProfileWitness, input.witness);

    const release = (yield* Releases.readRuleReleases(transaction, "vat")).find(
      (item) => item.id === witness.ruleReleaseId && item.checksum === witness.ruleReleaseChecksum,
    );

    if (!release) return yield* Shared.unsupported();
    const profile = yield* Shared.decode(Profiles.RuleRelease, release.body);

    if (
      profile.vat === undefined ||
      witness.family !== "vat" ||
      witness.selectorDate !== input.taxPointOn
    )
      return yield* Shared.unsupported();
    const resolved = resolvePurchaseCategory(profile.vat, treatment);

    if (resolved === null) return yield* Shared.unsupported();
    const revisionId = treatment.category.supportFactRevisionIds[0];

    if (revisionId === undefined) return yield* Shared.unsupported();

    const retained = (yield* Facts.readIndependentFactRevision(
      transaction,
      input.bookId,
      revisionId,
    ))[0];

    if (!retained) return yield* Shared.unsupported();
    const fact = yield* Shared.decode(Vat.VatFact, retained.body);
    const withdrawn = yield* Facts.readFactWithdrawal(transaction, input.bookId, fact.factId);

    const current = (yield* Facts.readCurrentFactRevision(
      transaction,
      input.bookId,
      fact.factId,
    ))[0];

    if (withdrawn.length !== 0 || current?.id !== fact.id || !supportsWholeSource(fact, input))
      return yield* Shared.unsupported();

    return {
      ...treatment,
      categoryResolution: {
        ...resolved,
        resolverVersion: "swedish_purchase_category_resolver_v1" as const,
        taxPointOn: input.taxPointOn,
        ruleReleaseId: witness.ruleReleaseId,
        ruleReleaseChecksum: witness.ruleReleaseChecksum,
        supportFacts: [{ revisionId: fact.id, digest: fact.digest }],
      },
    };
  },
);
