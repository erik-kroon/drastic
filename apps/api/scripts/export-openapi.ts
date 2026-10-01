import { Api } from "@open-erp/contracts/api";
import { OpenApi } from "effect/http-api";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outputPath = resolve(process.argv[2] ?? "openapi.json");

const spec = OpenApi.fromApi(Api);

mkdirSync(dirname(outputPath), { recursive: true });

writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`);

const paths = Object.keys(spec.paths).length;

const operations = Object.values(spec.paths).reduce(
  (total, path) => total + Object.keys(path).filter((key) => key !== "parameters").length,
  0,
);

console.log(`Wrote ${paths} paths and ${operations} operations to ${outputPath}`);
