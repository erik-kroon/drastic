import api from "../../src/index";
import type { Bindings } from "../../src/runtime/environment";

export default {
  fetch(request: Request, bindings: Bindings) {
    const path = new URL(request.url).pathname;

    if (path.startsWith("/__test/body/")) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (path.endsWith("unreadable"))
            controller.error(new Error("synthetic private body failure"));
        },
      });

      return api.fetch(
        new Request(new URL("/api/v1/books", request.url), { method: "POST", body }),
        bindings,
      );
    }

    if (new URL(request.url).pathname === "/__test/console") {
      console.error("E2E Worker console capture probe");

      return new Response("captured");
    }

    return api.fetch(request, bindings);
  },
};
