import { describe, expect, it } from "vitest";
import { edate, firstDueDate } from "./dates";
import {
  calculate,
  cashAt,
  discountFactorAt,
  maxEligibility,
  simulate,
  solveDiscountFactor,
  withUniformDiscountFactor,
} from "./engine";
import type { EngineParams, LesseeInput } from "./types";

/** The exact scenario cached inside `LRD calculator 2.0 Sept 23.xlsm`:
 * one lessee, gross 18,300,000/month, 10% TDS, +15% escalation every 36 months
 * from 2027-08-20 (blank 4th/5th frequencies collapse onto the 3rd date),
 * cash cover 0.9, ROI 15%, disbursed 2024-07-31, due day 15, no moratorium. */
const lessee: LesseeInput = {
  name: "Lessee1- ABC",
  grossRent: 18_300_000,
  tdsRate: 0.1,
  propertyTaxRate: 0,
  insuranceRate: 0,
  otherDeduction: 0,
  discountFactor: 0.9,
  firstEscalationDate: "2027-08-20",
  escalations: [
    { rate: 0.15, monthsAfterPrevious: 0 },
    { rate: 0.15, monthsAfterPrevious: 36 },
    { rate: 0.15, monthsAfterPrevious: 36 },
    { rate: 0.15, monthsAfterPrevious: 0 },
    { rate: 0.15, monthsAfterPrevious: 0 },
  ],
};

const params: EngineParams = {
  roi: 0.15,
  disbursementDate: "2024-07-31",
  dueDay: 15,
  moratoriumMonths: 0,
  propertyValue: 300_000_000,
};

const EXCEL_180M = 1_341_151_534.4979434; // '180M'!J3 (Goal Seek result)
const EXCEL_108M = 972_940_882.2274461; // 'Fixed Tenure'!J3

describe("date helpers", () => {
  it("computes the first due date like the workbook", () => {
    expect(firstDueDate("2024-07-31", 15)).toBe("2024-08-15");
    expect(firstDueDate("2024-07-10", 15)).toBe("2024-07-15");
    expect(firstDueDate("2024-07-15", 15)).toBe("2024-07-15");
    expect(firstDueDate("2024-12-20", 5)).toBe("2025-01-05");
  });

  it("EDATE clamps to month end", () => {
    expect(edate("2024-01-31", 1)).toBe("2024-02-29");
    expect(edate("2024-08-15", 6)).toBe("2025-02-15");
  });
});

describe("schedule replication against Excel cached rows", () => {
  const rows = simulate(EXCEL_180M, 180, [lessee], params);

  it("month 0: interest-only period from disbursement to first due date", () => {
    expect(rows[0].dueDate).toBe("2024-08-15");
    expect(rows[0].days).toBe(15);
    expect(rows[0].interest).toBe(8_267_372);
    expect(rows[0].principal).toBe(0);
  });

  it("months 1-4 match the workbook to the rupee", () => {
    expect(rows[1].interest).toBe(17_085_903);
    expect(rows[1].principal).toBe(-2_262_903);
    expect(rows[1].closingBalance).toBeCloseTo(1_343_414_437.4979434, 4);
    expect(rows[2].interest).toBe(16_562_644);
    expect(rows[2].closingBalance).toBeCloseTo(1_345_154_081.4979434, 4);
    expect(rows[3].interest).toBe(17_136_894);
    expect(rows[4].closingBalance).toBeCloseTo(1_349_257_594.4979434, 4);
  });

  it("cash flow steps up on escalation dates", () => {
    // Before first escalation (2027-08-20): 16.47M net, 14.823M cash.
    const before = rows.find((r) => r.dueDate === "2027-08-15")!;
    expect(before.netRent).toBeCloseTo(16_470_000, 6);
    // First due date on/after the escalation: escalated rent applies.
    const after = rows.find((r) => r.dueDate === "2027-09-15")!;
    expect(after.netRent).toBeCloseTo(18_940_500, 6);
  });

  it("fully amortizes at the Excel Goal Seek loan amount", () => {
    expect(rows[rows.length - 1].closingBalance).toBe(0);
  });
});

describe("eligibility", () => {
  it("180 months: Excel's Goal Seek answer amortizes to zero; ours sits at the top of the plateau", () => {
    const ours = maxEligibility(180, [lessee], params);
    // Same plateau: Excel's answer is within 0.01% below the deterministic max.
    expect(ours).toBeGreaterThanOrEqual(EXCEL_180M);
    expect((ours - EXCEL_180M) / EXCEL_180M).toBeLessThan(0.0001);
    // Independent reference (Python bisection): 1,341,192,080.24
    expect(ours).toBeCloseTo(1_341_192_080.24, 0);
  });

  it("108 months custom tenure matches", () => {
    const ours = maxEligibility(108, [lessee], params);
    expect(ours).toBeGreaterThanOrEqual(EXCEL_108M);
    expect((ours - EXCEL_108M) / EXCEL_108M).toBeLessThan(0.0001);
    expect(ours).toBeCloseTo(973_006_112.98, 0);
  });
});

describe("calculate()", () => {
  const result = calculate({
    params,
    lessees: [{ ...lessee, uniqueTenureMonths: 180 }],
    tenures: [180, 144, 120],
    customTenure: 108,
    uniqueTenureMode: true,
  });

  it("evaluates all tenures, largest first", () => {
    expect(result.tenureResults.map((r) => r.tenureMonths)).toEqual([180, 144, 120, 108]);
  });

  it("longer tenure never has lower eligibility", () => {
    const [a, b, c, d] = result.tenureResults.map((r) => r.maxEligibility);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
    expect(c).toBeGreaterThanOrEqual(d);
  });

  it("adjusts the eligibility down until every month's principal is positive", () => {
    const r180 = result.tenureResults[0];
    expect(r180.hasNegativeAmortization).toBe(true);
    expect(r180.wasAdjusted).toBe(true);
    expect(r180.adjustedEligibility).toBeLessThan(r180.maxEligibility);
    // At the adjusted amount every month recovers principal strictly > 0.
    const rows = simulate(r180.adjustedEligibility, 180, [lessee], params);
    expect(
      rows.every((r) => r.monthIndex === 0 || r.openingBalance <= 0 || r.principal > 0),
    ).toBe(true);
    expect(r180.adjustedSchedule).toHaveLength(181);
  });

  it("leaves eligibility untouched when no month is negative", () => {
    const clean = result.tenureResults.find((r) => !r.hasNegativeAmortization)!;
    expect(clean.wasAdjusted).toBe(false);
    expect(clean.adjustedEligibility).toBe(clean.maxEligibility);
  });

  it("NPV ratio matches the workbook's cross-check (~0.9008 at 180 months)", () => {
    const r180 = result.tenureResults[0];
    // Excel Input!D21 = 0.9008374865489318 at its Goal Seek loan; ours differs
    // only by the plateau (~0.003% higher loan).
    expect(r180.npvRatio).toBeCloseTo(0.9008374865489318, 3);
  });

  it("LTV trend matches the workbook (within the Goal Seek plateau)", () => {
    const r180 = result.tenureResults[0];
    // Excel Input!P4/P5 computed at its Goal Seek loan, ours at the plateau top.
    expect(r180.ltvTrend![0].minLtv).toBeCloseTo(4.470505114993145, 3);
    expect(r180.ltvTrend![1].minLtv).toBeCloseTo(4.562365008326478, 3);
  });

  it("unique tenure mode consolidates per-lessee loans", () => {
    expect(result.uniqueTenure).not.toBeNull();
    const ut = result.uniqueTenure!;
    expect(ut.perLessee).toHaveLength(1);
    expect(ut.totalEligibility).toBeCloseTo(ut.perLessee[0].adjustedEligibility, 6);
    expect(ut.effectiveTenureMonths).toBeLessThanOrEqual(180);
  });
});

describe("solving the discount factor for a proposed loan and tenure", () => {
  it("finds the cover that closes the loan exactly at tenure end", () => {
    const solved = solveDiscountFactor(1_000_000_000, 180, [lessee], params);
    expect(solved.achievable).toBe(true);
    expect(solved.discountFactor).toBeGreaterThan(0);
    expect(solved.discountFactor).toBeLessThanOrEqual(1);
    const last = solved.schedule[solved.schedule.length - 1];
    expect(last.closingBalance).toBeCloseTo(0, 6);
    // One notch less cover must leave a balance outstanding.
    const short = simulate(
      1_000_000_000,
      180,
      withUniformDiscountFactor([lessee], solved.discountFactor - 0.01),
      params,
    );
    expect(short[short.length - 1].closingBalance).toBeGreaterThan(0);
  });

  it("needs a bigger cover for a shorter tenure", () => {
    const long = solveDiscountFactor(900_000_000, 180, [lessee], params);
    const short = solveDiscountFactor(900_000_000, 120, [lessee], params);
    expect(short.discountFactor).toBeGreaterThan(long.discountFactor);
  });

  it("reports when even the full net rent cannot repay in time", () => {
    const solved = solveDiscountFactor(5_000_000_000, 120, [lessee], params);
    expect(solved.achievable).toBe(false);
    expect(solved.discountFactor).toBe(1);
    expect(solved.schedule[solved.schedule.length - 1].closingBalance).toBeGreaterThan(0);
  });

  it("overrides per-escalation factors with the solved one", () => {
    const stepped = {
      ...lessee,
      escalations: lessee.escalations.map((e, i) =>
        i === 1 ? { ...e, discountFactor: 0.5 } : e,
      ),
    };
    const solved = solveDiscountFactor(900_000_000, 180, [stepped], params);
    const dfs = new Set(
      solved.schedule.filter((r) => r.netRent > 0).map((r) => r.discountFactor.toFixed(6)),
    );
    expect(dfs.size).toBe(1);
  });
});

describe("per-escalation discount factor", () => {
  const stepped = {
    ...lessee,
    escalations: [
      { rate: 0.15, monthsAfterPrevious: 0, discountFactor: 0.85 },
      { rate: 0.15, monthsAfterPrevious: 36 },
      { rate: 0.15, monthsAfterPrevious: 36, discountFactor: 0.8 },
    ],
  };

  it("uses the base factor before the first escalation", () => {
    expect(discountFactorAt(stepped, "2027-08-15")).toBe(0.9);
  });

  it("switches to the escalation's factor from its date onward", () => {
    expect(discountFactorAt(stepped, "2027-08-20")).toBe(0.85);
    // Second escalation has no factor of its own: the previous one continues.
    expect(discountFactorAt(stepped, "2030-08-20")).toBe(0.85);
    expect(discountFactorAt(stepped, "2033-08-20")).toBe(0.8);
  });

  it("feeds through to the serviceable cash flow", () => {
    // Gross 18.3M +15% = 21.045M, less 10% TDS = 18.9405M, x 0.85.
    expect(cashAt(stepped, "2027-09-15")).toBeCloseTo(18_940_500 * 0.85, 4);
  });

  it("lowering the cover lowers the eligibility", () => {
    const base = maxEligibility(180, [lessee], params);
    const lower = maxEligibility(180, [stepped], params);
    expect(lower).toBeLessThan(base);
  });

  it("supports more than five escalations", () => {
    const many = {
      ...lessee,
      escalations: Array.from({ length: 9 }, (_, i) => ({
        rate: 0.05,
        monthsAfterPrevious: i === 0 ? 0 : 12,
      })),
    };
    const rows = simulate(1_000_000, 180, [many], params);
    // Rent keeps stepping up after the 5th escalation (2032 is the 6th year).
    const early = rows.find((r) => r.dueDate === "2028-08-15")!;
    const late = rows.find((r) => r.dueDate === "2034-08-15")!;
    expect(late.netRent).toBeGreaterThan(early.netRent);
  });
});
