import { execFile, spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import * as Schema from "effect/Schema";

const execute = promisify(execFile);

const Result = Schema.Union([
  Schema.Struct({
    unit: Schema.Literals(["inch", "pixel"]),
    pages: Schema.Array(
      Schema.Struct({
        width: Schema.Finite.check(Schema.isGreaterThan(0)),
        height: Schema.Finite.check(Schema.isGreaterThan(0)),
      }),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
  Schema.Struct({
    error: Schema.Literals([
      "document_size",
      "pdf_signature",
      "image_profile",
      "page_limit",
      "document_invalid",
    ]),
  }),
]);

export class DocumentInspectionError extends Error {}

let inspecting = false;

export async function inspectDocument(bytes: Uint8Array, mediaType: string) {
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024)
    throw new DocumentInspectionError("document_size");

  if (inspecting) throw new DocumentInspectionError("inspection_capacity");

  if (process.platform !== "darwin")
    throw new DocumentInspectionError("inspection_isolation_unavailable");

  inspecting = true;
  let directory: string | undefined;

  try {
    directory = await realpath(await mkdtemp(join(tmpdir(), "openerp-inspection-")));
    const script = join(directory, "inspection.mjs");
    const node = await realpath((await execute("/usr/bin/which", ["node"])).stdout.trim());
    await execute(
      "bun",
      [
        "build",
        "--target=node",
        new URL("./inspection-worker.ts", import.meta.url).pathname,
        "--outfile",
        script,
      ],
      { timeout: 10000, maxBuffer: 8192 },
    );
    const output = await runIsolatedDocumentWorker(script, node, bytes, mediaType);

    const result = Schema.decodeSync(Schema.fromJsonString(Result))(output);

    if ("error" in result) throw new DocumentInspectionError(result.error);

    return result;
  } catch (error) {
    if (error instanceof DocumentInspectionError) throw error;

    throw new DocumentInspectionError("inspection_isolation_unavailable");
  } finally {
    inspecting = false;

    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

let inspectionTail = Promise.resolve();

let pendingInspections = 0;

export async function inspectQueuedDocument(bytes: Uint8Array, mediaType: string) {
  if (bytes.length < 1 || bytes.length > 5 * 1024 * 1024)
    throw new DocumentInspectionError("document_size");

  if (pendingInspections >= 8) throw new DocumentInspectionError("inspection_capacity");

  pendingInspections++;
  const inspection = inspectionTail.then(() => inspectDocument(bytes, mediaType));
  inspectionTail = inspection.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await inspection;
  } finally {
    pendingInspections--;
  }
}

export function runIsolatedDocumentWorker(
  script: string,
  node: string,
  bytes: Uint8Array,
  mediaType: string,
) {
  const literal = (path: string) => `(literal ${JSON.stringify(path)})`;
  const ancestors = new Set<string>();

  for (const path of [script, node]) {
    let directory = dirname(path);

    while (directory !== "/") {
      ancestors.add(directory);
      directory = dirname(directory);
    }
  }

  const metadata = [...ancestors].map(literal).join(" ");
  const profile = `(version 1)(deny default)(allow file-read* ${literal("/")} (subpath "/System") (subpath "/usr/lib") ${literal(node)} ${literal(script)} ${literal("/dev/null")} ${literal("/dev/urandom")} ${literal("/dev/random")})(allow file-read-metadata ${metadata})(allow process-exec ${literal(node)})(allow sysctl-read)(allow signal (target self))`;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/sandbox-exec",
      [
        "-p",
        profile,
        node,
        "--permission",
        `--allow-fs-read=${script}`,
        "--no-addons",
        "--max-old-space-size=128",
        "--max-semi-space-size=8",
        script,
        mediaType,
      ],
      {
        cwd: tmpdir(),
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let reason: string | undefined;
    let stdout = "";
    let stderrBytes = 0;
    let monitoring = false;
    let closed = false;
    let stderr = "";

    const stop = (code: string) => {
      if (closed) return;

      reason ??= code;
      child.kill("SIGKILL");
    };

    const deadline = setTimeout(() => stop("inspection_timeout"), 5000);

    const memory = setInterval(() => {
      if (monitoring || !child.pid || child.exitCode !== null || child.signalCode !== null) return;

      monitoring = true;
      void execute("/bin/ps", ["-o", "rss=", "-p", String(child.pid)], {
        timeout: 1000,
        maxBuffer: 1024,
      })
        .then(
          ({ stdout: rss }) => {
            if (Number(rss.trim()) > 256 * 1024) stop("inspection_memory_limit");
          },
          () => {
            if (child.exitCode === null && child.signalCode === null)
              stop("inspection_monitor_unavailable");
          },
        )
        .finally(() => {
          monitoring = false;
        });
    }, 50);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();

      if (Buffer.byteLength(stdout) > 4096) stop("inspection_output_limit");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      stderr = (stderr + chunk.toString()).slice(-8192);

      if (stderrBytes > 8192)
        stop(
          stderr.includes("heap out of memory")
            ? "inspection_memory_limit"
            : "inspection_output_limit",
        );
    });
    child.stdin.on("error", () => stop("inspection_failed"));
    child.on("error", () => {
      reason ??= "inspection_isolation_unavailable";
    });
    child.on("close", (code, signal) => {
      closed = true;
      clearTimeout(deadline);
      clearInterval(memory);

      if (reason || code !== 0 || signal)
        reject(
          new DocumentInspectionError(
            reason ??
              (stderr.includes("heap out of memory")
                ? "inspection_memory_limit"
                : "inspection_failed"),
          ),
        );
      else resolve(stdout);
    });
    child.stdin.end(bytes);
  });
}
