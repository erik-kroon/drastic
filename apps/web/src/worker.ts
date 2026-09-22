import start from "@tanstack/react-start/server-entry";

interface WebEnv {
  readonly API: { fetch(request: Request): Promise<Response> };
}

export default {
  fetch(request: Request, env: WebEnv): Promise<Response> | Response {
    if (new URL(request.url).pathname.startsWith("/api/")) return env.API.fetch(request);
    return start.fetch(request);
  },
};
