/** Client-safe formatting helpers (Indian digit grouping). */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `₹${inr.format(Math.round(value))}`;
}

export function formatINR2(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `₹${inr2.format(value)}`;
}

/** Compact crore representation, e.g. 1341192080 -> "₹134.12 Cr". */
export function formatCrore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const cr = value / 1e7;
  if (Math.abs(cr) >= 1) return `₹${cr.toFixed(2)} Cr`;
  const lakh = value / 1e5;
  if (Math.abs(lakh) >= 1) return `₹${lakh.toFixed(2)} L`;
  return formatINR(value);
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Cash cover shown as a single value, or a range when it steps over time. */
export function dfLabel(range: { min: number; max: number }): string {
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return round(range.min) === round(range.max)
    ? round(range.max).toFixed(2)
    : `${round(range.min).toFixed(2)}–${round(range.max).toFixed(2)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function monthYear(iso: string): string {
  const [y, m] = iso.split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${names[Number(m) - 1]} ${y}`;
}
