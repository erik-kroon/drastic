import type * as Variable from "@open-erp/contracts/variable-pay-review";
import { Link } from "@open-erp/ui/components/link";
import { formatMinorAmount } from "@/lib/workspace-api";

type View = typeof Variable.VariablePayReviewView.Type;

export function variableDate(value: string, locale: "sv" | "en") {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "Europe/Stockholm",
  })
    .format(new Date(`${value}T12:00:00Z`))
    .replace(/\.$/, "");
}

export function variableMonth(value: string, locale: "sv" | "en") {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Stockholm" }).format(
    new Date(`${value}-01T12:00:00Z`),
  );
}

export function variableWorkedLabel(view: View, locale: "sv" | "en") {
  const assessment = view.assessment;

  if (assessment.workedMinutes === null || assessment.rateMinor === null) return "Arbetad tid";

  const minutes = BigInt(assessment.workedMinutes);

  return `Arbetad tid, ${minutes / 60n} h ${minutes % 60n} min × ${formatMinorAmount(assessment.rateMinor, 2, locale)}`;
}

export function variableBlockerRows(view: View, locale: "sv" | "en", base: string, href: string) {
  const assessment = view.assessment;

  const money = (value: string) => formatMinorAmount(value, 2, locale);

  return view.current.blockers.map((blocker, index) => {
    if (blocker.code === "invalid_source")
      return {
        id: `${index}:source`,
        reason: `${index + 1} Underlaget kan inte verifieras`,
        known: "Beloppet är okänt, inte noll.",
        action: (
          <Link
            href={`${href}&occurrence=${encodeURIComponent(assessment.sourceOccurrence.occurrenceId)}`}
          >
            Visa raden
          </Link>
        ),
      };

    if (blocker.code === "unsupported_work") {
      const dates = [...new Set(blocker.dates)].sort();

      const days = dates
        .map((date) =>
          new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: "Europe/Stockholm" }).format(
            new Date(`${date}T12:00:00Z`),
          ),
        )
        .join(" och ");

      const last = dates.at(-1);

      const month = last
        ? new Intl.DateTimeFormat(locale, { month: "short", timeZone: "Europe/Stockholm" })
            .format(new Date(`${last}T12:00:00Z`))
            .replace(/\.$/, "")
        : "";

      const sick = assessment.sourceProfile.rows
        .filter((row) => blocker.sourceIds.includes(row.sourceId))
        .every((row) => row.kind === "sick");

      return {
        id: `${index}:unsupported`,
        reason: `${index + 1} ${sick ? "Sjukfrånvaro" : "Frånvaro"} ${dates.length} dagar, ${days} ${month}`,
        known: "Stöds inte i den här profilen. Beloppet är okänt, inte noll.",
        action: (
          <Link
            href={`${href}&occurrence=${encodeURIComponent(assessment.sourceOccurrence.occurrenceId)}`}
          >
            Visa raden
          </Link>
        ),
      };
    }

    if (blocker.code === "holiday_control") {
      const control = view.current.holidayControl;

      return {
        id: `${index}:holiday`,
        reason: `${index + 1} Ingående semesterskuld stämmer inte mot huvudboken`,
        known: `Underlaget säger ${money(control.openingMinor)} och konto ${control.accountCode} säger ${money(control.ledgerMinor)}. Skillnad ${money(control.differenceMinor)}.`,
        action: (
          <Link
            href={`${base}/reports?view=ledger&account=${encodeURIComponent(control.accountId)}`}
          >
            Visa konto
          </Link>
        ),
      };
    }

    const row = assessment.sourceProfile.rows.find((item) =>
      blocker.sourceIds.includes(item.sourceId),
    );

    return {
      id: `${index}:duplicate`,
      reason: row
        ? `${index + 1} Tidsrad ${variableDate(row.scheduleDate, locale)}, ${row.startLocal} till ${row.endLocal} används redan`
        : `${index + 1} Tidsraden används redan`,
      known:
        blocker.paidOn && blocker.priorRunRow !== null
          ? `Samma tidsrad ingår i körningen som betalades ut ${variableDate(blocker.paidOn, locale)}, rad ${blocker.priorRunRow}. En tidsrad kan bara räknas en gång.`
          : "En tidsrad kan bara räknas en gång.",
      action: blocker.priorRunId ? (
        <Link href={`${base}/tax?view=payroll&record=${encodeURIComponent(blocker.priorRunId)}`}>
          Visa körningen
        </Link>
      ) : null,
    };
  });
}
