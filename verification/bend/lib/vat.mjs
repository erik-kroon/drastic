import { minor, mode } from "./money.mjs";

export const boxes = Object.freeze({
  "05": "Basis05",
  10: "Output10",
  11: "Output11",
  12: "Output12",
  48: "Input48",
  49: "Net49",
});

const reverse = Object.fromEntries(Object.entries(boxes).map(([k, v]) => [`Vat.${v}`, k]));

export function calculateVat(engine, input) {
  if (
    !Number.isInteger(input.filingUnitScale) ||
    input.filingUnitScale < 0 ||
    input.filingUnitScale > 6
  )
    throw new RangeError("Invalid historical filing unit exponent");

  return calculateVatWithUnit(engine, {
    ...input,
    reportingUnitMinor: String(10n ** BigInt(input.filingUnitScale)),
  });
}

/** The new port takes the EXACT divisor in book minor units. Never infer it from an ambiguously named scale. */
export function calculateVatWithUnit(
  engine,
  { contributions, reportingUnitMinor, rounding, declareNet },
) {
  if (!Array.isArray(contributions) || contributions.length > 2000)
    throw new RangeError("Maximum 2000 contributions");
  const unit = minor(reportingUnitMinor);

  if (unit <= 0n) throw new RangeError("Positive reporting unit required");

  if (!["half_up", "half_even", "toward_zero", "floor"].includes(rounding))
    throw new TypeError("Unsupported OpenERP VAT rounding mode");

  if (typeof declareNet !== "boolean") throw new TypeError("declareNet must be explicit");
  let xs = engine.c("Vat.NoContributions");

  for (const row of contributions.toReversed()) {
    if (!Object.hasOwn(boxes, row.box) || row.box === "49")
      throw new TypeError("A primitive box is required");

    if (typeof row.included !== "boolean")
      throw new TypeError("Every inclusion decision must be explicit");
    xs = engine.c(
      "Vat.Contribution",
      engine.c(`Vat.${boxes[row.box]}`),
      engine.integer(minor(row.signedMinor, { signed: true })),
      engine.flag(row.included),
      xs,
    );
  }

  const result = engine.call(
    "Vat.calculate",
    xs,
    engine.nat(unit),
    mode(engine, rounding),
    engine.flag(declareNet),
  );

  if (result.k !== "Vat.Calculated") throw new Error(`VAT arithmetic refused: ${result.k}`);
  const rows = [];
  let tail = result.x[0];

  for (;;) {
    const row = engine.force(tail);

    if (row.k === "Vat.NoRows") break;

    if (rows.length >= 6) throw new Error("Too many VAT result rows");

    if (row.k !== "Vat.Row") throw new Error("Malformed VAT result");
    const box = reverse[engine.force(row.x[0]).k];
    rows.push({
      box,
      kind: box === "49" ? "net" : "primitive",
      exactMinor: engine.fromInteger(row.x[1]).toString(),
      reportedMinor: engine.fromInteger(row.x[2]).toString(),
      residualMinor: engine.fromInteger(row.x[3]).toString(),
    });
    tail = row.x[4];
  }

  return rows;
}
