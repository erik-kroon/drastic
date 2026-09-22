const IMPLEMENTATION_EXCLUSIONS = [
  /(?:^|\/)(?:tests?|e2e)(?:\/|$)/u,
  /\.(?:test|spec|vitest)\.[cm]?[jt]sx?$/u,
  /(?:^|\/)apps\/server\/src\/components\/pdf(?:\/|$)/u,
  /(?:^|\/)packages\/ui\/src\/components\/(?:cascader|filters|navigation|sidebar)(?:\/|$)/u,
  /(?:^|\/)packages\/ui\/src\/components\/(?:highlight|kanban-primitives)\.tsx$/u,
] as const;

/** Exclude test helpers and maintained vendor-derived components from implementation-shape rules. */
export function checksImplementationShape(filename: string): boolean {
  return !IMPLEMENTATION_EXCLUSIONS.some((pattern) => pattern.test(filename));
}
