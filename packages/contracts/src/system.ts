import * as Schema from "effect/Schema";

export const SystemStatus = Schema.Struct({
  status: Schema.Literal("ok"),
  service: Schema.Literal("open-erp-api"),
  effectVersion: Schema.Literal("4.0.0-rc.112"),
  checkedAt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
});

export type SystemStatus = typeof SystemStatus.Type;
