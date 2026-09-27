import {
  array,
  record,
  text,
  integer,
  boolean,
  oneOf,
  money,
  positive,
  currency,
  unique,
  fail,
  VAT_ROUNDING,
  ROUNDING,
} from "./contracts.mjs";
import { calculateVatWithUnit } from "../lib/vat.mjs";
import { mode } from "../lib/money.mjs";
import { allocate, validateVoucher } from "../lib/accounting.mjs";
// Cover search remains on the separate suggestion-only adapter, never the authority import graph.

const boxOrder = ["05", "10", "11", "12", "48"];

const monetaryScope = (x) => {
  currency(x.currency);
  integer(x.scale, "scale", 0, 6);
};

const outMoney = (x, name = "result") => money(x, name, true);

export function validateInput(operation, x) {
  switch (operation) {
    case "money.round.v1": {
      record(x, "rounding", ["numerator", "denominator", "rounding"]);
      money(x.numerator, "numerator", true, 160);
      positive(x.denominator, "denominator", 160);
      oneOf(x.rounding, ROUNDING, "rounding");

      return x;
    }

    case "vat.project.v1": {
      record(x, "VAT", [
        "currency",
        "scale",
        "contributions",
        "reportingUnitMinor",
        "rounding",
        "declareNet",
      ]);
      monetaryScope(x);
      positive(x.reportingUnitMinor, "reportingUnitMinor");
      oneOf(x.rounding, VAT_ROUNDING, "rounding");
      boolean(x.declareNet, "declareNet");
      array(x.contributions, "contributions", 2000);

      for (const row of x.contributions) {
        record(row, "contribution", ["id", "box", "signedMinor", "included"]);
        text(row.id, "contribution.id");
        oneOf(row.box, boxOrder, "box");
        money(row.signedMinor, "signedMinor", true);
        boolean(row.included, "included");
      }

      unique(
        x.contributions.map((row) => row.id),
        "Contribution IDs",
      );

      return x;
    }

    case "schedule.equal.v1": {
      record(x, "schedule", ["currency", "scale", "remainingMinor", "periodIds", "policy"]);
      monetaryScope(x);
      money(x.remainingMinor, "remainingMinor", true);
      oneOf(x.policy, ["equal-magnitude-remainder-last-v1"], "allocation policy");
      array(x.periodIds, "periodIds", 600, 1);
      x.periodIds.forEach((id) => text(id, "period ID"));
      unique(x.periodIds, "Period IDs");

      return x;
    }

    case "settlement.allocate.v1": {
      record(x, "allocation", [
        "currency",
        "scale",
        "amountMinor",
        "sourceRemainingMinor",
        "targetRemainingMinor",
      ]);
      monetaryScope(x);
      positive(x.amountMinor, "amountMinor");
      money(x.sourceRemainingMinor, "sourceRemainingMinor");
      money(x.targetRemainingMinor, "targetRemainingMinor");

      return x;
    }

    case "fx.convert.v1": {
      record(x, "FX", [
        "baseCurrency",
        "quoteCurrency",
        "fromScale",
        "toScale",
        "amountMinor",
        "rateNumerator",
        "rateDenominator",
        "rounding",
        "rateConvention",
      ]);
      currency(x.baseCurrency, "baseCurrency");
      currency(x.quoteCurrency, "quoteCurrency");
      integer(x.fromScale, "fromScale", 0, 6);
      integer(x.toScale, "toScale", 0, 6);
      money(x.amountMinor, "amountMinor", true);
      positive(x.rateNumerator, "rateNumerator");
      positive(x.rateDenominator, "rateDenominator");
      oneOf(x.rounding, ROUNDING, "rounding");
      oneOf(x.rateConvention, ["quote-major-per-base-major-v1"], "rateConvention");

      if (
        x.baseCurrency === x.quoteCurrency &&
        BigInt(x.rateNumerator) !== BigInt(x.rateDenominator)
      )
        fail("InvalidInput", "Same-currency conversion requires a unit rate");

      return x;
    }

    case "ledger.reverse.v1": {
      record(x, "voucher", ["currency", "scale", "originalVoucherId", "lines"]);
      monetaryScope(x);
      text(x.originalVoucherId, "originalVoucherId");
      array(x.lines, "lines", 2000, 2);

      let debits = 0n,
        credits = 0n;

      for (const row of x.lines) {
        record(row, "line", ["id", "accountId", "dimensions", "debitMinor", "creditMinor"]);
        text(row.id, "line ID");
        text(row.accountId, "accountId");
        record(row.dimensions, "dimensions");

        for (const [k, v] of Object.entries(row.dimensions)) {
          text(k, "dimension key", 100);
          text(v, "dimension value");
        }

        const d = money(row.debitMinor),
          c = money(row.creditMinor);

        if ((d === 0n) === (c === 0n))
          fail("InvalidInput", "Each line must have exactly one positive side");
        debits += d;
        credits += c;
      }

      unique(
        x.lines.map((row) => row.id),
        "Line IDs",
      );

      if (debits !== credits) fail("InvalidInput", "Original voucher is not balanced");

      return x;
    }

    case "cover.suggest.v1":
      fail("SuggestionOnly", "Use the isolated suggestion adapter");
    default:
      fail("UnsupportedOperation", `Unknown operation ${operation}`);
  }
}

/** Independently checks the mathematical definition of rounding, not a second quotient algorithm. */
export function checkRounding(n, d, q, r, rounding) {
  if (d <= 0n || q * d + r !== n) fail("InvalidKernelOutput", "Rounding decomposition failed");
  const abs = (v) => (v < 0n ? -v : v);
  let valid = false;

  switch (rounding) {
    case "exact":
      valid = r === 0n;
      break;
    case "floor":
      valid = r >= 0n && r < d;
      break;
    case "ceiling":
      valid = r <= 0n && -r < d;
      break;
    case "toward_zero":
      valid = abs(r) < d && (n >= 0n ? r >= 0n : r <= 0n);
      break;
    case "half_even":
      valid = 2n * abs(r) < d || (2n * abs(r) === d && q % 2n === 0n);
      break;
    case "half_up":
      valid = 2n * abs(r) < d || (2n * abs(r) === d && (n < 0n ? r > 0n : r < 0n));
      break;
  }

  if (!valid)
    fail("InvalidKernelOutput", "Reported value does not satisfy the selected rounding definition");
}

export function verifyOutput(operation, input, result) {
  // Revalidate the request too: callers cannot bypass contracts using this checker.
  const x = validateInput(operation, input);

  switch (operation) {
    case "money.round.v1": {
      record(result, "rounding result", ["roundedMinor", "residualNumerator", "denominator"]);

      const q = outMoney(result.roundedMinor),
        r = money(result.residualNumerator, "residualNumerator", true, 160),
        d = positive(result.denominator, "denominator", 160);

      if (d !== BigInt(x.denominator)) fail("InvalidKernelOutput", "Rounding denominator changed");
      checkRounding(BigInt(x.numerator), d, q, r, x.rounding);

      return result;
    }

    case "vat.project.v1": {
      record(result, "VAT result", ["rows"]);
      array(result.rows, "VAT rows", 6);
      const expected = new Map();

      for (const row of x.contributions)
        if (row.included)
          expected.set(row.box, (expected.get(row.box) ?? 0n) + BigInt(row.signedMinor));
      const wanted = boxOrder.filter((b) => expected.has(b));

      if (x.declareNet) wanted.push("49");

      if (JSON.stringify(result.rows.map((row) => row.box)) !== JSON.stringify(wanted))
        fail("InvalidKernelOutput", "VAT presence or ordering changed");
      const unit = BigInt(x.reportingUnitMinor);

      let exactNet = 0n,
        reportedNet = 0n;

      for (const row of result.rows) {
        record(row, "VAT row", ["box", "kind", "exactMinor", "reportedMinor", "residualMinor"]);

        const exact = outMoney(row.exactMinor),
          reported = outMoney(row.reportedMinor),
          residual = outMoney(row.residualMinor);

        if (row.box === "49") {
          if (
            row.kind !== "net" ||
            exact !== exactNet ||
            reported !== reportedNet ||
            residual !== exact - reported * unit
          )
            fail("InvalidKernelOutput", "Net box must derive from reported primitive boxes");
        } else {
          if (row.kind !== "primitive" || exact !== expected.get(row.box))
            fail("InvalidKernelOutput", "Wrong exact box total");
          checkRounding(exact, unit, reported, residual, x.rounding);
          const sign = row.box === "48" ? -1n : row.box === "05" ? 0n : 1n;
          exactNet += sign * exact;
          reportedNet += sign * reported;
        }
      }

      return result;
    }

    case "schedule.equal.v1": {
      record(result, "schedule result", ["rows"]);
      array(result.rows, "schedule rows", 600, 1);

      if (result.rows.length !== x.periodIds.length)
        fail("InvalidKernelOutput", "Wrong period count");

      const total = BigInt(x.remainingMinor),
        count = BigInt(x.periodIds.length),
        q = total / count,
        r = total % count;

      let sum = 0n;
      result.rows.forEach((row, i) => {
        record(row, "scheduled amount", ["periodId", "amountMinor"]);
        const amount = outMoney(row.amountMinor);

        if (
          row.periodId !== x.periodIds[i] ||
          amount !== q + (i === x.periodIds.length - 1 ? r : 0n)
        )
          fail("InvalidKernelOutput", "Schedule violated its remainder policy or period order");
        sum += amount;
      });

      if (sum !== total) fail("InvalidKernelOutput", "Schedule lost value");

      return result;
    }

    case "settlement.allocate.v1": {
      record(result, "allocation result", ["sourceAfterMinor", "targetAfterMinor"]);

      const amount = BigInt(x.amountMinor),
        source = BigInt(x.sourceRemainingMinor),
        target = BigInt(x.targetRemainingMinor);

      const sa = money(result.sourceAfterMinor),
        ta = money(result.targetAfterMinor);

      if (sa + amount !== source || ta + amount !== target)
        fail("InvalidKernelOutput", "Independent capacity conservation failed");

      return result;
    }

    case "fx.convert.v1": {
      record(result, "FX result", ["convertedMinor", "residualNumerator", "denominator"]);

      const q = outMoney(result.convertedMinor),
        r = money(result.residualNumerator, "residualNumerator", true, 160),
        d = positive(result.denominator, "denominator", 160);

      const expectedD = BigInt(x.rateDenominator) * 10n ** BigInt(x.fromScale),
        n = BigInt(x.amountMinor) * BigInt(x.rateNumerator) * 10n ** BigInt(x.toScale);

      if (d !== expectedD) fail("InvalidKernelOutput", "FX denominator changed");
      checkRounding(n, d, q, r, x.rounding);

      return result;
    }

    case "ledger.reverse.v1": {
      record(result, "reversal result", ["lines"]);
      array(result.lines, "reversal lines", 2000, 2);

      if (result.lines.length !== x.lines.length)
        fail("InvalidKernelOutput", "Reversal changed line count");
      result.lines.forEach((row, i) => {
        record(row, "reversal line", [
          "originalLineId",
          "accountId",
          "dimensions",
          "debitMinor",
          "creditMinor",
        ]);
        const old = x.lines[i];

        if (
          row.originalLineId !== old.id ||
          row.accountId !== old.accountId ||
          JSON.stringify(row.dimensions) !== JSON.stringify(old.dimensions) ||
          row.debitMinor !== old.creditMinor ||
          row.creditMinor !== old.debitMinor
        )
          fail(
            "InvalidKernelOutput",
            "Reversal changed historical content instead of swapping sides",
          );
      });

      return result;
    }

    case "cover.suggest.v1": {
      // solveCover has its own exhaustive input/output witness validator. Never
      // turn an untrusted external result into a uniqueness certificate here.
      if (result?.mayExecute !== false || result?.requiresRevalidation !== true)
        fail("InvalidKernelOutput", "Suggestions cannot carry execution authority");
      oneOf(
        result.status,
        ["unique-within-scope", "ambiguous", "no-match-within-scope", "incomplete", "unavailable"],
        "solver status",
      );

      return result;
    }
  }
}

export function runOperation(engine, operation, input) {
  const x = validateInput(operation, input);

  if (!engine) fail("KernelUnavailable", "No selected Bend execution backend");
  let result;

  switch (operation) {
    case "money.round.v1": {
      const r = engine.call(
        "Rational.round",
        engine.integer(BigInt(x.numerator)),
        engine.nat(BigInt(x.denominator)),
        mode(engine, x.rounding),
      );

      if (r.k !== "Rational.Rounded") fail("CalculationRefused", `Rounding refused: ${r.k}`);
      result = {
        roundedMinor: engine.fromInteger(r.x[0]).toString(),
        residualNumerator: engine.fromInteger(r.x[1]).toString(),
        denominator: x.denominator,
      };
      break;
    }

    case "vat.project.v1":
      result = { rows: calculateVatWithUnit(engine, x) };
      break;
    case "schedule.equal.v1": {
      const r = engine.call(
        "Schedule.equal",
        engine.integer(BigInt(x.remainingMinor)),
        engine.count(x.periodIds.length),
      );

      if (r.k !== "Schedule.Scheduled") fail("CalculationRefused", "Schedule calculation refused");
      const rows = [];
      let tail = r.x[0];

      for (let i = 0; ; i++) {
        const row = engine.force(tail);

        if (row.k === "Schedule.NoAmounts") break;

        if (i >= x.periodIds.length || row.k !== "Schedule.Amount")
          fail("InvalidKernelOutput", "Malformed schedule");
        rows.push({
          periodId: x.periodIds[i],
          amountMinor: engine.fromInteger(row.x[0]).toString(),
        });
        tail = row.x[1];
      }

      result = { rows };
      break;
    }

    case "settlement.allocate.v1": {
      const r = allocate(engine, x);

      if (r.status !== "allocated-arithmetic") fail("CalculationRefused", r.status);
      result = { sourceAfterMinor: r.sourceAfterMinor, targetAfterMinor: r.targetAfterMinor };
      break;
    }

    case "fx.convert.v1": {
      const r = engine.call(
        "Fx.convert",
        engine.integer(BigInt(x.amountMinor)),
        engine.nat(BigInt(x.rateNumerator)),
        engine.nat(BigInt(x.rateDenominator)),
        engine.count(x.fromScale),
        engine.count(x.toScale),
        mode(engine, x.rounding),
      );

      if (r.k !== "Rational.Rounded") fail("CalculationRefused", `FX conversion refused: ${r.k}`);
      result = {
        convertedMinor: engine.fromInteger(r.x[0]).toString(),
        residualNumerator: engine.fromInteger(r.x[1]).toString(),
        denominator: engine.fromNat(r.x[2]).toString(),
      };
      break;
    }

    case "ledger.reverse.v1": {
      if (!validateVoucher(engine, x.lines).accepted)
        fail("CalculationRefused", "Bend refused the original voucher");
      let lines = engine.c("Ledger.End");

      for (const row of x.lines.toReversed())
        lines = engine.c(
          "Ledger.Line",
          engine.nat(BigInt(row.debitMinor)),
          engine.nat(BigInt(row.creditMinor)),
          lines,
        );
      let tail = engine.call("Ledger.reverse", lines);
      const rows = [];

      for (let i = 0; ; i++) {
        const row = engine.force(tail);

        if (row.k === "Ledger.End") break;

        if (i >= x.lines.length || row.k !== "Ledger.Line")
          fail("InvalidKernelOutput", "Malformed reversal");
        rows.push({
          originalLineId: x.lines[i].id,
          accountId: x.lines[i].accountId,
          dimensions: x.lines[i].dimensions,
          debitMinor: engine.fromNat(row.x[0]).toString(),
          creditMinor: engine.fromNat(row.x[1]).toString(),
        });
        tail = row.x[2];
      }

      result = { lines: rows };
      break;
    }

    case "cover.suggest.v1":
      fail("SuggestionOnly", "Use the isolated suggestion adapter");
  }

  return verifyOutput(operation, x, result);
}
