import * as Schema from "effect/Schema";

export const PaymentIdentifierInput = Schema.Struct({
  kind: Schema.Literals(["bankgiro", "plusgiro", "ocr", "check_digit", "generate_ocr"]),
  value: Schema.String.check(Schema.isMaxLength(200)),
});

export const PaymentIdentifierResult = Schema.Struct({
  kind: PaymentIdentifierInput.fields.kind,
  input: Schema.String,
  normalized: Schema.String,
  status: Schema.Literals(["valid", "invalid", "generated", "unsupported"]),
  output: Schema.String,
  accountVerified: Schema.Literal(false),
  paymentAuthorized: Schema.Literal(false),
});

export function mod10CheckDigit(digits: string): string | null {
  if (!/^[0-9]+$/.test(digits)) return null;

  let sum = 0;
  let weight = 2;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const product = (digits.charCodeAt(index) - 48) * weight;
    sum += product > 9 ? product - 9 : product;
    weight = weight === 2 ? 1 : 2;
  }

  return String((10 - (sum % 10)) % 10);
}

export function validateMod10(digits: string) {
  return digits.length >= 2 && mod10CheckDigit(digits.slice(0, -1)) === digits.at(-1);
}

export function checkPaymentIdentifier(
  input: typeof PaymentIdentifierInput.Type,
): typeof PaymentIdentifierResult.Type {
  // Validation removes only presentation separators. OCR generation is a
  // separate explicit operation whose source identifier may contain letters.
  const digits =
    input.kind === "generate_ocr"
      ? input.value.replaceAll(/[^0-9]/g, "")
      : input.value.replaceAll(/[\s-]/g, "");

  const result = {
    kind: input.kind,
    input: input.value,
    normalized: digits,
    accountVerified: false as const,
    paymentAuthorized: false as const,
  };

  if (input.kind === "check_digit") {
    const digit = mod10CheckDigit(input.value);

    return {
      ...result,
      status: digit === null ? "unsupported" : "generated",
      output: digit ?? input.value,
    };
  }

  if (input.kind === "generate_ocr") {
    const digit = digits.length >= 1 && digits.length <= 24 ? mod10CheckDigit(digits) : null;

    return {
      ...result,
      status: digit === null ? "unsupported" : "generated",
      output: digit === null ? input.value : `${digits}${digit}`,
    };
  }

  const minimum = input.kind === "bankgiro" ? 7 : 2;
  const maximum = input.kind === "ocr" ? 25 : 8;
  const compact = input.value.replaceAll(/\s/g, "");

  const separatorsValid =
    input.kind === "bankgiro"
      ? /^(?:[0-9]+|[0-9]{3,4}-[0-9]{4})$/.test(compact)
      : input.kind === "plusgiro"
        ? /^(?:[0-9]+|[0-9]{1,7}-[0-9])$/.test(compact)
        : /^[0-9]+$/.test(compact);

  const valid =
    separatorsValid &&
    digits.length >= minimum &&
    digits.length <= maximum &&
    validateMod10(digits);

  if (!valid) return { ...result, status: "invalid", output: input.value };

  const output =
    input.kind === "bankgiro"
      ? `${digits.slice(0, -4)}-${digits.slice(-4)}`
      : input.kind === "plusgiro"
        ? `${digits.slice(0, -1)}-${digits.slice(-1)}`
        : digits;

  return { ...result, status: "valid", output };
}

export const BankAccountHintInput = Schema.Struct({
  profile: Schema.Literal("reference_r2_v1"),
  clearing: Schema.String.check(Schema.isMaxLength(20)),
  account: Schema.String.check(Schema.isMaxLength(20)),
});

const BankAccountRule = Schema.Literals([
  "mod11_last10",
  "mod11_full",
  "mod11_9",
  "mod10_10",
  "account_clearing_mod10",
]);

export const BankAccountHint = Schema.Struct({
  profile: BankAccountHintInput.fields.profile,
  clearing: Schema.String,
  account: Schema.String,
  normalizedClearing: Schema.String,
  normalizedAccount: Schema.String,
  rule: Schema.NullOr(BankAccountRule),
  status: Schema.Literals(["valid", "invalid", "unknown"]),
  reason: Schema.Literals([
    "unmapped_clearing",
    "unusable_input",
    "unsupported_length",
    "checksum_passed",
    "checksum_failed",
  ]),
  accountVerified: Schema.Literal(false),
  paymentAuthorized: Schema.Literal(false),
  nonBlocking: Schema.Literal(true),
});

const lastTenRanges = [
  { from: "1100", to: "1399" },
  { from: "1400", to: "2099" },
  { from: "2400", to: "2499" },
  { from: "3000", to: "3299" },
  { from: "3410", to: "3999" },
  { from: "5000", to: "5999" },
  { from: "7000", to: "7999" },
  { from: "9400", to: "9449" },
];

function clearingRule(clearing: string): typeof BankAccountRule.Type | null {
  // These are the retained R2 reference ranges, not a live bank catalogue.
  // Exact exceptions must win before the surrounding range is considered.
  if (clearing === "3300" || clearing === "3782") return "mod10_10";

  if (lastTenRanges.some((range) => clearing >= range.from && clearing <= range.to))
    return "mod11_last10";

  if (clearing >= "4000" && clearing <= "4999") return "mod11_full";

  if (clearing >= "6000" && clearing <= "6999") return "mod11_9";

  if (clearing >= "8000" && clearing <= "8999") return "account_clearing_mod10";

  return null;
}

function validateMod11(digits: string) {
  if (!/^[0-9]{1,11}$/.test(digits)) return false;
  let sum = 0;
  const offset = 11 - digits.length;

  for (let index = 0; index < digits.length; index += 1) {
    const position = offset + index;
    const weight = position === 0 ? 1 : 11 - position;
    sum += (digits.charCodeAt(index) - 48) * weight;
  }

  return sum !== 0 && sum % 11 === 0;
}

export function checkBankAccountHint(
  input: typeof BankAccountHintInput.Type,
): typeof BankAccountHint.Type {
  const clearing = input.clearing.replaceAll(/\s/g, "");
  const account = input.account.replaceAll(/\s/g, "");
  const clearingUsable = /^[0-9]{4,5}$/.test(clearing);
  const rule = clearingUsable ? clearingRule(clearing.slice(0, 4)) : null;

  const result = {
    profile: input.profile,
    clearing: input.clearing,
    account: input.account,
    normalizedClearing: clearing,
    normalizedAccount: account,
    rule,
    accountVerified: false as const,
    paymentAuthorized: false as const,
    nonBlocking: true as const,
  };

  if (rule === null)
    return {
      ...result,
      status: "unknown",
      reason: clearingUsable ? "unmapped_clearing" : "unusable_input",
    };

  if (!/^[0-9]+$/.test(account)) return { ...result, status: "unknown", reason: "unusable_input" };

  if (clearing.length === 5 && rule !== "account_clearing_mod10")
    return { ...result, status: "unknown", reason: "unsupported_length" };

  let valid: boolean;

  if (rule === "mod11_last10" || rule === "mod11_full") {
    if (account.length > 7) return { ...result, status: "unknown", reason: "unsupported_length" };
    const full = clearing + account.padStart(7, "0");
    valid = validateMod11(rule === "mod11_last10" ? full.slice(-10) : full);
  } else if (rule === "mod10_10") {
    if (account.length > 10) return { ...result, status: "unknown", reason: "unsupported_length" };
    valid = validateMod10(account.padStart(10, "0"));
  } else if (rule === "mod11_9") {
    if (account.length > 9) return { ...result, status: "unknown", reason: "unsupported_length" };
    valid = validateMod11(account.padStart(9, "0"));
  } else {
    if (account.length < 6 || account.length > 10)
      return { ...result, status: "unknown", reason: "unsupported_length" };
    valid = validateMod10(account) && (clearing.length === 4 || validateMod10(clearing));
  }

  return {
    ...result,
    status: valid ? "valid" : "invalid",
    reason: valid ? "checksum_passed" : "checksum_failed",
  };
}
