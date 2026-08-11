/** Date helpers. All dates are handled as ISO `YYYY-MM-DD` strings and UTC
 * timestamps to avoid timezone drift; arithmetic mirrors Excel's EDATE. */

export function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

export function toISO(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Excel EDATE: same day-of-month N months later, clamped to month end. */
export function edate(iso: string, months: number): string {
  const { y, m, d } = parseISO(iso);
  const zero = y * 12 + (m - 1) + months;
  const ny = Math.floor(zero / 12);
  const nm = (zero % 12) + 1;
  return toISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Whole days between two ISO dates (b - a). */
export function diffDays(a: string, b: string): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round(
    (Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000,
  );
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** First instalment due date given disbursement date and due day (5 or 15).
 * Mirrors the workbook: day < dueDay -> this month; == -> disbursement date;
 * > -> next month's due day. */
export function firstDueDate(disbursement: string, dueDay: number): string {
  const { y, m, d } = parseISO(disbursement);
  if (d < dueDay) return toISO(y, m, dueDay);
  if (d === dueDay) return disbursement;
  return edate(toISO(y, m, dueDay), 1);
}
