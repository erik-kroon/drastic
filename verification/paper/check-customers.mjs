import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const path = resolve(process.argv[2] ?? "");
if (basename(path) !== "session.json" || !basename(dirname(path)).startsWith("openerp-paper-")) throw new Error("Use the private Paper launcher session");
const session = JSON.parse(await readFile(path, "utf8"));
const origin = new URL(session.apiUrl);
if (origin.hostname !== "127.0.0.1" || origin.protocol !== "http:") throw new Error("Only the disposable local Worker is allowed");
const response = await fetch(`${origin.origin}/api/v1/entities/entity_synthetic/books/book_synthetic/commerce/directory?role=customer`, { headers: { authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(15000) });
const body = await response.json();
if (!response.ok) throw new Error(`Directory HTTP ${response.status}`);
const expected = {
  "Björkdalen Skogsförvaltning AB": ["1875000", "3495000"],
  "Fjällgården Fjällhotell & Konferens AB": ["1620000", "1620000"],
  "Lindqvist Bygg & Entreprenad AB": ["1500000", "4500000"],
  "Norrlands Skogs- och Lantmannaförbund ek. för.": ["1250000", "1250000"],
  "Skogsbruk Nord AB": ["0", "5500000"],
};
const rows = body.items.map((item) => ({ id: item.party.id, name: item.party.displayName, financial: item.financial }));
const failures = [];
for (const [name, values] of Object.entries(expected)) {
  const row = rows.find((item) => item.name === name);
  const group = row?.financial?.find((item) => item.currency === "SEK" && item.currencyScale === 2);
  if (!group || group.outstandingMinor !== values[0] || group.invoicedYearMinor !== values[1]) failures.push(name);
}
const artifact = "test-results/paper/todo/customer-projection.json";
await writeFile(artifact, JSON.stringify({ synthetic: true, expected, rows, pass: failures.length === 0, failures }, null, 2));
console.log(JSON.stringify({ pass: failures.length === 0, customers: rows.length, artifact, failures }));
if (failures.length) process.exit(1);
