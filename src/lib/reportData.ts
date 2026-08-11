/** Shared data shaping for the Excel export and printable report:
 * the "Lease details" and "Rental break up & reco" sheets of the workbook. */
import type { Lessee, ReconciliationEntry } from "@prisma/client";
import { edate, firstDueDate, parseISO } from "./engine/dates";
import { netRentAt } from "./engine/engine";
import { dateToISO, lesseeToPayload, lesseeToEngineInput } from "./serialize";
import type { ApplicationPayload } from "./validation";

const GST_RATE = 0.18;

/** Whole months between two ISO dates (floor). */
export function monthsBetween(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO);
  const b = parseISO(toISO);
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < a.d) months -= 1;
  return Math.max(0, months);
}

export interface LeaseDetailsRow {
  label: string;
  values: (string | number | null)[];
}

/** Fields-as-rows, lessees-as-columns, mirroring the workbook sheet. */
export function leaseDetailsRows(
  app: ApplicationPayload,
  activeLessees: ApplicationPayload["lessees"],
): LeaseDetailsRow[] {
  const L = activeLessees;
  const tenure = (l: (typeof L)[number]) =>
    l.leaseStartDate && l.leaseEndDate
      ? monthsBetween(l.leaseStartDate, l.leaseEndDate)
      : null;
  const residual = (l: (typeof L)[number]) =>
    l.leaseEndDate ? monthsBetween(app.disbursementDate, l.leaseEndDate) : null;
  const escalationSummary = (l: (typeof L)[number]) =>
    l.firstEscalationDate && l.escalations.length > 0
      ? l.escalations
          .map(
            (e, i) =>
              `${(e.rate * 100).toFixed(1)}%${i === 0 ? ` from ${l.firstEscalationDate}` : ` after ${e.monthsAfterPrevious}m`}`,
          )
          .join(", ")
      : "None";
  return [
    { label: "Lessor name", values: L.map(() => app.lessorName || null) },
    { label: "Lessee name", values: L.map((l) => l.name || null) },
    { label: "Lessee rating (if available)", values: L.map((l) => l.rating || null) },
    { label: "Agreement date", values: L.map((l) => l.agreementDate) },
    { label: "Agreement type", values: L.map(() => app.agreementType || null) },
    { label: "Address of property", values: L.map(() => app.propertyAddress || null) },
    { label: "Fit-out period", values: L.map((l) => l.fitOutPeriod || null) },
    { label: "Lease start date", values: L.map((l) => l.leaseStartDate) },
    { label: "Lease end date", values: L.map((l) => l.leaseEndDate) },
    { label: "Tenure (months)", values: L.map(tenure) },
    { label: "Residual tenure (months)", values: L.map(residual) },
    { label: "Lock-in period (months)", values: L.map((l) => l.lockInMonths) },
    { label: "Current rent (gross)", values: L.map((l) => l.grossRent) },
    { label: "Area (sq.ft)", values: L.map((l) => l.areaSqft) },
    { label: "Rent on monthly sales", values: L.map((l) => l.rentOnMonthlySales || null) },
    {
      label: "Rental per sq.ft",
      values: L.map((l) =>
        l.areaSqft && l.areaSqft > 0 ? Math.round((l.grossRent / l.areaSqft) * 100) / 100 : null,
      ),
    },
    { label: "Renewal clause (if any)", values: L.map((l) => l.renewalClause || null) },
    { label: "Escalation", values: L.map(escalationSummary) },
    { label: "Security deposit", values: L.map((l) => l.securityDeposit) },
    {
      label: "GST, taxes & maintenance borne by",
      values: L.map(() => app.gstTaxesBorneBy || null),
    },
    { label: "Same lessee occupancy since", values: L.map((l) => l.occupancySince || null) },
    { label: "Remark", values: L.map(() => app.remark || null) },
  ];
}

export interface BreakupRow {
  srNo: number;
  name: string;
  agreementDate: string | null;
  balanceLeaseMonths: number | null;
  grossRent: number;
  /** Gross + 18% GST − TDS, the workbook's "Net Rental required to be credited". */
  toCredit: number;
  /** Gross − TDS, the workbook's "Net Rental excluding GST". */
  netExGst: number;
  contribution: number;
}

export function rentalBreakup(
  app: ApplicationPayload,
  activeLessees: ApplicationPayload["lessees"],
): BreakupRow[] {
  const totalGross = activeLessees.reduce((s, l) => s + l.grossRent, 0);
  return activeLessees.map((l, i) => ({
    srNo: i + 1,
    name: l.name || `Lessee ${l.position}`,
    agreementDate: l.agreementDate,
    balanceLeaseMonths: l.leaseEndDate
      ? monthsBetween(app.disbursementDate, l.leaseEndDate)
      : null,
    grossRent: l.grossRent,
    toCredit: l.grossRent * (1 + GST_RATE) - l.grossRent * l.tdsRate,
    netExGst: l.grossRent * (1 - l.tdsRate),
    contribution: totalGross > 0 ? l.grossRent / totalGross : 0,
  }));
}

export interface RecoCell {
  dueDate: string;
  expected: number;
  actual: number | null;
  diff: number | null;
}

export interface RecoColumn {
  lesseeName: string;
  bankAccount: string;
  cells: RecoCell[];
}

/** Expected-vs-actual reconciliation grid. Includes at least `minMonths` due
 * dates from the first due date, extended to cover any recorded entries. */
export function recoGrid(
  app: ApplicationPayload,
  dbLessees: Lessee[],
  entries: ReconciliationEntry[],
  minMonths = 24,
): { dueDates: string[]; columns: RecoColumn[] } {
  const d0 = firstDueDate(app.disbursementDate, app.dueDay);
  // Extend the grid beyond minMonths so no recorded credit falls off the end.
  const maxEntryDate = entries
    .map((e) => dateToISO(e.dueDate)!)
    .sort()
    .at(-1);
  let months = minMonths;
  if (maxEntryDate) {
    while (months < 600 && edate(d0, months - 1) < maxEntryDate) months++;
  }
  const dueDates = Array.from({ length: months }, (_, i) => (i === 0 ? d0 : edate(d0, i)));

  const active = dbLessees
    .filter((l) => l.grossRent > 0)
    .sort((a, b) => a.position - b.position);

  const columns: RecoColumn[] = active.map((dbLessee) => {
    const engineInput = lesseeToEngineInput(lesseeToPayload(dbLessee));
    const byDate = new Map(
      entries
        .filter((e) => e.lesseeId === dbLessee.id)
        .map((e) => [dateToISO(e.dueDate)!, e]),
    );
    const bankAccount =
      entries.find((e) => e.lesseeId === dbLessee.id && e.bankAccount)?.bankAccount ?? "";
    return {
      lesseeName: dbLessee.name || `Lessee ${dbLessee.position}`,
      bankAccount,
      cells: dueDates.map((d) => {
        const expected = netRentAt(engineInput, d);
        const actual = byDate.get(d)?.actualCredit ?? null;
        return { dueDate: d, expected, actual, diff: actual === null ? null : actual - expected };
      }),
    };
  });

  return { dueDates, columns };
}
