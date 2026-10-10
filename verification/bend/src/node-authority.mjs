import { runtimeIdentity } from "./runtime-id.mjs";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, dirname, relative, isAbsolute, sep } from "node:path";
import { digestBytes, fail } from "./contracts.mjs";
import { qualifyManifest } from "./release.mjs";
import { qualifiedService } from "./service.mjs";
import { compiledEngine } from "./compiled-engine.mjs";

/** Loads exactly the bytes that were hashed, never an interpreter fallback.
 * Trust files must be supplied by deployment configuration, not the model/user.
 */
export async function loadAuthority({ manifestPath, artifactPath, trustPath, runtimeId }) {
  if (runtimeId === undefined) runtimeId = runtimeIdentity();

  if (runtimeId !== runtimeIdentity())
    fail("RuntimeMismatch", "The caller cannot relabel this execution runtime");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")),
    trust = JSON.parse(await readFile(trustPath, "utf8"));

  const bytes = await readFile(artifactPath),
    artifactDigest = await digestBytes(bytes);

  const base = await realpath(dirname(resolve(manifestPath)));

  if (bytes.length > 16_000_000) fail("InvalidArtifact", "Artifact exceeds 16 MB");

  const receipt = async (name) => {
    const path = resolve(base, name),
      rel = relative(base, path);

    if (isAbsolute(name) || rel === ".." || rel.startsWith(".." + sep))
      fail("InvalidRelease", "Evidence path escapes release directory");

    const actual = await realpath(path),
      actualRel = relative(base, actual);

    if (actualRel === ".." || actualRel.startsWith(".." + sep) || isAbsolute(actualRel))
      fail("InvalidRelease", "Evidence symlink escapes release directory");

    if ((await stat(actual)).size > 8_000_000) fail("InvalidRelease", "Receipt exceeds 8 MB");

    return new Uint8Array(await readFile(actual));
  };

  const qualification = await qualifyManifest(manifest, trust, runtimeId, artifactDigest, receipt);
  // The build emits one self-contained module. A data URL binds module loading
  // to these exact bytes and rejects relative module dependencies by construction.
  const mod = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);

  if (mod.artifactFormat !== "openerp-bend-js/v1")
    fail("InvalidArtifact", "Not the expected generated module format");

  if (
    mod.buildInfo?.sourceTreeDigest !== qualification.sourceTreeDigest ||
    mod.buildInfo?.compilerCommit !== manifest.compiler.commit
  )
    fail("ArtifactMismatch", "Artifact metadata differs from qualified release");

  return qualifiedService(compiledEngine(mod.default, mod.constructors), qualification);
}
