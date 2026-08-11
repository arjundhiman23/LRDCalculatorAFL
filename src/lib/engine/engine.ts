/** LRD eligibility engine.
 *
 * Faithful port of `LRD calculator 2.0 Sept 23.xlsm` (see docs/CALCULATION_SPEC.md).
 * Verified against the workbook's cached Goal Seek results in engine.test.ts.
 */
import { compareISO, diffDays, edate, firstDueDate } from "./dates";
import type {
  CalculationInput,
  CalculationResult,
  EngineParams,
  LesseeInput,
  LesseeTenureResult,
  ScheduleRow,
  TenureResult,
  UniqueTenureResult,
} from "./types";

const MAX_LOAN = 1e13;
const BISECTION_ITERATIONS = 120;

/** Resolved escalation step: from `date` onward gross rent is `gross` and the
 * cash cover is `discountFactor`. */
interface RentStep {
  date: string;
  gross: number;
  discountFactor: number;
}

/** Cumulative escalation steps for a lessee (dates may repeat; later entries
 * override, matching the Excel's nested-IF/EDATE(date, 0) collapse). */
export function rentSteps(lessee: LesseeInput): RentStep[] {
  const steps: RentStep[] = [];
  if (!lessee.firstEscalationDate || lessee.escalations.length === 0) return steps;
  let date = lessee.firstEscalationDate;
  let gross = lessee.grossRent;
  let df = lessee.discountFactor;
  lessee.escalations.forEach((esc, i) => {
    if (i > 0) date = edate(date, esc.monthsAfterPrevious);
    gross *= 1 + esc.rate;
    if (esc.discountFactor !== null && esc.discountFactor !== undefined) {
      df = esc.discountFactor;
    }
    steps.push({ date, gross, discountFactor: df });
  });
  return steps;
}

export function grossRentAt(lessee: LesseeInput, date: string): number {
  let gross = lessee.grossRent;
  for (const step of rentSteps(lessee)) {
    if (compareISO(date, step.date) >= 0) gross = step.gross;
  }
  return gross;
}

/** Cash cover in force on a date: the base factor, overridden by the latest
 * escalation that carries its own factor. */
export function discountFactorAt(lessee: LesseeInput, date: string): number {
  let df = lessee.discountFactor;
  for (const step of rentSteps(lessee)) {
    if (compareISO(date, step.date) >= 0) df = step.discountFactor;
  }
  return df;
}

export function netRentAt(lessee: LesseeInput, date: string): number {
  const gross = grossRentAt(lessee, date);
  const rateDeductions =
    gross * (lessee.tdsRate + lessee.propertyTaxRate + lessee.insuranceRate);
  return gross - rateDeductions - lessee.otherDeduction;
}

export function cashAt(lessee: LesseeInput, date: string): number {
  return netRentAt(lessee, date) * discountFactorAt(lessee, date);
}

/** Month-by-month repayment simulation for a given loan amount.
 * Rows m = 0..months (inclusive), exactly like the tenure sheets. */
export function simulate(
  loan: number,
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): ScheduleRow[] {
  const d0 = firstDueDate(params.disbursementDate, params.dueDay);
  const rows: ScheduleRow[] = [];
  let balance = loan;
  let prev = params.disbursementDate;
  for (let m = 0; m <= months; m++) {
    const dueDate = m === 0 ? d0 : edate(d0, m);
    const days = diffDays(prev, dueDate);
    const interest = Math.round((balance * days * params.roi) / 365);
    const netRent = lessees.reduce((s, l) => s + netRentAt(l, dueDate), 0);
    const cash = lessees.reduce((s, l) => s + cashAt(l, dueDate), 0);
    let principal: number;
    if (m <= params.moratoriumMonths) {
      principal = 0;
    } else if (cash < balance) {
      principal = cash - interest; // may be negative (negative amortization)
    } else {
      principal = balance; // final payoff
    }
    const closing = balance - principal;
    rows.push({
      monthIndex: m,
      dueDate,
      days,
      netRent,
      cash,
      discountFactor: netRent > 0 ? cash / netRent : 0,
      openingBalance: balance,
      interest,
      principal,
      instalment: interest + principal,
      closingBalance: closing,
      ltv: params.propertyValue ? closing / params.propertyValue : null,
    });
    balance = closing;
    prev = dueDate;
  }
  return rows;
}

function endingBalance(
  loan: number,
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): number {
  const rows = simulate(loan, months, lessees, params);
  return rows[rows.length - 1].closingBalance;
}

/** Max loan fully amortized by the end of the tenure. Deterministic version of
 * the Excel's Goal Seek (which stops anywhere inside the final-month plateau). */
export function maxEligibility(
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): number {
  let lo = 0;
  let hi = MAX_LOAN;
  if (endingBalance(hi, months, lessees, params) <= 0) return hi;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (endingBalance(mid, months, lessees, params) > 0) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** The sanctionable amount: fully amortizes by tenure end AND every month after
 * the moratorium recovers a strictly positive principal (never negative, never
 * zero) while a balance is outstanding. */
export function adjustedEligibility(
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): number {
  const ok = (loan: number): boolean => {
    const rows = simulate(loan, months, lessees, params);
    if (rows[rows.length - 1].closingBalance > 0) return false;
    return rows.every(
      (r) =>
        r.monthIndex <= params.moratoriumMonths ||
        r.openingBalance <= 0 || // already repaid; nothing left to recover
        r.principal > 0,
    );
  };
  let lo = 0;
  let hi = MAX_LOAN;
  if (ok(hi)) return hi;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Replace every cash cover (base and per-escalation) with a single factor. */
export function withUniformDiscountFactor(
  lessees: LesseeInput[],
  discountFactor: number,
): LesseeInput[] {
  return lessees.map((l) => ({
    ...l,
    discountFactor,
    escalations: l.escalations.map((e) => ({ ...e, discountFactor: null })),
  }));
}

export interface SolvedDiscountFactor {
  /** Cash cover that repays the loan exactly at the end of the tenure. */
  discountFactor: number;
  /** False when even 100% of net rent cannot clear the loan in the tenure. */
  achievable: boolean;
  schedule: ScheduleRow[];
}

/** Solve the cash cover needed for a given loan to close exactly at the end of
 * the tenure. More cover means more cash to principal, so the closing balance
 * falls monotonically as the factor rises — a plain bisection. */
export function solveDiscountFactor(
  loan: number,
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): SolvedDiscountFactor {
  const endingAt = (df: number) =>
    endingBalance(loan, months, withUniformDiscountFactor(lessees, df), params);

  if (loan <= 0) {
    return {
      discountFactor: 0,
      achievable: true,
      schedule: simulate(loan, months, withUniformDiscountFactor(lessees, 0), params),
    };
  }
  if (endingAt(1) > 0) {
    return {
      discountFactor: 1,
      achievable: false,
      schedule: simulate(loan, months, withUniformDiscountFactor(lessees, 1), params),
    };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (endingAt(mid) > 0) lo = mid;
    else hi = mid;
  }
  return {
    discountFactor: hi,
    achievable: true,
    schedule: simulate(loan, months, withUniformDiscountFactor(lessees, hi), params),
  };
}

/** Smallest uniform cash cover that repays within the tenure *and* keeps every
 * month's principal recovery positive. More cover means more cash to
 * principal, so negative months disappear as the factor rises — the loan then
 * closes before the end of the tenure. */
export function solveCleanDiscountFactor(
  loan: number,
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): SolvedDiscountFactor {
  const scheduleAt = (df: number) =>
    simulate(loan, months, withUniformDiscountFactor(lessees, df), params);
  const ok = (df: number): boolean => {
    const rows = scheduleAt(df);
    if (rows[rows.length - 1].closingBalance > 0) return false;
    return rows.every(
      (r) =>
        r.monthIndex <= params.moratoriumMonths ||
        r.openingBalance <= 0 ||
        r.principal > 0,
    );
  };

  if (loan <= 0 || !ok(1)) {
    return { discountFactor: 1, achievable: false, schedule: scheduleAt(1) };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return { discountFactor: hi, achievable: true, schedule: scheduleAt(hi) };
}

function payoffMonth(rows: ScheduleRow[]): number {
  for (const r of rows) {
    if (r.monthIndex > 0 && r.closingBalance <= 0) return r.monthIndex;
  }
  return rows[rows.length - 1].monthIndex;
}

/** Workbook NPV cross-check: loan / NPV(roi/12, net rent m=0..payoff).
 * Note the workbook discounts the *undiscounted* net rent (column M), not the
 * cash-cover-adjusted flow, so the ratio lands around the cash cover (~0.9). */
function npvRatio(loan: number, rows: ScheduleRow[], roi: number): number {
  const cutoff = payoffMonth(rows);
  const monthly = roi / 12;
  let npv = 0;
  for (const r of rows) {
    if (r.monthIndex > cutoff) break;
    npv += r.netRent / Math.pow(1 + monthly, r.monthIndex + 1);
  }
  return npv === 0 ? 0 : loan / npv;
}

/** Yearly minimum LTV, replicating the workbook's blocks:
 * year 1 = months 0..12, then 12-month blocks. */
function ltvTrend(
  rows: ScheduleRow[],
  propertyValue: number | null | undefined,
): { year: number; minLtv: number }[] | null {
  if (!propertyValue) return null;
  const out: { year: number; minLtv: number }[] = [];
  const last = rows[rows.length - 1].monthIndex;
  for (let year = 1; ; year++) {
    const start = year === 1 ? 0 : 13 + (year - 2) * 12;
    const end = year === 1 ? 12 : start + 11;
    if (start > last) break;
    const slice = rows.filter((r) => r.monthIndex >= start && r.monthIndex <= end);
    out.push({
      year,
      minLtv: Math.min(...slice.map((r) => r.closingBalance / propertyValue)),
    });
  }
  return out;
}

function tenureResult(
  months: number,
  lessees: LesseeInput[],
  params: EngineParams,
): TenureResult {
  const eligibility = maxEligibility(months, lessees, params);
  const schedule = simulate(eligibility, months, lessees, params);
  const hasNegativeAmortization = schedule.some(
    (r) => r.monthIndex > params.moratoriumMonths && r.principal < 0,
  );
  // When the maximum already recovers principal every month there is nothing
  // to adjust; avoid reporting a bisection-precision difference.
  const adjusted = hasNegativeAmortization
    ? adjustedEligibility(months, lessees, params)
    : eligibility;
  const adjustedSchedule = hasNegativeAmortization
    ? simulate(adjusted, months, lessees, params)
    : schedule;
  const dfs = schedule.filter((r) => r.netRent > 0).map((r) => r.discountFactor);
  return {
    tenureMonths: months,
    closureDate: edate(firstDueDate(params.disbursementDate, params.dueDay), months),
    maxEligibility: eligibility,
    adjustedEligibility: adjusted,
    wasAdjusted: hasNegativeAmortization,
    adjustedSchedule,
    payoffMonth: payoffMonth(schedule),
    npvRatio: npvRatio(eligibility, schedule, params.roi),
    ltvTrend: ltvTrend(schedule, params.propertyValue),
    hasNegativeAmortization,
    discountFactorRange: {
      min: dfs.length ? Math.min(...dfs) : 0,
      max: dfs.length ? Math.max(...dfs) : 0,
    },
    schedule,
  };
}

function uniqueTenureResult(
  lessees: LesseeInput[],
  params: EngineParams,
): UniqueTenureResult {
  const perLessee: LesseeTenureResult[] = lessees
    .filter((l) => l.grossRent > 0 && (l.uniqueTenureMonths ?? 0) > 0)
    .map((l) => ({
      lesseeName: l.name,
      ...tenureResult(l.uniqueTenureMonths as number, [l], params),
    }));
  const total = perLessee.reduce((s, r) => s + r.adjustedEligibility, 0);
  const horizon = Math.max(240, ...perLessee.map((r) => r.tenureMonths)) + 60;
  const consolidated = simulate(total, horizon, lessees, params);
  const effective = payoffMonth(consolidated);
  return {
    perLessee,
    totalEligibility: total,
    effectiveTenureMonths: effective,
    consolidatedSchedule: consolidated.filter((r) => r.monthIndex <= effective),
  };
}

export function calculate(input: CalculationInput): CalculationResult {
  const activeLessees = input.lessees.filter((l) => l.grossRent > 0);
  const tenures = [
    ...new Set(
      [...input.tenures, ...(input.customTenure ? [input.customTenure] : [])].filter(
        (t) => t > 0,
      ),
    ),
  ].sort((a, b) => b - a);

  const warnings: string[] = [];
  if (activeLessees.length === 0) {
    return {
      tenureResults: [],
      uniqueTenure: null,
      totalNetRentMonthly: 0,
      totalCashMonthly: 0,
      warnings: ["No lessee has a gross rent greater than zero."],
    };
  }

  const tenureResults = tenures.map((t) => tenureResult(t, activeLessees, input.params));
  for (const r of tenureResults) {
    if (r.wasAdjusted) {
      const cut = r.maxEligibility - r.adjustedEligibility;
      warnings.push(
        `${r.tenureMonths} months: the theoretical maximum caused months where ` +
          `rent does not cover interest, so the eligibility was reduced by ` +
          `${Math.round(cut).toLocaleString("en-IN")} to keep every month's ` +
          `principal recovery positive.`,
      );
    }
  }

  const d0 = firstDueDate(input.params.disbursementDate, input.params.dueDay);
  return {
    tenureResults,
    uniqueTenure: input.uniqueTenureMode
      ? uniqueTenureResult(input.lessees, input.params)
      : null,
    totalNetRentMonthly: activeLessees.reduce((s, l) => s + netRentAt(l, d0), 0),
    totalCashMonthly: activeLessees.reduce((s, l) => s + cashAt(l, d0), 0),
    warnings,
  };
}
