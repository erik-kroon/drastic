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

  // Reversals: every line mirrors exactly, including wide amounts and dimensions.
  for (let i = 0; i < 60; i++) {
    const count = 1 + rand(8),
      lines = [];

    let total = 0n;

    for (let j = 0; j < count; j++) {
      const amount = BigInt(1 + rand(1_000_000)) * (i % 10 === 0 ? 10n ** 30n : 1n);

      total += amount;
      lines.push({
        id: `debit-${j}`,
        accountId: `account-${rand(5)}`,
        dimensions: rand(2) ? { project: `p-${rand(3)}` } : {},
        debitMinor: String(amount),
        creditMinor: "0",
      });
    }

    lines.push({
      id: "credit",
      accountId: "account-credit",
      dimensions: {},
      debitMinor: "0",
      creditMinor: String(total),
    });
    cases.push({
      operation: "ledger.reverse.v1",
      input: { currency: "SEK", scale: 2, originalVoucherId: `voucher-${i}`, lines },
    });
  }

  return cases;
}

/** Voucher shapes within the posting owner's scope: 2 to 500 lines with unique ids. */
export function voucherCases() {
  const line = (debitMinor, creditMinor) => ({ debitMinor, creditMinor });

  const cases = [
    [line("100", "0"), line("0", "100")],
    [line("100", "0"), line("0", "99")],
    [line("100", "100"), line("0", "0")],
    [line("0", "0"), line("0", "0")],
    [line("100", "0"), line("0", "100"), line("0", "0")],
    [line("100", "0"), line("100", "0")],
    [line(String(10n ** 37n), "0"), line("0", String(10n ** 37n))],
    [line("1", "0"), line("1", "0"), line("0", "2")],
    [line("1", "0"), line("2", "0"), line("0", "2")],
  ];

  let seed = 90127;

  const rand = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % max;
  };

  for (let i = 0; i < 200; i++) {
    const rows = Array.from({ length: 2 + rand(10) }, () =>
      rand(2) ? line(String(1 + rand(500)), "0") : line("0", String(1 + rand(500))),
    );

    // Balance about half of them on the last line's side so both outcomes occur.
    if (i % 2 === 0) {
      const balance = rows.reduce(
        (sum, row) => sum + BigInt(row.debitMinor) - BigInt(row.creditMinor),
        0n,
      );

      if (balance > 0n) rows.push(line("0", String(balance)));
      else if (balance < 0n) rows.push(line(String(-balance), "0"));
    }

    cases.push(rows);
  }

  return cases.map((rows) => rows.map((row, index) => ({ ...row, id: `line-${index}` })));
}

/** Small complete pools, so both searches finish and must agree on the verdict. */
export function coverCases() {
  const cases = [
    { targetMinor: "100", amounts: ["100"], maxSetSize: 1 },
    { targetMinor: "100", amounts: ["60", "40", "100"], maxSetSize: 2 },
    { targetMinor: "100", amounts: ["60", "40", "70", "30"], maxSetSize: 2 },
    { targetMinor: "100", amounts: ["50", "50", "50"], maxSetSize: 2 },
    { targetMinor: "100", amounts: ["99", "2", "3"], maxSetSize: 3 },
    { targetMinor: "100", amounts: ["10", "20", "30", "40"], maxSetSize: 4 },
    { targetMinor: "7", amounts: ["1", "2", "4"], maxSetSize: 3 },
    { targetMinor: "7", amounts: ["1", "2", "4"], maxSetSize: 2 },
    { targetMinor: "1", amounts: ["2", "3"], maxSetSize: 2 },
  ];

  let seed = 4421;

  const rand = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % max;
  };

  for (let i = 0; i < 150; i++) {
    const amounts = Array.from({ length: 1 + rand(9) }, () => String(1 + rand(20)));

    // Half the targets are a real subset sum, so matches and ambiguity occur often.
    const picked = amounts.filter(() => rand(3) === 0);

    const target =
      i % 2 === 0 && picked.length > 0
        ? picked.reduce((sum, amount) => sum + BigInt(amount), 0n)
        : BigInt(1 + rand(60));

    cases.push({ targetMinor: String(target), amounts, maxSetSize: 1 + rand(4) });
  }

  return cases;
}
