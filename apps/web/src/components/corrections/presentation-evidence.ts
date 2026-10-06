export type CorrectionPresentationEvidence = {
  originalVoucherId: string;
  bundleDigest: string;
  bundleLabel?: string;
  reversalLabel?: string;
  replacementLabel?: string;
  preparerName?: string;
  approverName?: string;
  allocationDate?: string;
  allocationCount?: number;
  currentAllocationCount?: number;
  deniedAt?: string;
  changedAt?: string;
  changedBy?: string;
  reason?: string;
  vatPeriod?: string;
  vatAccountId?: string;
  synthetic?: true;
};

export function displayDigest(digest: string) {
  return (
    digest
      .slice(7, 19)
      .toUpperCase()
      .match(/.{1,4}/g)
      ?.join(" ") ?? digest
  );
}

export function correctionDate(date: string, locale: string, time = false) {
  const value = date.length === 10 ? `${date}T12:00:00Z` : date;

  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(value))
    .replace(/\.$/, "");

  return time ? `${day} ${correctionTime(value, locale)}` : day;
}

export function correctionTime(date: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(date));
}
