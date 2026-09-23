import type * as Intake from "@open-erp/contracts/source-intake";

type Mapping = typeof Intake.CsvMapping.Type;
type SuggestedFields = Partial<
  Pick<
    Mapping,
    | "delimiter"
    | "lineEnding"
    | "dateFormat"
    | "decimalSeparator"
    | "dateColumn"
    | "descriptionColumn"
    | "amountColumn"
    | "providerIdColumn"
  >
>;

type Suggestions = { -readonly [Key in keyof SuggestedFields]: SuggestedFields[Key] };

/** Propose only unambiguous file syntax. Account, sign, balances and coverage remain user decisions. */
export function statementFormat(contentBase64: string) {
  const fields: Suggestions = {};
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(contentBase64), (char) => char.charCodeAt(0)),
    );
  } catch {
    return { fields, headers: [] };
  }
  if (
    text.includes("\r\n") &&
    !text.replaceAll("\r\n", "").includes("\n") &&
    !text.replaceAll("\r\n", "").includes("\r")
  )
    fields.lineEnding = "crlf";
  else if (text.includes("\n") && !text.includes("\r")) fields.lineEnding = "lf";
  const lines = text
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  const header = lines[0];
  if (!header || header.includes('"')) return { fields, headers: [] };
  const delimiters = ([",", ";", "\t"] as const).filter((delimiter) => header.includes(delimiter));
  const delimiter = delimiters.length === 1 ? delimiters[0] : undefined;
  if (!delimiter) return { fields, headers: [] };
  fields.delimiter = delimiter;
  const headers = header.split(delimiter);
  if (
    headers.some((name) => !name || name.length > 200) ||
    new Set(headers).size !== headers.length
  )
    return { fields, headers: [] };
  const matching = (names: string[]) => {
    const matches = headers.filter((name) => names.includes(name.toLocaleLowerCase("en")));
    return matches.length === 1 ? matches[0] : undefined;
  };
  fields.dateColumn = matching(["date", "datum", "bokföringsdatum"]);
  fields.descriptionColumn = matching(["description", "beskrivning", "text"]);
  fields.amountColumn = matching(["amount", "belopp"]);
  fields.providerIdColumn = matching(["reference", "referens", "transaction id"]);
  const rows = lines.slice(1);
  if (
    !rows.length ||
    rows.some((line) => line.includes('"') || line.split(delimiter).length !== headers.length)
  )
    return { fields, headers };
  const values = (name: string | undefined) =>
    name ? rows.map((line) => line.split(delimiter)[headers.indexOf(name)]) : [];
  const dates = values(fields.dateColumn);
  if (dates.length && dates.every((date) => date && /^\d{4}-\d{2}-\d{2}$/.test(date)))
    fields.dateFormat = "YYYY-MM-DD";
  else if (
    dates.length &&
    dates.some((date) => date && Number(date.slice(0, 2)) > 12) &&
    dates.every(
      (date) => date && /^\d{2}\/\d{2}\/\d{4}$/.test(date) && Number(date.slice(3, 5)) <= 12,
    )
  )
    fields.dateFormat = "DD/MM/YYYY";
  const amounts = values(fields.amountColumn);
  if (
    amounts.length &&
    amounts.some((value) => value?.includes(".")) &&
    amounts.every((value) => value && /^-?\d+(\.\d+)?$/.test(value))
  )
    fields.decimalSeparator = ".";
  else if (
    amounts.length &&
    amounts.some((value) => value?.includes(",")) &&
    amounts.every((value) => value && /^-?\d+(,\d+)?$/.test(value))
  )
    fields.decimalSeparator = ",";
  return { fields, headers };
}
