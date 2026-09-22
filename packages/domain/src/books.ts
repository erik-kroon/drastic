import * as Schema from "effect/Schema";
import { Identifier, AccountingDate, Scope } from "./values";
import { MinorUnits } from "./money";

export const Book = Schema.Struct({
  entityId: Identifier,
  id: Identifier,
  name: Schema.String,
  currency: Schema.String,
  profile: Schema.String,
  role: Schema.Literals(["operator", "agent"]),
  sequence: MinorUnits,
});

export const BookSetup = Schema.Struct({
  accounts: Schema.Array(
    Schema.Struct({
      id: Identifier,
      code: Schema.String,
      name: Schema.String,
      active: Schema.Boolean,
    }),
  ),
  periods: Schema.Array(
    Schema.Struct({
      id: Identifier,
      startsOn: AccountingDate,
      endsOn: AccountingDate,
      locked: Schema.Boolean,
    }),
  ),
  blockers: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});

export const BookStatus = Schema.Struct({
  scope: Scope,
  profile: Schema.String,
  writerAuthority: Schema.String,
  sequence: MinorUnits,
  productionReady: Schema.Literal(false),
  verification: Schema.Literal("not_verified"),
  features: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      installed: Schema.Boolean,
      available: Schema.Boolean,
      limitation: Schema.String,
    }),
  ),
  blockers: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      message: Schema.String,
      requiredInputs: Schema.Array(Schema.String),
    }),
  ),
});
