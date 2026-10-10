import { authenticate } from "./auth";

type Operation = {
  readonly handler: (authentication: typeof authenticate) => unknown;
};

export function operationHandlers<Operations extends Record<string, Operation>>(
  operations: Operations,
): { readonly [Name in keyof Operations]: ReturnType<Operations[Name]["handler"]> };
export function operationHandlers(operations: Record<string, Operation>) {
  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [name, operation.handler(authenticate)]),
  );
}
