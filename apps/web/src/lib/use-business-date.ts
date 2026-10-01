import { useBookWorkspace } from "./book-context";

export function useBusinessDate() {
  return useBookWorkspace().setup.today;
}
