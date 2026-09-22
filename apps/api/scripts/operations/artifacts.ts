import { copyFile, lstat, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import * as Schema from "effect/Schema";
import { RecoveryPlan, ReleaseManifest } from "../../../../packages/contracts/src/operations";
import {
  artifactPath,
  fingerprint,
  newDirectory,
  privatePath,
  refuse,
  writePrivate,
} from "./safety";

const releaseDirectories = [
  "apps/api/src",
  "apps/api/scripts",
  "apps/api/migrations",
  "apps/web/src",
  "packages/contracts/src",
  "packages/ui/src",
  "packages/config",
];
const releaseFiles = [
  "package.json",
  "bun.lock",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
  "packages/ui/package.json",
];
const sourceExtensions = /\.(ts|tsx|js|jsx|json|sql|css|svg|md)$/;
const sourceMetadataFiles = [".gitignore", ".prettierignore"];
const requiredRuntimeFiles = [
  "apps/api/src/db/connection.ts",
  "apps/api/src/db/auth-schema.ts",
  "apps/api/src/better-auth.ts",
  "apps/api/src/auth.ts",
  "apps/api/migrations/0900-better-auth.sql",
];

export async function filesIn(root: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await privatePath(artifactPath(root, name), true);
      files.push(...(await filesIn(root, name)));
    } else if (entry.isFile()) {
      await privatePath(artifactPath(root, name), false);
      files.push(name);
    } else refuse("Bundle contains a symlink or special file.");
  }
  return files.sort();
}
async function sourceFiles(root: string, prefix: string): Promise<string[]> {
  const path = artifactPath(root, prefix);
  if ((await realpath(path)) !== path) refuse("Release source cannot contain symlinks.");
  const files: string[] = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${prefix}/${entry.name}`;
    if (entry.name.startsWith(".") && !sourceMetadataFiles.includes(entry.name))
      refuse("Hidden release content needs explicit operator review.");
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, name)));
    else if (
      entry.isFile() &&
      (sourceExtensions.test(entry.name) || sourceMetadataFiles.includes(entry.name))
    )
      files.push(name);
    else refuse("Unsupported release source file. Do not silently omit it.");
  }
  return files;
}
async function createParents(root: string, name: string) {
  const parts = name.split("/").slice(0, -1);
  let parent = root;
  for (const part of parts) {
    parent = join(parent, part);
    try {
      await lstat(parent);
      await privatePath(parent, true);
    } catch (error) {
      if (Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))(error))
        await newDirectory(parent);
      else throw error;
    }
  }
}
export async function copyArtifacts(source: string, destination: string) {
  await privatePath(source, true);
  await newDirectory(destination);
  const inventory = await filesIn(source);
  for (const name of inventory) {
    const from = artifactPath(source, name);
    const to = artifactPath(destination, name);
    await createParents(destination, name);
    const before = await fingerprint(from);
    await copyFile(from, to, constants.COPYFILE_EXCL);
    const copied = await fingerprint(to);
    const after = await fingerprint(from);
    if (
      before.sha256 !== copied.sha256 ||
      before.sha256 !== after.sha256 ||
      before.bytes !== after.bytes
    )
      refuse("Artifact changed during copy.");
  }
  if (JSON.stringify(inventory) !== JSON.stringify(await filesIn(source)))
    refuse("Artifact inventory changed during copy.");
}
export async function captureRelease(sourceRoot: string, destination: string) {
  if (!isAbsolute(sourceRoot) || (await realpath(sourceRoot)) !== sourceRoot)
    refuse("Use a real absolute release source root.");
  if (destination === sourceRoot || destination.startsWith(sourceRoot + "/"))
    refuse("Capture the release outside its source tree.");
  await newDirectory(destination);
  const names = [...releaseFiles];
  for (const directory of releaseDirectories)
    names.push(...(await sourceFiles(sourceRoot, directory)));
  if (requiredRuntimeFiles.some((name) => !names.includes(name)))
    refuse("Release is missing the expected Drizzle/Better Auth runtime boundary.");
  const files = [];
  for (const name of names.sort()) {
    const before = await fingerprint(artifactPath(sourceRoot, name), false);
    await createParents(destination, name);
    const bytes = await readFile(artifactPath(sourceRoot, name));
    await writeFile(artifactPath(destination, name), bytes, { flag: "wx", mode: 0o600 });
    const copied = await fingerprint(artifactPath(destination, name));
    if (before.sha256 !== copied.sha256 || before.bytes !== copied.bytes)
      refuse("Release changed during capture.");
    files.push({ path: name, ...copied });
  }
  const afterNames = [...releaseFiles];
  for (const directory of releaseDirectories)
    afterNames.push(...(await sourceFiles(sourceRoot, directory)));
  if (JSON.stringify(names.sort()) !== JSON.stringify(afterNames.sort()))
    refuse("Release inventory changed during capture.");
  for (const file of files) {
    if ((await fingerprint(artifactPath(sourceRoot, file.path), false)).sha256 !== file.sha256)
      refuse("Release file changed during capture.");
  }
  const manifest = Schema.decodeSync(ReleaseManifest)({
    version: 1,
    kind: "openerp-source-release",
    capturedAt: new Date().toISOString(),
    files,
    databaseAdapter: "drizzle-effect-postgres",
    browserAuthentication: "better-auth",
    runtimeVerification: "not-run",
  });
  await writePrivate(join(destination, "release.json"), JSON.stringify(manifest, null, 2) + "\n");
}
export async function inspectRelease(root: string) {
  await privatePath(root, true);
  await privatePath(join(root, "release.json"), false);
  const manifest = Schema.decodeUnknownSync(ReleaseManifest)(
    JSON.parse(await readFile(join(root, "release.json"), "utf8")),
  );
  const names = manifest.files.map((file) => file.path).sort();
  if (
    new Set(names).size !== names.length ||
    [...releaseFiles, ...requiredRuntimeFiles].some((name) => !names.includes(name)) ||
    releaseDirectories.some((directory) => !names.some((name) => name.startsWith(directory + "/")))
  )
    refuse("Release inventory is incomplete.");
  if (
    JSON.stringify(names) !==
    JSON.stringify((await filesIn(root)).filter((name) => name !== "release.json"))
  )
    refuse("Release inventory differs from files.");
  for (const file of manifest.files) {
    const actual = await fingerprint(artifactPath(root, file.path));
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
      refuse("Release file checksum mismatch.");
  }
  return manifest;
}
export async function readRecoveryPlan(path: string) {
  await privatePath(path, false);
  const plan = Schema.decodeUnknownSync(RecoveryPlan)(JSON.parse(await readFile(path, "utf8")));
  await privatePath(plan.supplementaryDirectory, true);
  await inspectRelease(plan.releaseDirectory);
  const names = plan.artifacts.map((file) => file.path).sort();
  if (
    new Set(names).size !== names.length ||
    new Set(plan.artifacts.map((file) => file.referenceId)).size !== names.length ||
    JSON.stringify(names) !== JSON.stringify(await filesIn(plan.supplementaryDirectory))
  )
    refuse("Supplementary declaration must cover every file exactly once.");
  const requiredConfig = ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"];
  if (
    plan.configuration.length !== requiredConfig.length ||
    new Set(plan.configuration.map((item) => item.name)).size !== requiredConfig.length ||
    requiredConfig.some((name) => !plan.configuration.some((item) => item.name === name))
  )
    refuse("Recovery configuration custody is incomplete.");
  for (const item of plan.configuration) {
    if (
      !plan.artifacts.some(
        (file) =>
          file.path === item.procedurePath && ["configuration", "key-recovery"].includes(file.kind),
      )
    )
      refuse("Configuration custody references a missing recovery procedure.");
  }
  for (const file of plan.artifacts) {
    const actual = await fingerprint(artifactPath(plan.supplementaryDirectory, file.path));
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
      refuse("Declared supplementary content is missing or changed.");
  }
  return plan;
}
