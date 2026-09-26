import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Digest } from "./values";

export const Canonicalization = Schema.Literal("openerp-c14n-v1");

export const CanonicalDocument = Schema.Struct({
  canonicalization: Canonicalization,
  value: Schema.JsonObject,
  version: Schema.Literal(1),
});

export type CanonicalDocument = typeof CanonicalDocument.Type;

export type CanonicalDigest = typeof Digest.Type;

export const CanonicalJsonErrorCode = Schema.Literals([
  "InvalidJson",
  "InvalidUnicode",
  "DuplicateObjectKey",
  "UnsupportedNumber",
  "UnsupportedVersion",
]);

export class CanonicalJsonError extends Schema.TaggedError<CanonicalJsonError>()(
  "CanonicalJsonError",
  {
    code: CanonicalJsonErrorCode,
    message: Schema.String,
  },
) {}

export interface CanonicalJsonBytes {
  readonly bytes: Uint8Array;
  readonly json: string;
}

export interface CanonicalBytes extends CanonicalJsonBytes {
  readonly canonicalization: "openerp-c14n-v1";
  readonly version: 1;
}

export interface SealedCanonicalValue extends CanonicalBytes {
  readonly digest: CanonicalDigest;
}

type JsonNode =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "array"; readonly values: ReadonlyArray<JsonNode> }
  | {
      readonly kind: "object";
      readonly entries: ReadonlyArray<{ readonly key: string; readonly value: JsonNode }>;
    };

const maximumSafeInteger = 9_007_199_254_740_991n;

function encodeUtf8(value: string): Uint8Array {
  const bytes: Array<number> = [];

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);

    if (first < 0x80) {
      bytes.push(first);
      continue;
    }

    if (first < 0x800) {
      bytes.push(0xc0 | (first >> 6), 0x80 | (first & 0x3f));
      continue;
    }

    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);

      if (second < 0xdc00 || second > 0xdfff) {
        fail("InvalidUnicode", "JSON strings must not contain unpaired high surrogates.");
      }

      const codePoint = 0x10000 + ((first - 0xd800) << 10) + (second - 0xdc00);
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
      index += 1;
      continue;
    }

    if (first >= 0xdc00 && first <= 0xdfff) {
      fail("InvalidUnicode", "JSON strings must not contain unpaired low surrogates.");
    }

    bytes.push(0xe0 | (first >> 12), 0x80 | ((first >> 6) & 0x3f), 0x80 | (first & 0x3f));
  }

  return Uint8Array.from(bytes);
}

function fail(code: CanonicalJsonError["code"], message: string): never {
  throw new CanonicalJsonError({ code, message });
}

function invalidJson(message: string): never {
  fail("InvalidJson", message);
}

function requireValidUnicode(value: string): string {
  if (!value.isWellFormed())
    fail("InvalidUnicode", "JSON strings must contain valid Unicode scalar values.");

  return value;
}

class StrictJsonParser {
  readonly #input: string;
  #index = 0;

  constructor(input: string) {
    this.#input = input;
  }

  parse(): JsonNode {
    this.#skipWhitespace();
    const value = this.#parseValue();
    this.#skipWhitespace();

    if (this.#index !== this.#input.length) invalidJson("Unexpected content after the JSON value.");

    return value;
  }

  #skipWhitespace(): void {
    while (this.#index < this.#input.length) {
      const code = this.#input.charCodeAt(this.#index);

      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return;
      this.#index += 1;
    }
  }

  #parseValue(): JsonNode {
    const code = this.#input.charCodeAt(this.#index);

    if (code === 0x7b) return this.#parseObject();

    if (code === 0x5b) return this.#parseArray();

    if (code === 0x22) return { kind: "string", value: this.#parseString() };

    if (code === 0x74) return this.#parseLiteral("true", { kind: "boolean", value: true });

    if (code === 0x66) return this.#parseLiteral("false", { kind: "boolean", value: false });

    if (code === 0x6e) return this.#parseLiteral("null", { kind: "null" });

    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return this.#parseNumber();

    return invalidJson("Expected a JSON value.");
  }

  #parseLiteral<T extends JsonNode>(literal: string, value: T): T {
    if (this.#input.slice(this.#index, this.#index + literal.length) !== literal) {
      invalidJson("Invalid JSON literal.");
    }

    this.#index += literal.length;

    return value;
  }

  #parseObject(): JsonNode {
    this.#index += 1;
    this.#skipWhitespace();
    const entries: Array<{ key: string; value: JsonNode }> = [];
    const keys = new Set<string>();

    if (this.#input.charCodeAt(this.#index) === 0x7d) {
      this.#index += 1;

      return { kind: "object", entries };
    }

    while (true) {
      if (this.#input.charCodeAt(this.#index) !== 0x22) invalidJson("Expected an object key.");
      const key = this.#parseString();

      if (keys.has(key)) fail("DuplicateObjectKey", `Duplicate JSON object key: ${key}.`);
      keys.add(key);
      this.#skipWhitespace();

      if (this.#input.charCodeAt(this.#index) !== 0x3a)
        invalidJson("Expected a colon after an object key.");
      this.#index += 1;
      this.#skipWhitespace();
      entries.push({ key, value: this.#parseValue() });
      this.#skipWhitespace();
      const code = this.#input.charCodeAt(this.#index);

      if (code === 0x7d) {
        this.#index += 1;

        return { kind: "object", entries };
      }

      if (code !== 0x2c) invalidJson("Expected a comma between object members.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #parseArray(): JsonNode {
    this.#index += 1;
    this.#skipWhitespace();
    const values: Array<JsonNode> = [];

    if (this.#input.charCodeAt(this.#index) === 0x5d) {
      this.#index += 1;

      return { kind: "array", values };
    }

    while (true) {
      values.push(this.#parseValue());
      this.#skipWhitespace();
      const code = this.#input.charCodeAt(this.#index);

      if (code === 0x5d) {
        this.#index += 1;

        return { kind: "array", values };
      }

      if (code !== 0x2c) invalidJson("Expected a comma between array values.");
      this.#index += 1;
      this.#skipWhitespace();
    }
  }

  #parseString(): string {
    this.#index += 1;
    let value = "";

    while (this.#index < this.#input.length) {
      const code = this.#input.charCodeAt(this.#index);

      if (code === 0x22) {
        this.#index += 1;

        return requireValidUnicode(value);
      }

      if (code < 0x20) invalidJson("Unescaped control character in a JSON string.");

      if (code === 0x5c) {
        this.#index += 1;
        value += this.#parseEscape();
        continue;
      }

      value += this.#input[this.#index] ?? "";
      this.#index += 1;
    }

    return invalidJson("Unterminated JSON string.");
  }

  #parseEscape(): string {
    const escaped = this.#input[this.#index] ?? "";
    this.#index += 1;

    if (escaped === '"' || escaped === "\\" || escaped === "/") return escaped;

    if (escaped === "b") return "\b";

    if (escaped === "f") return "\f";

    if (escaped === "n") return "\n";

    if (escaped === "r") return "\r";

    if (escaped === "t") return "\t";

    if (escaped !== "u") return invalidJson("Invalid JSON escape.");
    const first = this.#parseHexQuad();

    if (first >= 0xdc00 && first <= 0xdfff) {
      fail("InvalidUnicode", "JSON strings must not contain unpaired low surrogates.");
    }

    if (first < 0xd800 || first > 0xdbff) return String.fromCharCode(first);

    if (this.#input.slice(this.#index, this.#index + 2) !== "\\u") {
      fail("InvalidUnicode", "JSON strings must not contain unpaired high surrogates.");
    }

    this.#index += 2;
    const second = this.#parseHexQuad();

    if (second < 0xdc00 || second > 0xdfff) {
      fail("InvalidUnicode", "JSON strings must not contain unpaired high surrogates.");
    }

    return String.fromCharCode(first, second);
  }

  #parseHexQuad(): number {
    let value = 0;

    for (let offset = 0; offset < 4; offset += 1) {
      const code = this.#input.charCodeAt(this.#index);
      let digit: number;

      if (code >= 0x30 && code <= 0x39) digit = code - 0x30;
      else if (code >= 0x41 && code <= 0x46) digit = code - 0x41 + 10;
      else if (code >= 0x61 && code <= 0x66) digit = code - 0x61 + 10;
      else return invalidJson("Invalid Unicode escape.");
      value = value * 16 + digit;
      this.#index += 1;
    }

    return value;
  }

  #parseNumber(): JsonNode {
    const start = this.#index;

    if (this.#input.charCodeAt(this.#index) === 0x2d) this.#index += 1;

    if (this.#input.charCodeAt(this.#index) === 0x30) this.#index += 1;
    else this.#parseDigits();
    let unsupported = false;

    if (this.#input.charCodeAt(this.#index) === 0x2e) {
      unsupported = true;
      this.#index += 1;
      this.#parseDigits();
    }

    const exponent = this.#input.charCodeAt(this.#index);

    if (exponent === 0x65 || exponent === 0x45) {
      unsupported = true;
      this.#index += 1;
      const sign = this.#input.charCodeAt(this.#index);

      if (sign === 0x2b || sign === 0x2d) this.#index += 1;
      this.#parseDigits();
    }

    const lexeme = this.#input.slice(start, this.#index);

    if (unsupported) {
      fail(
        "UnsupportedNumber",
        "Only exact safe-integer JSON numbers are supported; use a decimal string for other values.",
      );
    }

    const exact = BigInt(lexeme);

    if (exact < -maximumSafeInteger || exact > maximumSafeInteger) {
      fail(
        "UnsupportedNumber",
        "JSON numbers must be between -9007199254740991 and 9007199254740991.",
      );
    }

    return { kind: "number", value: Number(exact) };
  }

  #parseDigits(): void {
    const start = this.#index;

    while (this.#index < this.#input.length) {
      const code = this.#input.charCodeAt(this.#index);

      if (code < 0x30 || code > 0x39) break;
      this.#index += 1;
    }

    if (this.#index === start) invalidJson("Expected a JSON number digit.");
  }
}

function nodeToJson(node: JsonNode): Schema.Json {
  if (node.kind === "object") {
    return Object.fromEntries(node.entries.map((entry) => [entry.key, nodeToJson(entry.value)]));
  }

  if (node.kind === "array") return node.values.map(nodeToJson);

  if (node.kind === "null") return null;

  return node.value;
}

function nodeToJsonObject(node: JsonNode): Schema.JsonObject {
  if (node.kind !== "object") {
    fail("UnsupportedVersion", "The canonical JSON root must be an object.");
  }

  return Object.fromEntries(node.entries.map((entry) => [entry.key, nodeToJson(entry.value)]));
}

function nodeToDocument(root: JsonNode): CanonicalDocument {
  if (root.kind !== "object")
    fail("UnsupportedVersion", "The canonical JSON root must be an object.");
  const version = root.entries.find((entry) => entry.key === "version")?.value;

  if (version?.kind !== "number" || version.value !== 1) {
    fail("UnsupportedVersion", "Canonical JSON requires numeric version 1.");
  }

  const canonicalization = root.entries.find((entry) => entry.key === "canonicalization")?.value;

  if (canonicalization?.kind !== "string" || canonicalization.value !== "openerp-c14n-v1") {
    fail("UnsupportedVersion", "Canonical JSON requires openerp-c14n-v1.");
  }

  return {
    canonicalization: "openerp-c14n-v1",
    value: nodeToJsonObject(root),
    version: 1,
  };
}

function jsonToNode(value: Schema.Json): JsonNode {
  if (value === null) return { kind: "null" };

  if (typeof value === "boolean") return { kind: "boolean", value };

  if (typeof value === "string") return { kind: "string", value: requireValidUnicode(value) };

  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      fail(
        "UnsupportedNumber",
        "Only exact safe-integer JSON numbers are supported; use a decimal string for other values.",
      );
    }

    return { kind: "number", value };
  }

  if (Array.isArray(value)) return { kind: "array", values: value.map(jsonToNode) };
  const prototype = Object.getPrototypeOf(value);

  if (
    (prototype !== Object.prototype && prototype !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail("InvalidJson", "Canonical JSON accepts only plain string-keyed objects.");
  }

  return {
    kind: "object",
    entries: Object.entries(value).map(([key, entry]) => ({
      key: requireValidUnicode(key),
      value: jsonToNode(entry),
    })),
  };
}

function jsonValueToDocument(value: Schema.Json): CanonicalDocument {
  const root = jsonToNode(value);

  if (root.kind !== "object")
    fail("UnsupportedVersion", "The canonical JSON root must be an object.");
  const version = root.entries.find((entry) => entry.key === "version")?.value;

  if (version?.kind !== "number" || version.value !== 1) {
    fail("UnsupportedVersion", "Canonical JSON requires numeric version 1.");
  }

  const canonicalization = root.entries.find((entry) => entry.key === "canonicalization")?.value;

  if (canonicalization?.kind !== "string" || canonicalization.value !== "openerp-c14n-v1") {
    fail("UnsupportedVersion", "Canonical JSON requires openerp-c14n-v1.");
  }

  return { canonicalization: "openerp-c14n-v1", value: nodeToJsonObject(root), version: 1 };
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return left.length - right.length;
}

function quoteString(value: string): string {
  let result = '"';

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;

    if (character === '"') result += '\\"';
    else if (character === "\\") result += "\\\\";
    else if (character === "\b") result += "\\b";
    else if (character === "\f") result += "\\f";
    else if (character === "\n") result += "\\n";
    else if (character === "\r") result += "\\r";
    else if (character === "\t") result += "\\t";
    else if (code <= 0x1f) result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }

  return `${result}"`;
}

function writeCanonicalNode(node: JsonNode): string {
  if (node.kind === "object") {
    const entries = node.entries
      .map((entry) => ({ ...entry, keyBytes: encodeUtf8(entry.key) }))
      .sort((left, right) => compareBytes(left.keyBytes, right.keyBytes));

    return `{${entries.map((entry) => `${quoteString(entry.key)}:${writeCanonicalNode(entry.value)}`).join(",")}}`;
  }

  if (node.kind === "array") return `[${node.values.map(writeCanonicalNode).join(",")}]`;

  if (node.kind === "string") return quoteString(node.value);

  if (node.kind === "number") return String(node.value);

  if (node.kind === "boolean") return node.value ? "true" : "false";

  return "null";
}

function canonicalJsonBytes(root: JsonNode): CanonicalJsonBytes {
  const json = writeCanonicalNode(root);

  return { bytes: encodeUtf8(json), json };
}

function toCanonicalError(error: unknown): CanonicalJsonError {
  if (Schema.is(CanonicalJsonError)(error)) return error;

  return new CanonicalJsonError({ code: "InvalidJson", message: "The input is not valid JSON." });
}

function parseArbitraryJson(value: unknown): Result.Result<JsonNode, CanonicalJsonError> {
  if (typeof value === "string") {
    return Result.try({ try: () => new StrictJsonParser(value).parse(), catch: toCanonicalError });
  }

  const decoded = Schema.decodeUnknownResult(Schema.Json)(value);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      new CanonicalJsonError({ code: "InvalidJson", message: decoded.failure.message }),
    );
  }

  return Result.try({ try: () => jsonToNode(decoded.success), catch: toCanonicalError });
}

export const canonicalizeJson = (
  value: unknown,
): Result.Result<CanonicalJsonBytes, CanonicalJsonError> =>
  Result.flatMap(parseArbitraryJson(value), (root) => Result.succeed(canonicalJsonBytes(root)));

export function equalJson(left: Schema.Json | undefined, right: Schema.Json | undefined): boolean {
  // A string here is a JSON value, not serialized JSON to parse.
  const first = canonicalizeJson({ value: left });
  const second = canonicalizeJson({ value: right });

  return (
    Result.isSuccess(first) &&
    Result.isSuccess(second) &&
    first.success.json === second.success.json
  );
}

export const parseOpenErpC14nV1 = (
  input: string,
): Result.Result<CanonicalDocument, CanonicalJsonError> =>
  Result.try({
    try: () => nodeToDocument(new StrictJsonParser(input).parse()),
    catch: toCanonicalError,
  });

export const validateOpenErpC14nV1 = (
  input: unknown,
): Result.Result<CanonicalDocument, CanonicalJsonError> => {
  const decoded = Schema.decodeUnknownResult(Schema.Json)(input);

  if (Result.isFailure(decoded)) {
    return Result.fail(
      new CanonicalJsonError({ code: "InvalidJson", message: decoded.failure.message }),
    );
  }

  return Result.try({ try: () => jsonValueToDocument(decoded.success), catch: toCanonicalError });
};

export const canonicalizeOpenErpC14nV1 = (
  value: unknown,
): Result.Result<CanonicalBytes, CanonicalJsonError> => {
  const document =
    typeof value === "string" ? parseOpenErpC14nV1(value) : validateOpenErpC14nV1(value);

  return Result.flatMap(document, (validated) =>
    Result.flatMap(canonicalizeJson(validated.value), (canonical) =>
      Result.succeed({
        ...canonical,
        canonicalization: "openerp-c14n-v1" as const,
        version: 1 as const,
      }),
    ),
  );
};

export const sha256 = Effect.fn("domain.sha256")(function* (bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* crypto.digest("SHA-256", bytes);

  return `sha256:${Encoding.encodeHex(digest)}`;
});

export const sealOpenErpC14nV1 = Effect.fn("domain.sealOpenErpC14nV1")(function* (value: unknown) {
  const canonical = yield* Result.match(canonicalizeOpenErpC14nV1(value), {
    onFailure: (error) => Effect.fail(error),
    onSuccess: (value) => Effect.succeed(value),
  });

  const digest = yield* sha256(canonical.bytes);

  return { ...canonical, digest };
});
