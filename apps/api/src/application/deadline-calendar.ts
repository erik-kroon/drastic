import type * as Deadlines from "@open-erp/contracts/deadlines";

// RFC 5545 clients match updates by UID, not by the due date.
function escape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}
function utc(value: string) {
  return new Date(value).toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
export function renderDeadlineCalendar(feed: typeof Deadlines.FeedEvents.Type) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//OpenERP//Deadlines//EN", "CALSCALE:GREGORIAN"];
  for (const event of feed.events) {
    lines.push("BEGIN:VEVENT", `UID:${escape(feed.bookId)}-${escape(event.id)}@deadlines.openerp`,
      `DTSTAMP:${utc(event.updatedAt)}`, `LAST-MODIFIED:${utc(event.updatedAt)}`,
      `DTSTART:${utc(event.dueAt)}`, `SUMMARY:${escape(event.title)}`, "END:VEVENT");
  }
  const folded = [...lines, "END:VCALENDAR"].flatMap((line) => {
    const parts: string[] = [];
    let part = "";
    for (const character of line) {
      if (new TextEncoder().encode(part + character).length > (parts.length ? 74 : 75)) {
        parts.push(part);
        part = character;
      } else part += character;
    }
    parts.push(part);
    return parts.map((value, index) => index ? ` ${value}` : value);
  });
  return [...folded, ""].join("\r\n");
}
