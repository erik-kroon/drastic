/** Tests may use assertions and compact fixture destructuring. */
export function checksProductionSource(filename: string): boolean {
  return !(
    /(?:^|\/)(?:tests?|e2e)(?:\/|$)/u.test(filename) ||
    /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u.test(filename) ||
    /(?:^|\/)packages\/db\/src\/migrations\/(?:meta\/)?/u.test(filename)
  );
}

/** Reusable UI primitives may destructure their public prop contracts. */
export function checksDestructuringSource(filename: string): boolean {
  return (
    checksProductionSource(filename) && !/(?:^|\/)packages\/ui\/src\/components\//u.test(filename)
  );
}

/** Convert absolute Oxlint paths to stable repository paths. */
export function projectFilename(filename: string): string {
  const sourceRoot = /(?:apps|packages)\//gu.exec(filename);
  return sourceRoot === null ? filename : filename.slice(sourceRoot.index);
}
