import { readFile, writeFile } from "node:fs/promises";

const seed = JSON.parse(await readFile(process.argv[2], "utf8"));
const phase = process.argv[3];
const frames = {
  prepared: { frame: "R30 frozen payroll run", baseline: "frozen-run" },
  approved: { frame: "R31 approved payroll run", baseline: "approved-run" },
  posted: { frame: "R32 posted payroll run", baseline: "posted-run" },
  private: { frame: "R33 private payslip", baseline: "private-payslip" },
  pdf: { frame: "R34 private original payslip PDF", baseline: "private-payslip-pdf" },
};

if (!seed.synthetic || !/^payroll_run_[a-z0-9]+$/.test(seed.run?.id))
  throw new Error("Use a retained synthetic payroll seed receipt");

if (!Object.hasOwn(frames, phase)) throw new Error("Select a known payroll frame state");

const selected = frames[phase];
const entry = {
  frame: selected.frame,
  baseline: `payroll-owner/${selected.baseline}.png`,
  path: `/tax?view=payroll&record=${seed.run.id}`,
  maxDiffRatio: 0.025,
};

if (phase === "private" || phase === "pdf") {
  entry.selectText = "Visa lönebesked";
  entry.selectIndex = 0;
  entry.headingText = "Fjällby Konsult AB";
}

await writeFile(
  process.argv[4],
  JSON.stringify(
    { viewport: { width: 1440, height: 900 }, pixelTolerance: 24, entries: [entry] },
    null,
    2,
  ),
);
