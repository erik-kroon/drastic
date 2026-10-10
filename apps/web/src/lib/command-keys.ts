import { useState } from "react";

export class CommandKeys {
  private readonly keys = new Map<string, string>();

  options(path: string, body: string): RequestInit {
    const identity = `${path}:${body}`;
    const key = this.keys.get(identity) ?? crypto.randomUUID();
    this.keys.set(identity, key);

    return { method: "POST", body, headers: { "Idempotency-Key": key } };
  }

  get(identity: string) {
    return this.keys.get(identity);
  }

  delete(identity: string) {
    return this.keys.delete(identity);
  }

  clear() {
    this.keys.clear();
  }
}

export function useCommandKeys() {
  const [current] = useState(() => new CommandKeys());

  return { current };
}
