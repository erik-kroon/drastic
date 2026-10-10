import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

export function fixedApplicationClock(instant: string): Clock.Clock | null {
  const milliseconds = Date.parse(instant);

  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== instant ||
    !instant.endsWith("Z")
  )
    return null;

  const nanoseconds = BigInt(milliseconds) * 1_000_000n;

  return {
    currentTimeMillis: Effect.succeed(milliseconds),
    currentTimeMillisUnsafe: () => milliseconds,
    currentTimeNanos: Effect.succeed(nanoseconds),
    currentTimeNanosUnsafe: () => nanoseconds,
    monotonicTimeNanos: Effect.sync(() => BigInt(Math.round(performance.now() * 1_000_000))),
    monotonicTimeNanosUnsafe: () => BigInt(Math.round(performance.now() * 1_000_000)),
    sleep: (duration) => Effect.sleep(duration),
  };
}
