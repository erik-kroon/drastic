import type { AuthorityService, VatInput, Calculation } from "../src/index.mjs";

declare const service: AuthorityService;

const vat: VatInput = {
  currency: "SEK",
  scale: 2,
  reportingUnitMinor: "100",
  rounding: "half_even",
  declareNet: false,
  contributions: [],
};

const rows = service.calculate("vat.project.v1", vat).rows;

const amount: string | undefined = rows[0]?.exactMinor;

void amount;

// @ts-expect-error Monetary numbers are forbidden by the public API.
service.calculate("money.round.v1", { numerator: 100, denominator: "1", rounding: "floor" });

// @ts-expect-error The solver is not an authoritative operation.
service.calculate("cover.suggest.v1", {});

const wrong: VatInput = {
  currency: "SEK",
  scale: 2,
  // @ts-expect-error An overloaded old scale field is not the explicit divisor.
  filingUnitScale: 2,
  rounding: "floor",
  declareNet: true,
  contributions: [],
};

void wrong;

declare const result: Calculation<"vat.project.v1">;

const noExecution: false = result.mayExecute;

void noExecution;
