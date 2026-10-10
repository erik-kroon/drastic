import { createHash } from "node:crypto";
import * as Schema from "effect/Schema";

export const AiFinancialFact = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("amount"),
    value: Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]{0,37})$/)),
  }),
  Schema.Struct({
    kind: Schema.Literal("account"),
    value: Schema.String.check(Schema.isPattern(/^[0-9]{1,12}$/)),
  }),
  Schema.Struct({
    kind: Schema.Literal("vat"),
    value: Schema.String.check(Schema.isPattern(/^[0-9]+(?:[/.][0-9]+)?$/)),
  }),
  Schema.Struct({
    kind: Schema.Literal("date"),
    value: Schema.String.check(Schema.isPattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)),
  }),
]);

export const AiState = Schema.Array(
  Schema.Union([
    AiFinancialFact,
    Schema.Struct({ kind: Schema.Literal("text"), value: Schema.String }),
  ]),
);

export type IdentityKind = "CLIENT" | "PERSON" | "SUPPLIER" | "CUSTOMER";

export interface AiIdentity {
  readonly kind: IdentityKind;
  readonly token: string;
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
}

export interface AiProvider {
  readonly provider: string;
  readonly destination: string;
  readonly modelRelease: string;
  readonly policy: "local-fixture" | "eu-no-training-no-retention" | "self-hosted";
  readonly approval: string;
}

export type AiCategory =
  | "free_text"
  | "financial_facts"
  | "client_identity_tokens"
  | "person_identity_tokens"
  | "private_counterparty_identity_tokens"
  | "public_company_identity"
  | "raw_document"
  | "operation_reference";

export class AiEgressError extends Error {
  constructor() {
    super("ai_egress_refused");
  }
}

const reserved =
  /\[(?:CLIENT|PERSON|SUPPLIER|CUSTOMER|PERSONAL_ID|[A-Z][A-Z0-9]*_)(?:[^\]\r\n]*)\]?/gi;

const personalNumber =
  /(?<!\d)(?:(?:19|20)\d{2}|\d{2})(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]|[6-8]\d|9[01])[-+ ]?\d{4}(?!\d)/g;

export class IdentityRegistry {
  readonly #identities = new Map<string, AiIdentity>();
  readonly #personalTokens = new Set<string>();
  readonly #aliases = new Map<string, Set<string>>();
  readonly #pattern: RegExp | null;
  readonly #namespace: string;

  constructor(namespace: string, identities: ReadonlyArray<AiIdentity>) {
    this.#namespace = namespace;

    for (const identity of identities) {
      this.#identities.set(identity.token, identity);

      for (const alias of identity.aliases) {
        if (!alias.trim()) continue;

        const normalized = alias.normalize("NFC").toLocaleLowerCase("sv-SE");
        const tokens = this.#aliases.get(normalized) ?? new Set<string>();
        tokens.add(identity.token);
        this.#aliases.set(normalized, tokens);
      }
    }

    const alternatives = [...this.#aliases.keys()]
      .sort((a, b) => b.length - a.length)
      .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

    this.#pattern = alternatives.length
      ? new RegExp(
          `(?<![\\p{L}\\p{N}_])(?:${alternatives.join("|")})(?:s|['’]s)?(?![\\p{L}\\p{N}_])`,
          "giu",
        )
      : null;
  }

  tokenize(input: Schema.Json): Schema.Json {
    if (typeof input === "string") return this.#text(input);

    if (Array.isArray(input)) return input.map((item) => this.tokenize(item));

    if (input === null || typeof input !== "object") return input;

    const entries = Object.entries(input).map(([key, value]) => {
      if (this.#text(key) !== key) throw new AiEgressError();

      return [key, this.tokenize(value)] as const;
    });

    return Object.fromEntries(entries);
  }

  tokenizeState(state: typeof AiState.Type) {
    const parsed = Schema.decodeUnknownSync(AiState)(state, { onExcessProperty: "error" });

    return parsed.map((part) =>
      part.kind === "text" ? { kind: "text" as const, value: this.#text(part.value) } : part,
    );
  }

  #text(input: string): string {
    if (input.match(reserved)) throw new AiEgressError();

    let text = input.normalize("NFC");

    if (this.#pattern)
      text = text.replace(this.#pattern, (matched) => {
        const normalized = matched.toLocaleLowerCase("sv-SE");

        const tokens =
          this.#aliases.get(normalized) ??
          this.#aliases.get(normalized.replace(/(?:s|['’]s)$/, ""));

        if (!tokens) throw new AiEgressError();

        const client = [...tokens].find((token) => this.#identities.get(token)?.kind === "CLIENT");

        if (tokens.size !== 1 && !client) throw new AiEgressError();

        return client ?? [...tokens][0]!;
      });

    return text.replace(personalNumber, (number) => {
      const digest = createHash("sha256")
        .update(this.#namespace)
        .update(number.replace(/[-+ ]/g, ""))
        .digest("hex")
        .slice(0, 24);

      const token = `[PERSONAL_ID_${digest}]`;
      this.#personalTokens.add(token);

      return token;
    });
  }

  assertOutput(output: Schema.Json) {
    const visit = (value: Schema.Json): void => {
      if (typeof value === "string") {
        for (const token of value.match(reserved) ?? []) {
          if (!this.#identities.has(token) && !this.#personalTokens.has(token))
            throw new AiEgressError();
        }

        return;
      }

      if (Array.isArray(value)) {
        value.forEach(visit);

        return;
      }

      if (value && typeof value === "object") {
        for (const [key, item] of Object.entries(value)) {
          visit(key);
          visit(item);
        }
      }
    };

    visit(output);
  }

  restoreIdentity(slot: { readonly kind: IdentityKind; readonly token: string }) {
    const identity = this.#identities.get(slot.token);

    if (!identity || identity.kind !== slot.kind) throw new AiEgressError();

    return identity.name;
  }

  renderTemplate(parts: ReadonlyArray<TemplatePart>) {
    return parts
      .map((part) => {
        if (part.kind === "identity") return this.restoreIdentity(part.identity);

        if (part.text.match(reserved)) throw new AiEgressError();

        return part.text;
      })
      .join("");
  }
}

export type TemplatePart =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "identity";
      readonly identity: { readonly kind: IdentityKind; readonly token: string };
    };

export interface EgressStore {
  structured(
    provider: AiProvider,
    input: Schema.Json,
    categories: ReadonlyArray<AiCategory>,
  ): Promise<{ readonly payload: Schema.Json; readonly registry: IdentityRegistry }>;
  raw(
    provider: AiProvider,
    operation: "document_submit" | "document_poll",
    payload: Uint8Array | string,
  ): Promise<void>;
}

export class AiEgress {
  constructor(readonly store: EgressStore) {}

  async structured(
    provider: AiProvider,
    input: Schema.Json,
    categories: ReadonlyArray<AiCategory>,
  ) {
    try {
      return await this.store.structured(provider, input, categories);
    } catch {
      throw new AiEgressError();
    }
  }

  async raw(
    provider: AiProvider,
    operation: "document_submit" | "document_poll",
    payload: Uint8Array | string,
  ) {
    try {
      await this.store.raw(provider, operation, payload);
    } catch {
      throw new AiEgressError();
    }
  }
}

export function requireAiEgress(value: AiEgress): AiEgress {
  if (!(value instanceof AiEgress)) throw new AiEgressError();

  return value;
}
