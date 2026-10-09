import { useCallback, useSyncExternalStore } from "react";

// Presentation preferences kept in this browser only. They select layout and
// appearance; they never confer authority (ADR 0006, ADR 0019).
const changed = "drastic-preference";

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);

  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(changed, listener);
  };
}

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode, quota); the previous choice then stays in effect.
  }

  window.dispatchEvent(new Event(changed));
}

export function usePreference<const Value extends string>(
  key: string,
  values: ReadonlyArray<Value>,
  fallback: Value,
): readonly [Value, (value: Value) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );

  const value = values.find((candidate) => candidate === stored) ?? fallback;
  const set = useCallback((next: Value) => writePreference(key, next), [key]);

  return [value, set] as const;
}
