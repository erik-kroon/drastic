import type * as Accounting from "@open-erp/contracts/accounting";

// Resource IDs belong to the command, never to its book identity or sealed digest.
export function scopeFromPath(params: typeof Accounting.Scope.Type): typeof Accounting.Scope.Type {
  return { entityId: params.entityId, bookId: params.bookId };
}
