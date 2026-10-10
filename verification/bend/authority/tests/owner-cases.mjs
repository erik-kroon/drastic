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

  // FX: ties, scale changes in both directions and wide rates, within the owner's nonnegative half-up scope.
  for (const [amountMinor, rateNumerator, rateDenominator, fromScale, toScale] of [
    ["0", "1", "1", 2, 2],
    ["5", "1", "10", 0, 0],
    ["15", "1", "10", 0, 0],
    ["25", "1", "10", 0, 0],
    ["1", "1", "2", 0, 0],
    ["3", "1", "2", 0, 0],
    ["12345", "1", "1", 2, 0],
    ["12350", "1", "1", 2, 0],
    ["1", "1", "1", 0, 6],
    ["999999", "1", "1", 6, 0],
    ["100", "1093", "100", 2, 2],
    ["100", "100", "1093", 2, 2],
    ["1", "7", "3", 3, 2],
    [String(10n ** 30n), "3", "7", 2, 2],
  ])
    cases.push({
      operation: "fx.convert.v1",
      input: {
        baseCurrency: "EUR",
        quoteCurrency: "SEK",
        fromScale,
        toScale,
        amountMinor,
        rateNumerator,
        rateDenominator,
        rounding: "half_up",
        rateConvention: "quote-major-per-base-major-v1",
      },
    });

  for (let i = 0; i < 250; i++)
    cases.push({
      operation: "fx.convert.v1",
      input: {
        baseCurrency: "EUR",
        quoteCurrency: "SEK",
        fromScale: rand(7),
        toScale: rand(7),
        amountMinor: String(rand(10_000_000)),
        rateNumerator: String(1 + rand(2_000_000)),
        rateDenominator: String(1 + rand(1_000_000)),
        rounding: "half_up",
        rateConvention: "quote-major-per-base-major-v1",
      },
    });

  // Equal schedules: the remainder goes last, including amounts smaller than the period count.
  for (const [remainingMinor, periods] of [
    ["1", 1],
    ["1", 12],
    ["11", 12],
    ["12", 12],
    ["13", 12],
    ["100000", 3],
    ["99999", 36],
    [String(10n ** 37n), 7],
  ])
    cases.push({
      operation: "schedule.equal.v1",
      input: {
        currency: "SEK",
        scale: 2,
        remainingMinor,
        periodIds: Array.from({ length: periods }, (_, j) => `period-${j + 1}`),
        policy: "equal-magnitude-remainder-last-v1",
      },
    });

  for (let i = 0; i < 150; i++)
    cases.push({
      operation: "schedule.equal.v1",
      input: {
        currency: "SEK",
        scale: 2,
        remainingMinor: String(1 + rand(5_000_000)),
        periodIds: Array.from({ length: 1 + rand(60) }, (_, j) => `period-${j + 1}`),
        policy: "equal-magnitude-remainder-last-v1",
      },
    });

  return cases;
}
