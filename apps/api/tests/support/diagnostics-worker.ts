import api from "../../src/index";
import type { Bindings } from "../../src/runtime/environment";

export default {
  fetch(request: Request, bindings: Bindings) {
    if (new URL(request.url).pathname === "/__test/console") {
      console.error("E2E Worker console capture probe");

      return new Response("captured");
    }

    return api.fetch(request, bindings);
  },
};
