import { useSyncExternalStore } from "react";
import { swedishBusinessDate } from "@open-erp/contracts/accounting";

function readToday() {
  return swedishBusinessDate(new Date());
}

function subscribe(refresh: () => void) {
  let timer: ReturnType<typeof setTimeout>;

  // Stockholm midnight is a minute boundary in both winter and summer.
  // Reschedule against the wall clock, including after a suspended tab wakes.
  const schedule = () => {
    refresh();
    timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000));
  };

  schedule();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);

  return () => {
    clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", refresh);
  };
}

export function useBusinessDate() {
  return useSyncExternalStore(subscribe, readToday, readToday);
}
