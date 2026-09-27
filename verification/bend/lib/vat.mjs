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
  const { contributions, currencyScale, filingUnitScale, rounding } = input;

  if (!Array.isArray(contributions) || contributions.length > 2000)
    throw new RangeError("Maximum 2000 contributions");

  if (!Number.isInteger(filingUnitScale) || filingUnitScale < 0 || filingUnitScale > 6)
    throw new RangeError("Invalid filing unit scale");

  if (!Number.isInteger(currencyScale) || currencyScale < 0 || currencyScale > 6)
    throw new RangeError("Invalid currency scale");

  if (filingUnitScale > currencyScale)
    throw new RangeError("Filing unit is finer than the book currency");

  if (!["half_up", "half_even", "toward_zero", "floor"].includes(rounding))
    throw new TypeError("Unsupported OpenERP VAT rounding mode");

  if (typeof input.declareNet !== "boolean") throw new TypeError("declareNet must be explicit");
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
    engine.nat(10n ** BigInt(currencyScale - filingUnitScale)),
    mode(engine, rounding),
    engine.flag(input.declareNet),
  );

  if (result.k !== "Vat.Calculated") throw new Error(`VAT arithmetic refused: ${result.k}`);
  const rows = [];
  let tail = result.x[0];

  for (;;) {
    const row = engine.force(tail);

    if (row.k === "Vat.NoRows") break;

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
