import * as Effect from "effect/Effect";
import {
  activateOnboardingLocally,
  retainOnboardingObservation,
  observeOnboardingOperations,
  prepareOnboardingTargetFence,
} from "./onboarding";
import { OperationsFailure, refuse } from "./safety";

process.umask(0o077);

await Effect.runPromise(
  Effect.tryPromise({
    try: async () => {
      const [action, configPath, intentId] = process.argv.slice(2);

      if (!configPath)
        refuse(
          "Use onboarding-cli.ts observe|observe-retain|fence-target|activate <private-configuration.json> [activation-intent-id]. Synthetic isolated local systems only.",
        );

      if (action === "observe" && intentId === undefined && process.argv.length === 4) {
        await observeOnboardingOperations(configPath);
      } else if (
        action === "observe-retain" &&
        intentId === undefined &&
        process.argv.length === 4
      ) {
        await retainOnboardingObservation(configPath);
      } else if (action === "fence-target" && intentId === undefined && process.argv.length === 4) {
        await prepareOnboardingTargetFence(configPath);
      } else if (action === "activate" && intentId !== undefined && process.argv.length === 5) {
        await activateOnboardingLocally(configPath, intentId);
      } else {
        refuse("Unsupported local onboarding command.");
      }

      console.info(
        "Synthetic local operation completed. Inspect retained receipts and private artifacts.",
      );
    },
    catch: (cause) =>
      cause instanceof OperationsFailure
        ? cause
        : new OperationsFailure({
            message:
              "Local onboarding operation failed. Retained intent and diagnostics remain available. No automatic unfencing or production action occurred.",
          }),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        console.error(error.message);
        process.exitCode = 1;
      }),
    ),
  ),
);
