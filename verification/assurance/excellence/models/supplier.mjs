/** Independent test specification. Never import production code here.
 * Synthetic single-line domestic purchase, quarter-rate source VAT,
 * full or half deduction. Not legal eligibility or a second application ledger.
 */
export class ModelRefusal extends Error {
  constructor(code) {
    super(code);
    this.name = "ModelRefusal";
    this.code = code;
  }
}

const refuse = (code) => {
  throw new ModelRefusal(code);
};

const rounded = (n, d) => {
  if (n < 0n || d <= 0n) refuse("InvalidRatio");

  const q = n / d,
    r = n % d;

  return q + BigInt(r * 2n >= d);
};

function rows(values) {
  return Object.entries(values)
    .filter(([, v]) => v !== 0n)
    .map(([accountId, signedMinor]) => ({ accountId, signedMinor: String(signedMinor) }))
    .sort((a, b) => a.accountId.localeCompare(b.accountId));
}

export function createModel({ netMinor = "100000", deductionDenominator = "1" } = {}) {
  const N = BigInt(netMinor),
    denominator = BigInt(deductionDenominator);

  if (N <= 0n || N % 4n || ![1n, 2n].includes(denominator)) refuse("UnsupportedFixture");

  const T = N / 4n,
    D = rounded(T, denominator);

  return {
    N,
    T,
    D,
    G: N + T,
    creditNet: 0n,
    creditTax: 0n,
    releasedDeduction: 0n,
    paid: 0n,
    refunded: 0n,
    ids: [],
    effects: [],
    recognized: false,
  };
}

export function position(s) {
  const difference = s.G - s.creditNet - s.creditTax - s.paid;

  return {
    gross: String(s.G),
    credited: String(s.creditNet + s.creditTax),
    paid: String(s.paid),
    refunded: String(s.refunded),
    unpaid: String(difference > 0n ? difference : 0n),
    refundPrincipal: String(difference < 0n ? -difference : 0n),
    refundDue: String((difference < 0n ? -difference : 0n) - s.refunded),
  };
}

export function advance(s, event) {
  if (s.ids.includes(event.id)) refuse("DuplicateEconomicIdentity");
  let next = { ...s, ids: [...s.ids, event.id], effects: [...s.effects] };
  let delta;

  if (event.kind === "recognize") {
    if (s.recognized) refuse("AlreadyRecognized");
    next.recognized = true;
    delta = rows({
      account_expense: s.N + s.T - s.D,
      account_input_vat: s.D,
      account_payable: -s.G,
    });
  } else {
    if (!s.recognized) refuse("Unrecognized");
    const p = position(s);

    if (event.kind === "pay") {
      const x = BigInt(event.amountMinor);

      if (x <= 0n || x > BigInt(p.unpaid)) refuse("PaymentCapacity");
      next.paid += x;
      delta = rows({ account_payable: x, account_bank: -x });
    } else if (event.kind === "credit") {
      const n = BigInt(event.netMinor);

      if (n <= 0n || n % 4n || s.creditNet + n > s.N) refuse("CreditCapacity");

      const tax = n / 4n,
        release = rounded(s.D * (s.creditTax + tax), s.T) - s.releasedDeduction;

      const g = n + tax,
        ap = g < BigInt(p.unpaid) ? g : BigInt(p.unpaid);

      next.creditNet += n;
      next.creditTax += tax;
      next.releasedDeduction += release;
      delta = rows({
        account_expense: -(n + tax - release),
        account_input_vat: -release,
        account_payable: ap,
        account_refund_receivable: g - ap,
      });
    } else if (event.kind === "refund") {
      const x = BigInt(event.amountMinor);

      if (x <= 0n || x > BigInt(p.refundDue)) refuse("RefundCapacity");
      next.refunded += x;
      delta = rows({ account_bank: x, account_refund_receivable: -x });
    } else refuse("UnknownEvent");
  }

  if (delta.reduce((v, r) => v + BigInt(r.signedMinor), 0n) !== 0n)
    throw Error("Independent model unbalanced");
  next.effects.push({ id: event.id, kind: event.kind, rows: delta });

  return next;
}

export function balances(s) {
  const p = position(s);

  return Object.fromEntries(
    Object.entries({
      account_bank: s.refunded - s.paid,
      account_expense: s.N + s.T - s.D - s.creditNet - s.creditTax + s.releasedDeduction,
      account_input_vat: s.D - s.releasedDeduction,
      account_payable: -BigInt(p.unpaid),
      account_refund_receivable: BigInt(p.refundDue),
    }).map(([k, v]) => [k, String(v)]),
  );
}

export function generator(seed) {
  let x = seed >>> 0;

  if (x === 0) x = 0x6d2b79f5;

  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;

    return x >>> 0;
  };
}

export function generateHistory(
  seed,
  { netMinor = "100000", deductionDenominator = "1", maxEvents = 14 } = {},
) {
  if (
    !Number.isSafeInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    maxEvents < 6 ||
    maxEvents > 100
  )
    refuse("InvalidSeedOrBudget");
  const rnd = generator(seed);
  const specification = { netMinor, deductionDenominator };
  let s = createModel(specification);
  const events = [];

  function add(event) {
    events.push(event);
    s = advance(s, event);
  }

  add({ kind: "recognize", id: "source-purchase" });
  // Prime a real paid position so every subsequent credit uses the supported paid-credit owner.
  add({ kind: "pay", id: "payment-1", amountMinor: String((s.G * BigInt(6 + (rnd() % 3))) / 10n) });

  for (let step = 2; step < maxEvents - 3; step++) {
    const p = position(s);
    const remaining = s.N - s.creditNet;

    if (BigInt(p.refundDue) > 0n && rnd() % 2 === 0) {
      const due = BigInt(p.refundDue),
        x = due / 2n || due;

      add({ kind: "refund", id: `refund-${step}`, amountMinor: String(x) });
    } else if (remaining > 0n) {
      const units = remaining / 4n;
      const parts = BigInt(2 + (rnd() % 4));
      const n = (units / parts || units) * 4n;
      add({ kind: "credit", id: `credit-${step}`, netMinor: String(n) });
    } else break;
  }

  if (s.creditNet < s.N)
    add({ kind: "credit", id: "credit-final", netMinor: String(s.N - s.creditNet) });

  if (BigInt(position(s).refundDue) > 0n)
    add({ kind: "refund", id: "refund-final", amountMinor: position(s).refundDue });

  return { schema: "assurance-supplier-history/v1", seed, specification, events };
}

export function replayModel(trace) {
  let state = createModel(trace.specification);

  for (const e of trace.events) state = advance(state, e);

  return state;
}

/** Returns valid candidate removals. The application runner must replay in a FRESH book.
 * Invalid histories never count as a reproduction and do not become a green retry.
 */
export function shrinkCandidates(trace) {
  const out = [];

  for (
    let size = Math.max(1, Math.floor((trace.events.length - 1) / 2));
    size >= 1;
    size = Math.floor(size / 2)
  ) {
    for (let start = 1; start < trace.events.length; start += size) {
      const candidate = {
        ...trace,
        events: trace.events.filter((_, i) => i < start || i >= start + size),
      };

      try {
        replayModel(candidate);
        out.push(candidate);
      } catch (error) {
        if (!(error instanceof ModelRefusal)) throw error;
      }
    }

    if (size === 1) break;
  }

  return out;
}

/** Compare full journal component multisets. Aggregate balance equality is insufficient. */
export function canonicalRows(input) {
  return input
    .map((r) => ({ accountId: r.accountId, signedMinor: String(r.signedMinor) }))
    .sort(
      (a, b) =>
        a.accountId.localeCompare(b.accountId) || a.signedMinor.localeCompare(b.signedMinor),
    );
}

export function assertExactRows(actual, expected) {
  if (JSON.stringify(canonicalRows(actual)) !== JSON.stringify(canonicalRows(expected)))
    throw Error("JournalFootprintMismatch");
}
