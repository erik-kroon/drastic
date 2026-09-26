import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { MinorUnits } from "./money";
import { Description, Identifier } from "./values";

export const PostingLine = Schema.Struct({
  accountId: Identifier,
  creditMinor: MinorUnits,
  debitMinor: MinorUnits,
  description: Description,
  lineId: Identifier,
});

export type PostingLine = typeof PostingLine.Type;

export const PostingLineBatch = Schema.Array(PostingLine).check(
  Schema.isMinLength(2),
  Schema.isMaxLength(500),
);

export type PostingLineBatch = typeof PostingLineBatch.Type;

export const PostingGroupDependency = Schema.Struct({
  id: Identifier,
  dependsOnGroupIds: Schema.Array(Identifier).check(Schema.isUnique()),
});

export type PostingGroupDependency = typeof PostingGroupDependency.Type;

export const PostingValidationFailureCode = Schema.Literals([
  "InvalidLine",
  "LineCount",
  "LineId",
  "LineSide",
  "Unbalanced",
  "InvalidGroup",
  "DuplicateGroupId",
  "UnknownDependency",
  "DependencyCycle",
]);

export const PostingValidationFailure = Schema.Struct({
  code: PostingValidationFailureCode,
  message: Schema.String,
});

export type PostingValidationFailure = typeof PostingValidationFailure.Type;

export type PostingLinesResult = Result.Result<
  ReadonlyArray<PostingLine>,
  PostingValidationFailure
>;

export type PostingGroupOrderResult = Result.Result<
  ReadonlyArray<PostingGroupDependency>,
  PostingValidationFailure
>;

const decodeLines = Schema.decodeUnknownResult(Schema.Array(PostingLine));

const decodeGroups = Schema.decodeUnknownResult(Schema.Array(PostingGroupDependency));

function failure(code: PostingValidationFailure["code"], message: string): PostingLinesResult {
  return Result.fail({ code, message });
}

function immutableLines(lines: ReadonlyArray<PostingLine>): ReadonlyArray<PostingLine> {
  return Object.freeze(lines.map((line) => Object.freeze({ ...line })));
}

export function validatePostingLines(input: unknown): PostingLinesResult {
  const decoded = decodeLines(input);

  if (Result.isFailure(decoded)) {
    return failure("InvalidLine", decoded.failure.message);
  }

  if (decoded.success.length < 2) {
    return failure("LineCount", "A posting must contain at least two lines.");
  }

  if (decoded.success.length > 500) {
    return failure("LineCount", "A posting batch cannot contain more than 500 lines.");
  }

  const lineIds = new Set<string>();
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of decoded.success) {
    if (lineIds.has(line.lineId)) {
      return failure("LineId", `Posting line identifiers must be unique: ${line.lineId}.`);
    }

    lineIds.add(line.lineId);
    const debit = BigInt(line.debitMinor);
    const credit = BigInt(line.creditMinor);

    if (!((debit > 0n && credit === 0n) || (credit > 0n && debit === 0n))) {
      return failure(
        "LineSide",
        `Posting line ${line.lineId} must have exactly one positive debit or credit side.`,
      );
    }

    debitTotal += debit;
    creditTotal += credit;
  }

  if (debitTotal !== creditTotal || debitTotal === 0n) {
    return failure(
      "Unbalanced",
      "Posting debits and credits must balance exactly with a nonzero total.",
    );
  }

  return Result.succeed(immutableLines(decoded.success));
}

function immutableGroups(
  groups: ReadonlyArray<PostingGroupDependency>,
): ReadonlyArray<PostingGroupDependency> {
  return Object.freeze(
    groups.map((group) =>
      Object.freeze({ ...group, dependsOnGroupIds: Object.freeze([...group.dependsOnGroupIds]) }),
    ),
  );
}

export function orderPostingGroups(value: unknown): PostingGroupOrderResult {
  const decoded = decodeGroups(value);

  if (Result.isFailure(decoded)) {
    return Result.fail({ code: "InvalidGroup", message: decoded.failure.message });
  }

  const groups = decoded.success;
  const groupById = new Map<string, PostingGroupDependency>();

  for (const group of groups) {
    if (groupById.has(group.id)) {
      return Result.fail({
        code: "DuplicateGroupId",
        message: `Posting group identifiers must be unique: ${group.id}.`,
      });
    }

    groupById.set(group.id, group);
  }

  for (const group of groups) {
    for (const dependencyId of group.dependsOnGroupIds) {
      if (!groupById.has(dependencyId)) {
        return Result.fail({
          code: "UnknownDependency",
          message: `Posting group ${group.id} depends on missing group ${dependencyId}.`,
        });
      }
    }
  }

  const remainingDependencies = new Map<string, number>();
  const dependents = new Map<string, Array<string>>();

  for (const group of groups) {
    remainingDependencies.set(group.id, group.dependsOnGroupIds.length);

    for (const dependencyId of group.dependsOnGroupIds) {
      const groupDependents = dependents.get(dependencyId) ?? [];
      groupDependents.push(group.id);
      dependents.set(dependencyId, groupDependents);
    }
  }

  const ready = groups
    .filter((group) => group.dependsOnGroupIds.length === 0)
    .map((group) => group.id);

  const ordered: Array<PostingGroupDependency> = [];

  while (ready.length > 0) {
    const groupId = ready.shift();

    if (groupId === undefined) break;
    const group = groupById.get(groupId);

    if (group === undefined) {
      return Result.fail({
        code: "UnknownDependency",
        message: `Posting group ${groupId} is unavailable.`,
      });
    }

    ordered.push(group);

    for (const dependentId of dependents.get(groupId) ?? []) {
      const remaining = (remainingDependencies.get(dependentId) ?? 0) - 1;
      remainingDependencies.set(dependentId, remaining);

      if (remaining === 0) ready.push(dependentId);
    }
  }

  if (ordered.length !== groups.length) {
    return Result.fail({
      code: "DependencyCycle",
      message: "Posting group dependencies must form an acyclic graph.",
    });
  }

  return Result.succeed(immutableGroups(ordered));
}
