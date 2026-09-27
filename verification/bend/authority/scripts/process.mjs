import { spawn } from "node:child_process";

/** One owned process group, bounded output and an actual termination deadline. */
export async function runProcess(command, args, options = {}) {
  const { timeoutMs = 180000, cwd, env = process.env, maxBytes = 8_000_000 } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "",
      stderr = "",
      error = null,
      done = false,
      escalation;

    function signal(sig) {
      if (!child.pid) return;

      try {
        if (process.platform === "win32") child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch (e) {
        if (e.code !== "ESRCH") error ??= String(e.message);
      }
    }

    function stop(reason) {
      error ??= reason;
      signal("SIGTERM");
      escalation ??= setTimeout(() => signal("SIGKILL"), 1000);
    }

    const timer = setTimeout(() => stop("Verification deadline exceeded"), timeoutMs);

    const collect = (which) => (data) => {
      if (stdout.length + stderr.length + data.length > maxBytes) {
        stop("Verification log limit exceeded");

        return;
      }

      if (which === "out") stdout += data.toString();
      else stderr += data.toString();
    };

    child.stdout.on("data", collect("out"));
    child.stderr.on("data", collect("err"));
    child.on("error", (e) => {
      error = String(e.message);
    });
    child.on("close", (status, sig) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(escalation);

      if (error) signal("SIGKILL");
      resolve({
        command,
        args,
        status,
        signal: sig,
        stdout,
        stderr,
        error,
        passed: !error && status === 0,
      });
    });
  });
}
