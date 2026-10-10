import * as Effect from "effect/Effect";
import { failure } from "./failures";

export function sha256Hex(value: string) {
  return Effect.tryPromise({
    try: async () => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

      return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      );
    },
    catch: () => failure("InternalError"),
  });
}
