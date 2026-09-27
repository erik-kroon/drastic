import { platform, arch } from "node:os";

export function runtimeIdentity() {
  const engine = process.versions.bun ? `bun:${process.versions.bun}` : `node:${process.version}`;

  return `${engine}:${platform()}:${arch()}`;
}
