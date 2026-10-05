import * as Effect from "effect/Effect";
import { OperationsFailure, refuse } from "./safety";
import { backup, inspectBundleResult, preflight, restore } from "./workflows";
import { verifyRehearsalBackup, restoreRehearsal } from "./rehearsal";
import { captureCheckpoint } from "./checkpoint";
import { captureRelease } from "./artifacts";

const usage = `Local synthetic operations only. No production action exists.
  rehearsal-verify <bundle> <manifest-sha256> <checkpoint.json> <checkpoint-sha256> <new-private-certificate.json>
  rehearsal-restore <private-admin-target.json> <bundle> <manifest-sha256> <checkpoint.json> <checkpoint-sha256> <fresh-openerp_restore_name> <new-receipt-directory> --confirm-fresh-local-restore
  rehearsal-checkpoint <private-checkpoint-input.json> <new-private-checkpoint-directory>
  preflight <private-target.json> <new-private-receipt.json>
  capture-release <explicit-source-root> <new-private-release-directory>
  backup <private-target.json> <new-bundle-directory> <private-recovery-plan.json> --confirm-local-backup
  inspect <bundle-directory> <separately-recorded-manifest-sha256>
  restore <private-admin-target.json> <bundle-directory> <manifest-sha256> <fresh-openerp_restore_name> <new-receipt-directory> --confirm-fresh-local-restore
All paths must be absolute. Read docs/operations/local-recovery.md first.`;

process.umask(0o077);

const command = Effect.tryPromise({
  try: async () => {
    const action = process.argv[2];
    const args = process.argv.slice(3);

    if (action === "--help" && args.length === 0) {
      console.info(usage);

      return;
    }

    const first = args[0];
    const second = args[1];
    const third = args[2];
    const fourth = args[3];
    const fifth = args[4];
    const sixth = args[5];
    const seventh = args[6];
    const eighth = args[7];

    if (
      action === "rehearsal-verify" &&
      args.length === 5 &&
      first &&
      second &&
      third &&
      fourth &&
      fifth
    ) {
      await verifyRehearsalBackup(first, second, third, fourth, fifth);
    } else if (
      action === "rehearsal-restore" &&
      args.length === 8 &&
      first &&
      second &&
      third &&
      fourth &&
      fifth &&
      sixth &&
      seventh &&
      eighth === "--confirm-fresh-local-restore"
    ) {
      await restoreRehearsal(first, second, third, fourth, fifth, sixth, seventh);
    } else if (action === "rehearsal-checkpoint" && args.length === 2 && first && second) {
      await captureCheckpoint(first, second);
    } else if (action === "capture-release" && args.length === 2 && first && second) {
      await captureRelease(first, second);
    } else if (action === "preflight" && args.length === 2 && first && second) {
      await preflight(first, second);
    } else if (
      action === "backup" &&
      args.length === 4 &&
      first &&
      second &&
      third &&
      fourth === "--confirm-local-backup"
    ) {
      await backup(first, second, third);
    } else if (action === "inspect" && args.length === 2 && first && second) {
      const result = await inspectBundleResult(first, second);
      console.info(JSON.stringify(result, null, 2) + "\n");

      return;
    } else if (
      action === "restore" &&
      args.length === 6 &&
      first &&
      second &&
      third &&
      fourth &&
      fifth &&
      sixth === "--confirm-fresh-local-restore"
    ) {
      await restore(first, second, third, fourth, fifth);
    } else refuse(usage);
    console.info(
      "Local operation finished. Inspect the private artifact; production action remains disabled.",
    );
  },
  catch: (cause) =>
    cause instanceof OperationsFailure
      ? cause
      : new OperationsFailure({
          message:
            "Local operation failed. No success is claimed. Inspect the private target configuration and partial output; do not reuse an existing restore destination.",
        }),
});

await Effect.runPromise(
  command.pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  ),
);
