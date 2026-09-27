// Downstream adapters own JSON syntax/schema decoding. Inspect keys before they
// collapse duplicate members; never rewrite the original command/evidence bytes.
export function assertUniqueJsonKeys(body: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
  const containers: Array<Set<string> | null> = [];

  for (let offset = 0; offset < text.length; offset++) {
    const character = text[offset];

    if (character === "{" || character === "[") {
      containers.push(character === "{" ? new Set<string>() : null);

      if (containers.length > 128) {
        throw new Error("JSON nesting exceeds the 128-container limit.");
      }
    } else if (character === "}" || character === "]") {
      containers.pop();
    } else if (character === '"') {
      const start = offset;
      offset++;

      while (offset < text.length && text[offset] !== '"') {
        if (text[offset] === "\\") offset++;
        offset++;
      }

      let next = offset + 1;

      while (
        text[next] === " " ||
        text[next] === "\t" ||
        text[next] === "\r" ||
        text[next] === "\n"
      )
        next++;
      const keys = containers.at(-1);

      if (text[next] !== ":" || keys == null) continue;
      const key: unknown = JSON.parse(text.slice(start, offset + 1));

      if (typeof key !== "string") {
        throw new Error("JSON object keys must be strings.");
      }

      if (keys.has(key)) {
        throw new Error("JSON object keys must be unique.");
      }

      keys.add(key);
    }
  }
}
