/** Deterministic vectors for real-owner adapters. No tax rates or treatments are activated. */
export function ownerCases() {
  const cases = [],
    modes = ["half_up", "half_even", "toward_zero", "floor"];

  for (const rounding of modes)
    for (const denominator of [1n, 2n, 3n, 10n, 100n, 1000000n]) {
      for (const numerator of [
        -999n,
        -300n,
        -250n,
        -200n,
        -100n,
        -1n,
        0n,
        1n,
        100n,
        150n,
        250n,
        999n,
        10n ** 37n,
        -(10n ** 37n),
      ]) {
        cases.push({
          operation: "money.round.v1",
          input: { numerator: String(numerator), denominator: String(denominator), rounding },
        });
      }
    }

  let seed = 17833;

  const rand = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % max;
  };

  for (let i = 0; i < 250; i++) {
    const scale = i % 7,
      exponent = i % (scale + 1);

    cases.push({
      operation: "vat.project.v1",
      input: {
        currency: "SEK",
        scale,
        reportingUnitMinor: String(10n ** BigInt(exponent)),
        rounding: modes[i % modes.length],
        declareNet: i % 3 !== 0,
        contributions: Array.from({ length: rand(16) }, (_, j) => ({
          id: `contribution-${j}`,
          box: ["05", "10", "11", "12", "48"][rand(5)],
          signedMinor: String(rand(200001) - 100000),
          included: rand(4) !== 0,
        })),
      },
    });
  }

  cases.push({
    operation: "vat.project.v1",
    input: {
      currency: "SEK",
      scale: 2,
      reportingUnitMinor: "100",
      rounding: "toward_zero",
      declareNet: true,
      contributions: [
        { id: "a", box: "10", signedMinor: "199", included: true },
        { id: "b", box: "48", signedMinor: "101", included: true },
      ],
    },
  });

  return cases;
}
