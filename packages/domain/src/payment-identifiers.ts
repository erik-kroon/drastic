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
