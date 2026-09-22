import * as Schema from "effect/Schema";

export const MinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,37})$/));

export const SignedMinorUnits = Schema.String.check(Schema.isPattern(/^(0|-?[1-9][0-9]*)$/));

export const AggregateMinorUnits = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));
