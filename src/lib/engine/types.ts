/** Input/output types of the LRD eligibility engine.
 * See docs/CALCULATION_SPEC.md for the mapping to the source Excel. */

export interface EscalationEvent {
  /** Escalation applied to gross rent at this event, e.g. 0.15 = +15%. */
  rate: number;
  /** Months after the previous escalation event. For the first event this is
   * an offset from `firstEscalationDate` (0 = use the date exactly, matching
   * the Excel's EDATE(date, 0) behaviour). */
  monthsAfterPrevious: number;
  /** Optional cash cover from this escalation date onward. When omitted the
   * previous factor continues (workbook's "Disc factor from" thresholds). */
  discountFactor?: number | null;
}

export interface LesseeInput {
  name: string;
  /** Current gross monthly rent. */
  grossRent: number;
  /** Deduction rates as fractions of gross rent. */
  tdsRate: number;
  propertyTaxRate: number;
  insuranceRate: number;
  /** Absolute monthly deduction. */
  otherDeduction: number;
  /** Base cash-cover multiplier applied to net rent (Excel "Discounting
   * factor"); individual escalations may override it from their date onward. */
  discountFactor: number;
  /** Date of the first escalation; null = rent never escalates. */
  firstEscalationDate: string | null;
  escalations: EscalationEvent[];
  /** Tenure for this lessee when unique-tenure mode is on. */
  uniqueTenureMonths?: number | null;
}

export interface EngineParams {
  /** Annual interest rate, e.g. 0.15. */
  roi: number;
  /** ISO date of disbursement. */
  disbursementDate: string;
  /** 5 or 15 (workbook restriction). */
  dueDay: number;
  /** Months with zero principal recovery at the start. */
  moratoriumMonths: number;
  /** Property value used for the LTV trend output (not a cap). */
  propertyValue?: number | null;
}

export interface ScheduleRow {
  monthIndex: number;
  dueDate: string;
  days: number;
  netRent: number;
  cash: number;
  /** Effective cash cover for the month (cash / net rent, blended across
   * lessees when they use different factors). */
  discountFactor: number;
  openingBalance: number;
  interest: number;
  principal: number;
  instalment: number;
  closingBalance: number;
  /** closingBalance / propertyValue, when a property value is provided. */
  ltv: number | null;
}

export interface TenureResult {
  tenureMonths: number;
  closureDate: string;
  /** Max loan that fully amortizes by the end of the tenure (the Excel's
   * Goal Seek "Eligibility", made deterministic). May imply months where the
   * rent does not cover interest. */
  maxEligibility: number;
  /** The sanctionable figure: max loan that fully amortizes AND has a strictly
   * positive principal component every month (never negative or zero). */
  adjustedEligibility: number;
  /** True when maxEligibility had to be reduced to reach adjustedEligibility. */
  wasAdjusted: boolean;
  /** Schedule at adjustedEligibility. */
  adjustedSchedule: ScheduleRow[];
  /** Month index at which the loan is fully repaid (at maxEligibility). */
  payoffMonth: number;
  /** eligibility / NPV(roi/12, cash flows) sanity ratio from the workbook. */
  npvRatio: number;
  /** Yearly minimum of POS/propertyValue (year 1 = months 0-12, then 12-month
   * blocks), matching the workbook's "LTV trend" table. */
  ltvTrend: { year: number; minLtv: number }[] | null;
  hasNegativeAmortization: boolean;
  /** Range of effective cash cover over the schedule. */
  discountFactorRange: { min: number; max: number };
  /** Schedule at maxEligibility (matches the workbook's tenure sheets). */
  schedule: ScheduleRow[];
}

export interface LesseeTenureResult extends TenureResult {
  lesseeName: string;
}

export interface UniqueTenureResult {
  perLessee: LesseeTenureResult[];
  totalEligibility: number;
  /** Month index at which the consolidated loan (sum of per-lessee loans,
   * serviced by combined cash) is fully repaid. */
  effectiveTenureMonths: number;
  consolidatedSchedule: ScheduleRow[];
}

export interface CalculationInput {
  params: EngineParams;
  lessees: LesseeInput[];
  /** Tenures to evaluate, e.g. [180, 144, 120] plus an optional custom one. */
  tenures: number[];
  customTenure?: number | null;
  uniqueTenureMode?: boolean;
}

export interface CalculationResult {
  tenureResults: TenureResult[];
  uniqueTenure: UniqueTenureResult | null;
  totalNetRentMonthly: number;
  totalCashMonthly: number;
  warnings: string[];
}

