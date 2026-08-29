/** Post-disbursement events.
 *
 * Once a loan is disbursed the sanctioned schedule stops being the truth: the
 * borrower takes an additional disbursement, prepays, the rate is reset, or the
 * actual outstanding balance is restated. Each change carries an effective
 * date.
 *
 * Whenever a **sanctioned tenure** is set (`originalTenureMonths`), the loan is
 * held to it by solving a discounting factor (cash cover) on the combined
 * rental cash flow — the same lever `solveDiscountFactor` uses at the
 * eligibility stage, just applied mid-loan. This starts from the **initial
 * disbursement itself**, so the loan is on track for the sanctioned tenure
 * from day one, not only once a later change forces a correction. Two kinds
 * of change are exempt and are allowed to move the closure date instead:
 *
 * - A **revised ROI** — the tenure absorbs a rate reset, as the workbook
 *   expects.
 * - A **repayment** — a prepayment shortens the tenure rather than being
 *   offset by a lower cover.
 *
 * Everything else that changes the outstanding balance (an additional
 * disbursement, or restating the actual outstanding balance) re-solves the
 * cover from its effective date so the loan still closes at the sanctioned
 * tenure. Without a sanctioned tenure, every change instead moves the
 * closure date, and an event-free run is byte-identical to `simulate`.
 *
 * If even a 100% cash cover cannot repay the loan by the sanctioned tenure,
 * the cover is capped at 1 and the loan is left to run to its natural
 * closure — the tenure is not artificially held, but the shortfall is
 * reported as a warning. Likewise, the auto-adjusted cover minimises the
 * negative-amortization months it can, but if some remain even at full cover
 * they are reported rather than allowed to push the tenure out further.
 *
 * An event may land on any day of the month, and the schedule runs to closure
 * rather than a fixed tenure. Interest in a month where money moves follows
 * the RM team's Step-Up LRD workbook rather than a plain split: the balance
 * carried in is charged for the whole month, money that arrives or leaves is
 * charged (or credited) only for its part-period, and each component is
 * rounded to the rupee before being summed. `runSchedule` documents this in
 * full; it reproduces the reference Hivale schedule across all 181 rows.
 */
import { compareISO, diffDays, edate, firstDueDate } from "./dates";
import { cashAt, netRentAt, simulate } from "./engine";
import type { EngineParams, LesseeInput, ScheduleRow } from "./types";

/** How far the revised schedule is allowed to run before we give up on it
 * closing (the tenure ceiling accepted anywhere else in the app). */
export const DEFAULT_HORIZON_MONTHS = 600;

const DF_SOLVE_ITERATIONS = 100;

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
  /** Annual rate in force from this date onward. Along with a repayment, the
   * only kind of change allowed to move the closure date — everything else
   * holds the sanctioned tenure by adjusting the cash cover instead. */
  revisedRoi?: number | null;
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
  /** Combined net-rent-derived cash at the base (unadjusted) cash cover, for
   * reference against what was actually collected this month. */
  rentCash: number;
  /** True when the auto-solved discounting factor is in force this month
   * (i.e. a balance-changing event has fixed the cover to hold the
   * sanctioned tenure). */
  autoAdjusted: boolean;
  /** Events that took effect within this period. */
  events: PostDisbursementEvent[];
}

/** A cash-cover override in force from `fromDate` onward: the combined net
 * rent of all lessees (not each lessee's own cover) is multiplied by
 * `multiplier` instead. Later entries with an earlier-or-equal `fromDate`
 * supersede earlier ones. */
interface DiscountFactorOverride {
  fromDate: string;
  multiplier: number;
}

function combinedNetRentAt(lessees: LesseeInput[], date: string): number {
  return lessees.reduce((s, l) => s + netRentAt(l, date), 0);
}

function activeOverride(
  overrides: DiscountFactorOverride[],
  dueDate: string,
): DiscountFactorOverride | null {
  let active: DiscountFactorOverride | null = null;
  for (const o of overrides) {
    if (compareISO(o.fromDate, dueDate) <= 0) active = o;
  }
  return active;
}

/** Month-by-month run of a disbursed loan with dated changes and (optionally)
 * a piecewise cash-cover override applied. Rows m = 0..horizonMonths; the
 * caller trims at closure. */
function runSchedule(
  loan: number,
  horizonMonths: number,
  lessees: LesseeInput[],
  params: EngineParams,
  sortedEvents: PostDisbursementEvent[],
  overrides: DiscountFactorOverride[],
): PostDisbursementRow[] {
  const d0 = firstDueDate(params.disbursementDate, params.dueDay);
  const rows: PostDisbursementRow[] = [];
  let balance = loan;
  let prev = params.disbursementDate;
  let roi = params.roi;
  let nextEvent = 0;

  for (let m = 0; m <= horizonMonths; m++) {
    const dueDate = m === 0 ? d0 : edate(d0, m);
    const opening = balance;
    let additionalDisbursement = 0;
    let repayment = 0;
    let balanceAdjustment = 0;
    const applied: PostDisbursementEvent[] = [];

    // Interest follows the RM team's workbook convention, which is *not* a
    // plain split of the whole balance at the effective date:
    //
    //   - The balance carried into the month is charged for the FULL month,
    //     as though nothing had happened.
    //   - New money (an additional disbursement, or the increase from a
    //     restated balance) is charged separately, only from its own
    //     effective date to the due date.
    //   - Money leaving (a repayment, or a decrease from a restatement) stops
    //     earning from its effective date, so it is credited back the
    //     part-period it no longer covers.
    //
    // A revised ROI still applies from its effective date onward, so a rate
    // reset splits the carried balance the ordinary way.
    //
    // Each component is rounded to the rupee on its own before being summed,
    // not rounded once at the end. The workbook does this because it shows a
    // disbursement's interest on its own helper row, and that displayed
    // (already rounded) figure is what feeds the month's total — so summing
    // the unrounded parts can differ by a rupee.
    //
    // Worked example (Hivale LAN 1, month 3): the 3.99 Cr carried in is
    // charged all 28 days (₹3,37,087) and the 26 L disbursed on the 28th is
    // charged its 15 days (₹11,753), totalling ₹3,48,840 — the workbook's
    // figure to the rupee. Rounding the sum instead would give ₹3,48,841.
    //
    // The carried balance accrues as ONE component across the whole month
    // (split only where the rate changes); money that moves mid-month adds
    // its own separately-rounded component. Splitting the carried balance at
    // every event date instead would round it twice and drift by a rupee.
    let accrued = 0;
    // Interest on the balance carried in, accumulated unrounded and only
    // committed when the rate changes or the month ends.
    const carriedBalance = balance;
    let carriedAccrual = 0;
    let cursor = prev;
    while (
      nextEvent < sortedEvents.length &&
      compareISO(sortedEvents[nextEvent].effectiveDate, dueDate) <= 0
    ) {
      const event = sortedEvents[nextEvent];
      // An event dated before the loan existed takes effect immediately.
      const at =
        compareISO(event.effectiveDate, cursor) < 0 ? cursor : event.effectiveDate;
      carriedAccrual += (carriedBalance * diffDays(cursor, at) * roi) / 365;
      cursor = at;

      let delta = 0;
      if (event.outstandingBalance !== null && event.outstandingBalance !== undefined) {
        const adjustment = event.outstandingBalance - balance;
        balanceAdjustment += adjustment;
        balance = event.outstandingBalance;
        delta += adjustment;
      }
      const movement = event.additionalDisbursement - event.repayment;
      balance += movement;
      delta += movement;
      additionalDisbursement += event.additionalDisbursement;
      repayment += event.repayment;

      // A rate reset applies from here on. `cursor` is already at the change
      // date and the carried balance's accrual up to it has been banked
      // above, so the closing accrual below picks up the new rate for the
      // remainder of the month without any further bookkeeping.
      if (event.revisedRoi !== null && event.revisedRoi !== undefined) {
        roi = event.revisedRoi;
      }

      // The money that moved earns (or stops earning) only for the remainder
      // of the month, while the carried balance keeps running to the due date.
      if (delta !== 0) {
        accrued += Math.round((delta * diffDays(at, dueDate) * roi) / 365);
      }
      applied.push(event);
      nextEvent++;
    }
    // The carried balance runs to the due date regardless of what happened
    // mid-month — this is the part that differs from a plain split.
    carriedAccrual += (carriedBalance * diffDays(cursor, dueDate) * roi) / 365;
    accrued += Math.round(carriedAccrual);
    const interest = accrued;

    const netRent = lessees.reduce((s, l) => s + netRentAt(l, dueDate), 0);
    const rentCash = lessees.reduce((s, l) => s + cashAt(l, dueDate), 0);
    const override = activeOverride(overrides, dueDate);
    const servicing = override ? combinedNetRentAt(lessees, dueDate) * override.multiplier : rentCash;

    let principal: number;
    if (m <= params.moratoriumMonths) {
      principal = 0;
    } else if (servicing < balance) {
      principal = servicing - interest; // may be negative
    } else {
      principal = balance; // final payoff
    }
    const closing = balance - principal;

    // The workbook reports the balance *carried in* as the opening figure and
    // lets the month's movement show up in the closing POS, so a disbursement
    // month reads `opening + disbursed - principal = POS`. `opening` is
    // captured before any event is applied, which is exactly that figure.
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
      autoAdjusted: override !== null,
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

/** True when an event is allowed to move the closure date rather than being
 * absorbed by an automatic cash-cover adjustment: a revised ROI or a
 * repayment. */
function isTenureMover(event: PostDisbursementEvent): boolean {
  return (
    (event.revisedRoi !== null && event.revisedRoi !== undefined) ||
    event.repayment > 0
  );
}

/** True when an event actually moves the outstanding balance in a way that
 * needs compensating: an additional disbursement, or restating the balance. */
function changesBalance(event: PostDisbursementEvent): boolean {
  return (
    event.additionalDisbursement > 0 ||
    (event.outstandingBalance !== null && event.outstandingBalance !== undefined)
  );
}

/** Solves the piecewise cash-cover overrides needed so every balance-changing
 * event (other than a revised ROI or a repayment) holds the loan to the
 * sanctioned tenure, in effective-date order. Each solve considers every
 * override already fixed for earlier events. */
function solveDiscountFactorOverrides(
  loan: number,
  lessees: LesseeInput[],
  params: EngineParams,
  sortedEvents: PostDisbursementEvent[],
  sanctionedTenureMonths: number,
): { overrides: DiscountFactorOverride[]; warnings: string[] } {
  const overrides: DiscountFactorOverride[] = [];
  const warnings: string[] = [];
  const targetDueDate = edate(
    firstDueDate(params.disbursementDate, params.dueDay),
    sanctionedTenureMonths,
  );

  /** Solves the multiplier that should be in force from `fromDate` onward
   * (on top of whatever overrides are already fixed) so the loan still
   * closes at the sanctioned tenure, and records it. `label` only affects
   * the wording of the info/warning message. */
  const solveFrom = (fromDate: string, label: string): void => {
    // A segment's own solve must only be answerable from what's known as of
    // its own date — events that haven't happened yet must not silently
    // pre-inflate this segment's cover in anticipation of a future change,
    // since that later change gets its own segment (or moves the tenure)
    // when it actually occurs. Only events up to and including this date are
    // mechanically applied in the trial used to solve it.
    const knownEvents = sortedEvents.filter(
      (e) => compareISO(e.effectiveDate, fromDate) <= 0,
    );
    const endingAt = (multiplier: number): number => {
      const trial = [...overrides, { fromDate, multiplier }];
      const rows = runSchedule(
        loan,
        sanctionedTenureMonths,
        lessees,
        params,
        knownEvents,
        trial,
      );
      return rows[rows.length - 1].closingBalance;
    };

    let resolved: number;
    if (endingAt(1) > 0) {
      // Even full cash cover cannot repay the loan by the sanctioned tenure.
      resolved = 1;
      warnings.push(
        `Even a 100% cash cover cannot repay the loan by the sanctioned tenure ` +
          `${label}; the discounting factor has been capped at 1.00 and the loan ` +
          `will run longer than sanctioned.`,
      );
    } else if (endingAt(0) <= 0) {
      resolved = 0;
    } else {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < DF_SOLVE_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (endingAt(mid) > 0) lo = mid;
        else hi = mid;
      }
      resolved = hi;
      warnings.push(
        `Discounting factor automatically adjusted to ${(resolved * 100).toFixed(1)}% ` +
          `${label} to hold the sanctioned tenure of ${sanctionedTenureMonths} months.`,
      );
    }
    overrides.push({ fromDate, multiplier: resolved });
  };

  // The initial disbursement is solved first, so the loan is on track for the
  // sanctioned tenure from day one rather than only once a later change forces
  // a correction.
  solveFrom(params.disbursementDate, "at disbursement");

  for (const event of sortedEvents) {
    if (isTenureMover(event) || !changesBalance(event)) continue;

    if (compareISO(event.effectiveDate, targetDueDate) > 0) {
      warnings.push(
        `The change on ${event.effectiveDate} falls after the sanctioned tenure ` +
          `ends (${targetDueDate}); it could not be absorbed by an automatic ` +
          `discounting-factor adjustment.`,
      );
      continue;
    }

    solveFrom(event.effectiveDate, `from ${event.effectiveDate}`);
  }

  return { overrides, warnings };
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
  /** Months by which closure overruns the sanctioned tenure, when one is set. */
  overrunMonths: number | null;
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
  const sanctioned = options.originalTenureMonths ?? null;
  const sorted = [...events].sort((a, b) =>
    compareISO(a.effectiveDate, b.effectiveDate),
  );

  const warnings: string[] = [];
  let overrides: DiscountFactorOverride[] = [];
  if (sanctioned && sanctioned > 0) {
    const solved = solveDiscountFactorOverrides(loan, lessees, params, sorted, sanctioned);
    overrides = solved.overrides;
    warnings.push(...solved.warnings);
  } else if (sorted.some((e) => changesBalance(e) && !isTenureMover(e))) {
    warnings.push(
      `Set a sanctioned tenure to hold the loan to it automatically — without one, ` +
        `additional disbursements and balance restatements move the closure date ` +
        `instead.`,
    );
  }

  const full = runSchedule(loan, horizon, lessees, params, sorted, overrides);
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
      `The balance does not clear within ${horizon} months — the cash flow is ` +
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
  if (closure && sanctioned && closure.monthIndex > sanctioned) {
    warnings.push(
      `Closure now falls ${closure.monthIndex - sanctioned} month(s) beyond the ` +
        `sanctioned tenure of ${sanctioned} months.`,
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
    overrunMonths:
      closure && sanctioned ? Math.max(0, closure.monthIndex - sanctioned) : null,
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

/** Kept for callers that want the mechanical event application without the
 * automatic cash-cover solve (e.g. tests exercising `runSchedule` directly
 * through the public surface). Equivalent to `runSchedule` with no override. */
export function simulateWithEvents(
  loan: number,
  horizonMonths: number,
  lessees: LesseeInput[],
  params: EngineParams,
  events: PostDisbursementEvent[],
): PostDisbursementRow[] {
  const sorted = [...events].sort((a, b) =>
    compareISO(a.effectiveDate, b.effectiveDate),
  );
  return runSchedule(loan, horizonMonths, lessees, params, sorted, []);
}
