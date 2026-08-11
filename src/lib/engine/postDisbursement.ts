/** Post-disbursement events.
 *
 * Once a loan is disbursed the sanctioned schedule stops being the truth: the
 * borrower takes an additional disbursement, prepays, or the rate is reset. Each
 * such change carries an effective date, and from that date the loan runs on the
 * same rental cash flow until the balance clears — so the tenure, not the
 * instalment, absorbs the change.
 *
 * The mechanics are the workbook's (actual/365, interest rounded to whole
 * rupees at each due date, moratorium, final-month payoff); the only additions
 * are that an event may land on any day of the month, which splits the interest
 * period at the effective date, and that the schedule runs to closure rather
 * than to a fixed tenure.
 */
import { compareISO, diffDays, edate, firstDueDate } from "./dates";
import { cashAt, netRentAt, simulate } from "./engine";
import type { EngineParams, LesseeInput, ScheduleRow } from "./types";

/** How far the revised schedule is allowed to run before we give up on it
 * closing (the tenure ceiling accepted anywhere else in the app). */
export const DEFAULT_HORIZON_MONTHS = 600;

export interface PostDisbursementEvent {
  /** Any day of the month; need not be a due date. */
  effectiveDate: string;
  /** Actual outstanding balance as at the effective date. When given it
   * replaces the projected balance, anchoring the run to the loan system. */
  outstandingBalance?: number | null;
  additionalDisbursement: number;
  /** Prepayment received on the effective date (over and above the
   * instalment). */
  repayment: number;
  /** Annual rate in force from this date onward. */
  revisedRoi?: number | null;
  /** Fixed instalment from this date onward, replacing the rent-derived
   * amount. Null leaves the instalment linked to the rent. */
  revisedEmi?: number | null;
  note?: string;
}

export interface PostDisbursementRow extends ScheduleRow {
  /** Annual rate applied over this period (the last one in force). */
  roi: number;
  additionalDisbursement: number;
  repayment: number;
  /** Correction applied when an event stated the actual outstanding balance:
   * closing = opening + adjustment + disbursed − repaid − principal. */
  balanceAdjustment: number;
  /** Rent-derived serviceable cash for the month, before any EMI override. */
  rentCash: number;
  emiOverridden: boolean;
  /** Events that took effect within this period. */
  events: PostDisbursementEvent[];
}

/** Month-by-month run of a disbursed loan with dated changes applied.
 * Rows m = 0..horizonMonths; the caller trims at closure. */
export function simulateWithEvents(
  loan: number,
  horizonMonths: number,
  lessees: LesseeInput[],
  params: EngineParams,
  events: PostDisbursementEvent[],
): PostDisbursementRow[] {
  const pending = [...events].sort((a, b) =>
    compareISO(a.effectiveDate, b.effectiveDate),
  );
  const d0 = firstDueDate(params.disbursementDate, params.dueDay);
  const rows: PostDisbursementRow[] = [];
  let balance = loan;
  let prev = params.disbursementDate;
  let roi = params.roi;
  let emi: number | null = null;
  let nextEvent = 0;

  for (let m = 0; m <= horizonMonths; m++) {
    const dueDate = m === 0 ? d0 : edate(d0, m);
    const opening = balance;
    let additionalDisbursement = 0;
    let repayment = 0;
    let balanceAdjustment = 0;
    const applied: PostDisbursementEvent[] = [];

    // Interest accrues on the balance in force over each sub-period, so an
    // event mid-month is charged at the old rate up to its effective date and
    // at the new one after it. Rounding stays at the due date, as in the
    // workbook, which keeps an event-free run identical to `simulate`.
    let accrued = 0;
    let cursor = prev;
    while (
      nextEvent < pending.length &&
      compareISO(pending[nextEvent].effectiveDate, dueDate) <= 0
    ) {
      const event = pending[nextEvent];
      // An event dated before the loan existed takes effect immediately.
      const at =
        compareISO(event.effectiveDate, cursor) < 0 ? cursor : event.effectiveDate;
      accrued += (balance * diffDays(cursor, at) * roi) / 365;
      cursor = at;

      if (event.outstandingBalance !== null && event.outstandingBalance !== undefined) {
        balanceAdjustment += event.outstandingBalance - balance;
        balance = event.outstandingBalance;
      }
      balance += event.additionalDisbursement - event.repayment;
      additionalDisbursement += event.additionalDisbursement;
      repayment += event.repayment;
      if (event.revisedRoi !== null && event.revisedRoi !== undefined) {
        roi = event.revisedRoi;
      }
      if (event.revisedEmi !== null && event.revisedEmi !== undefined) {
        emi = event.revisedEmi;
      }
      applied.push(event);
      nextEvent++;
    }
    accrued += (balance * diffDays(cursor, dueDate) * roi) / 365;
    const interest = Math.round(accrued);

    const netRent = lessees.reduce((s, l) => s + netRentAt(l, dueDate), 0);
    const rentCash = lessees.reduce((s, l) => s + cashAt(l, dueDate), 0);
    const servicing = emi ?? rentCash;
    let principal: number;
    if (m <= params.moratoriumMonths) {
      principal = 0;
    } else if (servicing < balance) {
      principal = servicing - interest; // may be negative
    } else {
      principal = balance; // final payoff
    }
    const closing = balance - principal;

    rows.push({
      monthIndex: m,
      dueDate,
      days: diffDays(prev, dueDate),
      netRent,
      cash: servicing,
      discountFactor: netRent > 0 ? servicing / netRent : 0,
      openingBalance: opening,
      interest,
      principal,
      instalment: interest + principal,
      closingBalance: closing,
      ltv: params.propertyValue ? closing / params.propertyValue : null,
      roi,
      additionalDisbursement,
      repayment,
      balanceAdjustment,
      rentCash,
      emiOverridden: emi !== null,
      events: applied,
    });
    balance = closing;
    prev = dueDate;
  }
  return rows;
}

/** Closure = the start of the trailing run of months with nothing outstanding,
 * so a later additional disbursement pushes it out rather than being ignored. */
function closureRow<T extends ScheduleRow>(rows: T[]): T | null {
  let candidate: T | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].closingBalance > 0) break;
    candidate = rows[i];
  }
  return candidate && candidate.monthIndex > 0 ? candidate : null;
}

export interface Closure {
  monthIndex: number;
  dueDate: string;
}

export interface PostDisbursementResult {
  /** Revised schedule, trimmed at closure. */
  schedule: PostDisbursementRow[];
  /** The same loan with no events applied, for comparison. */
  baseline: ScheduleRow[];
  /** Events in effective-date order, as applied. */
  events: PostDisbursementEvent[];
  closure: Closure | null;
  baselineClosure: Closure | null;
  /** Months from disbursement to closure, before and after the events. */
  revisedTenureMonths: number | null;
  baselineTenureMonths: number | null;
  /** Positive = the loan runs longer than it would have. */
  tenureChangeMonths: number | null;
  /** Months still to run from the last effective date to closure. */
  residualMonths: number | null;
  balanceAtLastEvent: number | null;
  totalAdditionalDisbursement: number;
  totalRepayment: number;
  totalInterest: number;
  /** Months after the moratorium where the instalment does not cover the
   * interest, so the balance grows. */
  negativeMonths: number;
  fullyRepaid: boolean;
  warnings: string[];
}

export function computePostDisbursement(
  loan: number,
  lessees: LesseeInput[],
  params: EngineParams,
  events: PostDisbursementEvent[],
  options: { horizonMonths?: number; originalTenureMonths?: number | null } = {},
): PostDisbursementResult {
  const horizon = options.horizonMonths ?? DEFAULT_HORIZON_MONTHS;
  const sorted = [...events].sort((a, b) =>
    compareISO(a.effectiveDate, b.effectiveDate),
  );
  const full = simulateWithEvents(loan, horizon, lessees, params, sorted);
  const baselineFull = simulate(loan, horizon, lessees, params);

  const closure = closureRow(full);
  const baselineClosure = closureRow(baselineFull);
  const schedule = closure
    ? full.filter((r) => r.monthIndex <= closure.monthIndex)
    : full;
  const baseline = baselineClosure
    ? baselineFull.filter((r) => r.monthIndex <= baselineClosure.monthIndex)
    : baselineFull;

  const lastEventDate = sorted.length
    ? sorted[sorted.length - 1].effectiveDate
    : null;
  const lastEventRow = lastEventDate
    ? full.find((r) => compareISO(r.dueDate, lastEventDate) >= 0)
    : null;

  const negativeMonths = schedule.filter(
    (r) => r.monthIndex > params.moratoriumMonths && r.principal < 0,
  ).length;

  const warnings: string[] = [];
  for (const event of sorted) {
    if (compareISO(event.effectiveDate, params.disbursementDate) < 0) {
      warnings.push(
        `An event dated ${event.effectiveDate} falls before the disbursement ` +
          `date (${params.disbursementDate}); it has been applied at disbursement.`,
      );
    }
  }
  if (!closure) {
    warnings.push(
      `The balance does not clear within ${horizon} months — the instalment is ` +
        `too small for the outstanding amount at this rate.`,
    );
  }
  if (negativeMonths > 0) {
    const first = schedule.find(
      (r) => r.monthIndex > params.moratoriumMonths && r.principal < 0,
    )!;
    warnings.push(
      `${negativeMonths} month(s) do not cover the interest, starting ` +
        `${first.dueDate}: the balance grows instead of reducing.`,
    );
  }
  if (
    closure &&
    baselineClosure &&
    closure.monthIndex !== baselineClosure.monthIndex
  ) {
    const delta = closure.monthIndex - baselineClosure.monthIndex;
    warnings.push(
      delta > 0
        ? `The loan now runs ${delta} month(s) longer, closing ${closure.dueDate}.`
        : `The loan now closes ${-delta} month(s) earlier, on ${closure.dueDate}.`,
    );
  }

  return {
    schedule,
    baseline,
    events: sorted,
    closure: closure
      ? { monthIndex: closure.monthIndex, dueDate: closure.dueDate }
      : null,
    baselineClosure: baselineClosure
      ? { monthIndex: baselineClosure.monthIndex, dueDate: baselineClosure.dueDate }
      : null,
    revisedTenureMonths: closure?.monthIndex ?? null,
    baselineTenureMonths: baselineClosure?.monthIndex ?? null,
    tenureChangeMonths:
      closure && baselineClosure
        ? closure.monthIndex - baselineClosure.monthIndex
        : null,
    residualMonths:
      closure && lastEventRow ? closure.monthIndex - lastEventRow.monthIndex : null,
    balanceAtLastEvent: lastEventRow
      ? lastEventRow.openingBalance +
        lastEventRow.balanceAdjustment +
        lastEventRow.additionalDisbursement -
        lastEventRow.repayment
      : null,
    totalAdditionalDisbursement: sorted.reduce(
      (s, e) => s + e.additionalDisbursement,
      0,
    ),
    totalRepayment: sorted.reduce((s, e) => s + e.repayment, 0),
    totalInterest: schedule.reduce((s, r) => s + r.interest, 0),
    negativeMonths,
    fullyRepaid: closure !== null,
    warnings,
  };
}
