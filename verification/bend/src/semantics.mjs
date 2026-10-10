/** Versioned choices, not statutory policy. Changing any value requires a new operation or semantics ID. */
export const SEMANTICS = Object.freeze({
  "money.round.v1": "signed-rational-round-output38-input160-v1",
  "vat.project.v1": "qualified-contributions-explicit-minor-unit-primitive-net-v1",
  "schedule.equal.v1": "signed-equal-magnitude-remainder-last-v1",
  "settlement.allocate.v1": "positive-same-currency-dual-capacity-v1",
  "fx.convert.v1": "quote-major-per-base-major-explicit-scales-v1",
  "ledger.reverse.v1": "ordered-original-line-opposite-sides-v1",
});

export const AUTHORITY_OPERATIONS = Object.freeze(Object.keys(SEMANTICS));
