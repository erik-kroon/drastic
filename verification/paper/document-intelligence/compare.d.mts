export function compareSourceHighlight(
  actual: Uint8Array,
  output: string,
): Promise<{
  readonly passed: boolean;
  readonly ratio: number;
  readonly expectedHash: string;
  readonly actualHash: string;
}>;
