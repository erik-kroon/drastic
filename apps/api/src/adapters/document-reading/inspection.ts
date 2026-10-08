export type DocumentInspection = {
  readonly pages: ReadonlyArray<{ readonly width: number; readonly height: number }>;
  readonly unit: "inch" | "pixel";
};
