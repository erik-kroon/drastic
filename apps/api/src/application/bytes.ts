import * as Effect from "effect/Effect";
import { failure } from "./failures";

// One owner for the byte and digest primitives that sealed documents compare against.
// Sealed artifact digests are recorded once and re-verified on every read, so these
// must stay byte-identical across every owner that computes them.

export function base64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

export function bytesEqual(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function sha256HexOf(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", copy),
    catch: () => failure("InternalError"),
  }).pipe(
    Effect.map((hash) =>
      Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );
}
