export function payrollMonth(month: string, locale: "sv" | "en", capitalized = false) {
  const value = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));

  return capitalized ? value.charAt(0).toLocaleUpperCase(locale) + value.slice(1) : value;
}

export function nextPayrollMonth(month: string) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);

  return date.toISOString().slice(0, 7);
}
