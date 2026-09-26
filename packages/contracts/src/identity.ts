import * as Schema from "effect/Schema";
import * as Accounting from "./accounting";

export const SignInConfiguration = Schema.Struct({
  method: Schema.Literals(["password", "oidc"]),
  providerId: Schema.NullOr(Schema.String),
});

const BookRole = Schema.NullOr(Schema.Literals(["operator", "agent"]));

export const IdentityProvisioning = Schema.Struct({
  requestId: Accounting.IdempotencyHeaders.fields["idempotency-key"],
  actorId: Accounting.Identifier,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  email: Schema.String.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
    Schema.isMaxLength(254),
  ),
  issuer: Schema.String.check(Schema.isMinLength(8), Schema.isMaxLength(2000)),
  clientId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  subject: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
  enabled: Schema.Boolean,
  grants: Schema.Array(
    Schema.Struct({
      scope: Accounting.Scope,
      expectedRole: BookRole,
      role: BookRole,
    }),
  ).check(Schema.isMaxLength(200)),
});
