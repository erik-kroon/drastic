import * as Accounting from "@open-erp/contracts/accounting";
import type * as Sie from "@open-erp/contracts/sie";

// Unicode mapping for IBM CP437 bytes 0x80..0xff. ASCII control bytes are not text.
const extended = "\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0";
function refuse(message: string): never {
  throw new Accounting.AccountingError({ code: "UnsupportedProfile", message });
}
function quoted(value: string) {
  if (/[\u0000-\u001f\u007f-\u009f\\]/u.test(value))
    refuse("SIE text contains a control character or unsupported literal backslash. Retain a reviewed representable source; no text was replaced.");
  return `"${value.replaceAll('"', '\\"')}"`;
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) refuse("SIE dates must be real calendar dates.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) refuse("SIE dates must be real calendar dates.");
  return value.replaceAll("-", "");
}
function amount(minor: bigint) {
  const magnitude = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}
function numericCompare(left: string, right: string) {
  return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
}
export function renderSie(capture: typeof Sie.SieCapture.Type): Uint8Array<ArrayBuffer> {
  if (capture.generatorVersion !== "openerp-sie4i-v1" || capture.currencyScale !== 2 || capture.currency !== "SEK")
    refuse("This SIE4I generator supports only its captured version and SEK with currency scale two.");
  const lines = capture.source.lines;
  if (lines.length < 2 || lines.length > 5000 || capture.source.accounts.length > 1000)
    refuse("SIE4I requires a nonempty bounded set of complete movement vouchers.");
  const accounts = new Map(capture.source.accounts.map((account) => [account.accountId, account]));
  if (accounts.size !== capture.source.accounts.length) refuse("Captured account identities must be unique.");
  const codes = new Set<string>();
  for (const account of accounts.values()) {
    if (!/^[1-9][0-9]{0,7}$/.test(account.code) || codes.has(account.code))
      refuse("SIE4I requires unique numeric account codes of at most eight digits.");
    codes.add(account.code);
  }
  const vouchers = new Map<string, Array<(typeof lines)[number]>>();
  const lineIds = new Set<string>();
  for (const line of lines) {
    if (line.part !== "movement" || line.postingDate < capture.startsOn || line.postingDate > capture.endsOn || lineIds.has(`${line.voucherId}:${line.lineId}`))
      refuse("The captured SIE selection contains a duplicate or out-of-interval line.");
    if (!/^[A-Z0-9]{1,16}$/.test(line.series) || !/^[1-9][0-9]{0,37}$/.test(line.voucherNumber))
      refuse("SIE4I requires retained alphanumeric series and positive exact voucher numbers.");
    if (accounts.get(line.accountId)?.code !== line.accountCode) refuse("A captured line has no matching account declaration.");
    lineIds.add(`${line.voucherId}:${line.lineId}`);
    const voucher = vouchers.get(line.voucherId) ?? [];
    voucher.push(line);
    vouchers.set(line.voucherId, voucher);
  }
  if (vouchers.size > 1000) refuse("The SIE4I source exceeds 1000 complete vouchers.");
  const ordered = [...vouchers.values()].map((voucher) => voucher.sort((a, b) => a.ordinal - b.ordinal));
  ordered.sort((a, b) => {
    const left = a[0]; const right = b[0];
    if (!left || !right) return refuse("An empty voucher cannot be transferred.");
    return left.series < right.series ? -1 : left.series > right.series ? 1 : numericCompare(left.voucherNumber, right.voucherNumber);
  });
  const records = ["#FLAGGA 0", '#PROGRAM "OpenERP" "openerp-sie4i-v1"', "#FORMAT PC8",
    `#GEN ${date(capture.generatedOn)}`, "#SIETYP 4", `#FNAMN ${quoted(capture.input.legalName)}`,
    `#VALUTA ${capture.currency}`,
    '#PROSA "Synthetic preparation only. Not a complete-book export or verified importer compatibility."',
    ...[...accounts.values()].sort((a, b) => numericCompare(a.code, b.code)).map((account) => `#KONTO ${account.code} ${quoted(account.name)}`)];
  const identities = new Set<string>();
  for (const voucher of ordered) {
    const first = voucher[0];
    if (!first || voucher.length < 2) refuse("A complete voucher needs at least two lines.");
    const identity = `${first.series}:${first.voucherNumber}`;
    if (identities.has(identity)) refuse("Selected fiscal years reuse a series and voucher number. Create a single-year review pack.");
    identities.add(identity);
    let balance = 0n;
    records.push(`#VER ${quoted(first.series)} ${first.voucherNumber} ${date(first.postingDate)}`, "{");
    for (const [index, line] of voucher.entries()) {
      if (line.ordinal !== index + 1 || line.series !== first.series || line.voucherNumber !== first.voucherNumber
        || line.postingDate !== first.postingDate || line.fiscalYearId !== first.fiscalYearId || line.sequence !== first.sequence
        || line.changeSetId !== first.changeSetId || line.receiptId !== first.receiptId || line.planDigest !== first.planDigest
        || line.periodId !== first.periodId || line.eventId !== first.eventId || line.postingPurpose !== first.postingPurpose
        || line.correctsVoucherId !== first.correctsVoucherId || line.approvalId !== first.approvalId || line.approvedBy !== first.approvedBy)
        refuse("The captured voucher has incomplete ordinals or inconsistent metadata.");
      if (!/^(0|[1-9][0-9]{0,37})$/.test(line.debitMinor) || !/^(0|[1-9][0-9]{0,37})$/.test(line.creditMinor))
        refuse("A captured amount is not an exact minor-unit integer.");
      const debit = BigInt(line.debitMinor); const credit = BigInt(line.creditMinor);
      if ((debit === 0n) === (credit === 0n)) refuse("Each transferred line must contain exactly one positive amount.");
      const signed = debit - credit;
      balance += signed;
      records.push(`#TRANS ${line.accountCode} {} ${amount(signed)} ${date(line.postingDate)} ${quoted(line.description)}`);
    }
    if (balance !== 0n) refuse("An unbalanced voucher cannot be transferred.");
    records.push("}");
  }
  const text = `${records.join("\r\n")}\r\n`;
  if (text.length > 8388608) refuse("The SIE4I artifact exceeds its 8 MiB byte limit.");
  const bytes = new Uint8Array(text.length);
  let offset = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point === undefined) refuse("An invalid character cannot be encoded.");
    const index = extended.indexOf(character);
    if (point < 128) bytes[offset++] = point;
    else if (index >= 0) bytes[offset++] = index + 128;
    else refuse("SIE4I text is not representable in CP437. No replacement or transliteration is permitted.");
  }
  return bytes;
}
