import * as Effect from "effect/Effect";
import { OperationsFailure, refuse } from "./safety";
import { backup, inspectBundle, preflight, restore } from "./workflows";

const usage = `Local synthetic operations only. No production action exists.
  preflight <private-target.json> <new-private-receipt.json>
  backup <private-target.json> <new-bundle-directory> <private-supplementary-directory|none> --confirm-local-backup
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
    if (action === "preflight" && args.length === 2 && first && second) {
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
      await inspectBundle(first, second);
      console.info(
        "Bundle checksums match. This does not prove successful restore or compliant retention.",
      );
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
