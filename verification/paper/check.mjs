import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const base = process.argv.slice(2).find((argument) => argument !== "--write-ledger") ?? "HEAD";

const manifestPath = "verification/paper/kanon-manifest.json";

const inventoryPath = "docs/design/legacy-ui-imports.json";

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const paths = (...args) =>
  git(...args)
    .split("\0")
    .filter(Boolean);

const failures = [];

const approvedTransportEdit = (file, previousHash) => {
  const approval = manifest.transportOnlyChanges;
  const receipt = approval?.files.find((candidate) => candidate.path === file);

  if (
    !receipt ||
    approval.authorization !== "Allow transport-only edits; preserve visual status and baselines"
  )
    return false;

  const before = createHash("sha256")
    .update(git("show", `${approval.baseRevision}:${file}`))
    .digest("hex");

  const after = createHash("sha256").update(readFileSync(file)).digest("hex");

  return (
    before === receipt.beforeSha256 &&
    after === receipt.afterSha256 &&
    (!previousHash || previousHash === before)
  );
};

const inventory = readJson(inventoryPath);

const allowed = new Set(inventory.imports);

const observed = new Set();

const files = new Set([
  ...paths("ls-files", "-z", "apps/web/src"),
  ...paths("ls-files", "-z", "--others", "--exclude-standard", "apps/web/src"),
]);

for (const file of files) {
  if (!/\.[cm]?[jt]sx?$/.test(file) || !existsSync(file)) continue;

  for (const match of readFileSync(file, "utf8").matchAll(
    /["'`](@open-erp\/ui\/components\/[^"'`]+)["'`]/g,
  )) {
    const pair = `${file}:${match[1]}`;
    observed.add(pair);

    if (!inventory.infrastructureModules.includes(match[1]) && !allowed.has(pair))
      failures.push(`New legacy UI reference: ${pair}`);
  }
}

for (const pair of allowed) {
  if (!observed.has(pair)) failures.push(`Remove unused legacy exception: ${pair}`);
}

const previous = spawnSync("git", ["show", `${base}:${inventoryPath}`], { encoding: "utf8" });

if (previous.status === 0) {
  const oldInventory = JSON.parse(previous.stdout);

  const oldAllowed = new Set(oldInventory.imports);

  for (const module of inventory.infrastructureModules) {
    if (!oldInventory.infrastructureModules.includes(module))
      failures.push(`Infrastructure exemptions may not grow: ${module}`);
  }

  for (const pair of allowed) {
    if (!oldAllowed.has(pair)) failures.push(`Legacy inventory may only shrink: ${pair}`);
  }
} else if (
  createHash("sha256").update(readFileSync(inventoryPath)).digest("hex") !==
  "6a4e72fb40705a869b5a90fba29481ea105b7dd6ea411225f46efc1d0fb31edc"
) {
  failures.push("Initial legacy inventory changed without a committed ratchet baseline.");
}

const manifest = readJson(manifestPath);

const previousManifest = spawnSync("git", ["show", `${base}:${manifestPath}`], {
  encoding: "utf8",
});

const oldManifest = previousManifest.status === 0 ? JSON.parse(previousManifest.stdout) : null;

const oldEntries = oldManifest?.entries ?? [];

const ledgerPath = "docs/design/parity-ledger.md";

const ledger =
  "# Kanon parity ledger\n\nGenerated from [kanon-manifest.json](../../verification/paper/kanon-manifest.json). Candidate routes and owners need exact state review before implementation. Reference images are design captures; application proof is recorded separately.\n\n| Board | Route / candidate | Candidate owner | Status | Reference |\n|---|---|---|---|---|\n" +
  manifest.entries
    .map(
      (entry) =>
        `| ${entry.name} | ${entry.route ?? entry.candidateRoute ?? "Mapping pending"} | ${entry.files.join(", ") || "Mapping pending"} | ${entry.status} | ${entry.baseline ? `[PNG](../../${entry.baseline})` : "Design pending"} |`,
    )
    .join("\n") +
  "\n";

if (process.argv.includes("--write-ledger")) writeFileSync(ledgerPath, ledger);
else if (readFileSync(ledgerPath, "utf8") !== ledger)
  failures.push("Regenerate the human ledger with bun run check:design --write-ledger");

const ids = new Set();

for (const entry of manifest.entries) {
  const old = oldEntries.find((candidate) => candidate.id === entry.id);

  if (
    old &&
    (old.baselineSha256 !== entry.baselineSha256 || old.jsxSha256 !== entry.jsxSha256) &&
    (old.baseline === entry.baseline ||
      oldManifest.referenceRevision === manifest.referenceRevision)
  )
    failures.push(`Create a new immutable reference revision: ${entry.id}`);

  if (ids.has(entry.id)) failures.push(`Duplicate screen ID: ${entry.id}`);
  ids.add(entry.id);

  if (!["unverified", "design-pending", "drifts", "matches", "missing"].includes(entry.status))
    failures.push(`Invalid status: ${entry.id}`);

  for (const file of [entry.baseline, entry.jsx, entry.behaviorSource, ...entry.files].filter(
    Boolean,
  )) {
    if (!existsSync(file)) failures.push(`Missing reference: ${entry.id}: ${file}`);
  }

  if (entry.baseline && existsSync(entry.baseline)) {
    const hash = createHash("sha256").update(readFileSync(entry.baseline)).digest("hex");

    if (hash !== entry.baselineSha256) failures.push(`Changed baseline: ${entry.id}`);
  }

  if (
    entry.jsx &&
    existsSync(entry.jsx) &&
    createHash("sha256").update(readFileSync(entry.jsx)).digest("hex") !== entry.jsxSha256
  )
    failures.push(`Changed JSX reference: ${entry.id}`);

  if (["matches", "drifts"].includes(entry.status)) {
    if (
      !entry.route ||
      !entry.evidence ||
      !existsSync(entry.evidence) ||
      !paths("ls-files", "-z", "--", entry.evidence).includes(entry.evidence)
    ) {
      failures.push(`Measured status needs route and tracked evidence: ${entry.id}`);
    } else {
      const proof = readJson(entry.evidence);

      for (const key of [
        "sourceRevision",
        "referenceSha256",
        "command",
        "conditions",
        "difference",
        "tolerance",
        "reviewer",
        "actual",
        "diff",
        "sourceHashes",
        "actualSha256",
        "diffSha256",
      ]) {
        if (proof[key] === undefined || proof[key] === null)
          failures.push(`Missing ${key} evidence: ${entry.id}`);
      }

      if (proof.referenceSha256 !== entry.baselineSha256)
        failures.push(`Stale reference evidence: ${entry.id}`);

      if (
        !entry.comparison ||
        proof.tolerance !== entry.comparison.maxDiffRatio ||
        proof.channelTolerance !== entry.comparison.channelTolerance ||
        proof.adoptedBy !== entry.comparison.adoptedBy
      )
        failures.push(`Evidence differs from adopted comparison policy: ${entry.id}`);

      for (const file of entry.files) {
        if (
          existsSync(file) &&
          !approvedTransportEdit(file, proof.sourceHashes?.[file]) &&
          proof.sourceHashes?.[file] !==
            createHash("sha256").update(readFileSync(file)).digest("hex")
        )
          failures.push(`Stale implementation evidence: ${entry.id}: ${file}`);
      }

      for (const artifact of [proof.actual, proof.diff]) {
        if (
          !artifact ||
          !existsSync(artifact) ||
          !paths("ls-files", "-z", "--", artifact).includes(artifact)
        )
          failures.push(`Evidence artifact must be tracked: ${entry.id}`);
      }

      for (const [artifact, hash] of [
        [proof.actual, proof.actualSha256],
        [proof.diff, proof.diffSha256],
      ]) {
        if (
          artifact &&
          existsSync(artifact) &&
          createHash("sha256").update(readFileSync(artifact)).digest("hex") !== hash
        )
          failures.push(`Changed evidence artifact: ${entry.id}`);
      }

      if (
        entry.status === "matches" &&
        !(
          Number.isFinite(proof.difference) &&
          Number.isFinite(proof.tolerance) &&
          proof.difference >= 0 &&
          proof.tolerance >= 0 &&
          proof.difference <= proof.tolerance
        )
      )
        failures.push(`Comparison does not pass: ${entry.id}`);
    }
  }
}

const referenceInventory = readJson(
  `verification/paper/baseline/${manifest.referenceRevision}/inventory.json`,
);

for (const board of referenceInventory.boards) {
  if (!ids.has(board.name.match(/^K-\d+/)[0]))
    failures.push(`Missing retained board: ${board.name}`);
}

const changed = new Set([
  ...paths("diff", "--name-only", "-z", base, "--"),
  ...paths("ls-files", "-z", "--others", "--exclude-standard"),
]);

for (const file of changed) {
  if (!existsSync(file) || !/^(apps\/web\/src|packages\/ui\/src)\/.*\.(tsx|stylex\.ts)$/.test(file))
    continue;

  if (approvedTransportEdit(file)) continue;

  const owners = manifest.entries.filter((entry) => entry.files.includes(file));

  if (!owners.length) failures.push(`Changed UI file needs screen contract: ${file}`);

  if (!changed.has(manifestPath)) failures.push(`Update parity manifest with UI change: ${file}`);

  for (const entry of owners) {
    const old = oldEntries.find((candidate) => candidate.id === entry.id);

    if (old && JSON.stringify(old) === JSON.stringify(entry))
      failures.push(`Update affected screen entry: ${entry.id}: ${file}`);

    if (!entry.route || !entry.requiredStates.length || entry.adoption !== "approved")
      failures.push(
        `Resolve route, states and design adoption before UI implementation: ${entry.id}`,
      );
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `Design contract passed; ${manifest.entries.filter((entry) => entry.status === "matches").length} measured matching screens. This is not a visual comparison.`,
);
