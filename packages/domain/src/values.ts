import * as Schema from "effect/Schema";

export const Identifier = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_-]{2,127}$/));

export const AccountingDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));

export const Description = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000));

export const Digest = Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/));

export const Scope = Schema.Struct({ entityId: Identifier, bookId: Identifier });
